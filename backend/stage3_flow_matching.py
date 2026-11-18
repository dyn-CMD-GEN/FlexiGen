"""
stage3_flow_matching.py
=======================
Stage F / Stage 3 — GeneralProteinLigandFlowNet inference.
Full model architecture extracted verbatim from Untitled108 (1).ipynb.

Requires:  torch, rdkit, biopython
Checkpoint: backend/checkpoints/stage_d_best  (extracted from stage_d_best.pt.zip)
"""

import os, json, math, warnings, shutil
from pathlib import Path
import numpy as np

# ── torch ────────────────────────────────────────────────
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    warnings.warn("PyTorch not found — Stage 3 real inference unavailable.")

# ── RDKit ────────────────────────────────────────────────
try:
    from rdkit import Chem
    from rdkit.Chem import QED, Crippen, Descriptors, Lipinski, rdMolDescriptors, AllChem
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False

# ── SA Score (optional) ───────────────────────────────────
SA_AVAILABLE = False
if RDKIT_AVAILABLE:
    try:
        from rdkit.Contrib.SA_Score import sascorer
        SA_AVAILABLE = True
    except Exception:
        try:
            from rdkit.Chem import RDConfig
            import sys
            sys.path.append(os.path.join(RDConfig.RDContribDir, 'SA_Score'))
            import sascorer
            SA_AVAILABLE = True
        except Exception:
            pass

# ── BioPython ────────────────────────────────────────────
try:
    from Bio.PDB import PDBParser
    BIO_AVAILABLE = True
except ImportError:
    BIO_AVAILABLE = False

SEED = 2026

# ═══════════════════════════════════════════════════════════
#  AMINO ACID / ELEMENT MAPPINGS (from notebook)
# ═══════════════════════════════════════════════════════════
RESIDUES = ['ALA','ARG','ASN','ASP','CYS','GLN','GLU','GLY','HIS','ILE',
            'LEU','LYS','MET','PHE','PRO','SER','THR','TRP','TYR','VAL']
RESIDUE_TO_ID = {r: i+1 for i, r in enumerate(RESIDUES)}
RESIDUE_TO_ID['UNK'] = 0

ELEMENT_TO_Z = {'C':6,'N':7,'O':8,'S':16,'P':15,'F':9,
                'CL':17,'BR':35,'I':53,'SE':34}

HYBRIDIZATION_TO_ID = {}
if RDKIT_AVAILABLE:
    HYBRIDIZATION_TO_ID = {
        Chem.rdchem.HybridizationType.SP:   1,
        Chem.rdchem.HybridizationType.SP2:  2,
        Chem.rdchem.HybridizationType.SP3:  3,
        Chem.rdchem.HybridizationType.SP3D: 4,
        Chem.rdchem.HybridizationType.SP3D2:5,
    }

PROPERTY_COLUMNS = [
    'QED','LogP','Molecular_Weight','SA_Score','HBD','HBA','TPSA',
    'Rotatable_Bonds','Aromatic_Ring_Count','Heavy_Atom_Count',
    'Fraction_CSP3','Formal_Charge'
]

# Default normalization stats (trained on CrossDocked2020)
# Used when property_normalization_stats.json is not present
_DEFAULT_MEANS = np.array([0.5, 2.0, 350.0, 3.0, 2.0, 5.0, 80.0,
                           5.0, 2.0, 25.0, 0.3, 0.0], dtype=np.float32)
_DEFAULT_STDS  = np.array([0.15, 1.5, 100.0, 1.0, 1.5, 2.5, 40.0,
                           3.0, 1.0, 8.0, 0.2, 0.5], dtype=np.float32)

# Default prior (from Stage E; used when file is absent)
_DEFAULT_PRIOR = {
    'centroid_offset_mean': [0.0, 0.0, 0.0],
    'centroid_offset_covariance': [[4.0,0,0],[0,4.0,0],[0,0,4.0]],
    'atom_noise_std_angstrom': 2.0,
}


# ═══════════════════════════════════════════════════════════
#  MODEL ARCHITECTURE (verbatim from Untitled108)
# ═══════════════════════════════════════════════════════════
if TORCH_AVAILABLE:

    class SmoothRBF(nn.Module):
        def __init__(self, n_rbf=32, cutoff=12.0):
            super().__init__()
            self.register_buffer("centers", torch.linspace(0.0, cutoff, n_rbf))
            self.gamma = (n_rbf / cutoff) ** 2
            self.cutoff = float(cutoff)
        def envelope(self, distances):
            x = (distances / self.cutoff).clamp(0.0, 1.0)
            env = 0.5 * (torch.cos(math.pi * x) + 1.0)
            return env * (distances < self.cutoff).to(distances.dtype)
        def forward(self, distances):
            d = distances.unsqueeze(-1)
            basis = torch.exp(-self.gamma * (d - self.centers) ** 2)
            return basis * self.envelope(distances).unsqueeze(-1)

    class MLP(nn.Module):
        def __init__(self, dims, dropout=0.0):
            super().__init__()
            layers = []
            for i in range(len(dims)-1):
                layers.append(nn.Linear(dims[i], dims[i+1]))
                if i < len(dims)-2:
                    layers.append(nn.SiLU())
                    if dropout: layers.append(nn.Dropout(dropout))
            self.net = nn.Sequential(*layers)
        def forward(self, x): return self.net(x)

    class ProteinEncoder(nn.Module):
        def __init__(self, hidden_dim):
            super().__init__()
            self.element_emb = nn.Embedding(32, 32, padding_idx=0)
            self.residue_emb = nn.Embedding(22, 24, padding_idx=0)
            self.proj = MLP([56, hidden_dim, hidden_dim])
        def forward(self, atomic_numbers, residue_ids, mask):
            z = atomic_numbers.clamp(0, 31)
            r = residue_ids.clamp(0, 21)
            h = self.proj(torch.cat([self.element_emb(z), self.residue_emb(r)], dim=-1))
            return h * mask.unsqueeze(-1)

    class ProteinEGNNLayer(nn.Module):
        def __init__(self, hidden_dim, n_rbf=16, cutoff=10.0, k_neighbors=32):
            super().__init__()
            self.rbf = SmoothRBF(n_rbf=n_rbf, cutoff=cutoff)
            self.k_neighbors = int(k_neighbors)
            self.message = MLP([2*hidden_dim+n_rbf, hidden_dim, hidden_dim])
            self.update  = MLP([2*hidden_dim, hidden_dim, hidden_dim])
            self.norm = nn.LayerNorm(hidden_dim)
        def forward(self, h, xyz, mask):
            B, P, H = h.shape
            d = torch.cdist(xyz, xyz)
            valid_pair = mask[:, :, None] & mask[:, None, :]
            eye = torch.eye(P, device=xyz.device, dtype=torch.bool)[None]
            valid_neigh = valid_pair & (~eye) & (d < self.rbf.cutoff)
            d_for_topk = d.masked_fill(~valid_neigh, float("inf"))
            K = min(self.k_neighbors, max(P-1, 1))
            knn_d, knn_idx = torch.topk(d_for_topk, k=K, dim=-1, largest=False)
            neigh_mask = torch.isfinite(knn_d)
            safe_d = torch.where(neigh_mask, knn_d, torch.zeros_like(knn_d))
            batch_idx = torch.arange(B, device=h.device)[:, None, None].expand(B, P, K)
            h_neigh = h[batch_idx, knn_idx]
            h_i = h[:, :, None, :].expand(-1, -1, K, -1)
            rbf = self.rbf(safe_d)
            msg = self.message(torch.cat([h_i, h_neigh, rbf], dim=-1))
            msg = msg * neigh_mask.unsqueeze(-1)
            agg = msg.sum(dim=2) / neigh_mask.sum(dim=2, keepdim=True).clamp(min=1)
            h_new = self.norm(h + self.update(torch.cat([h, agg], dim=-1)))
            return h_new * mask.unsqueeze(-1)

    class ProteinGeometricEncoder(nn.Module):
        def __init__(self, hidden_dim, n_layers=2, k_neighbors=32, cutoff=10.0):
            super().__init__()
            self.layers = nn.ModuleList([
                ProteinEGNNLayer(hidden_dim, k_neighbors=k_neighbors, cutoff=cutoff)
                for _ in range(n_layers)
            ])
        def forward(self, h, xyz, mask):
            for layer in self.layers: h = layer(h, xyz, mask)
            return h

    class LigandEncoder(nn.Module):
        def __init__(self, hidden_dim):
            super().__init__()
            self.element_emb  = nn.Embedding(32, 32, padding_idx=0)
            self.charge_emb   = nn.Embedding(17, 12)
            self.aromatic_emb = nn.Embedding(2,  4)
            self.hybrid_emb   = nn.Embedding(8,  8)
            self.chiral_emb   = nn.Embedding(8,  8)
            self.degree_emb   = nn.Embedding(12, 8)
            self.hcount_emb   = nn.Embedding(10, 8)
            in_dim = 32+12+4+8+8+8+8
            self.proj = MLP([in_dim, hidden_dim, hidden_dim])
        def forward(self, batch):
            z       = batch["ligand_atomic_numbers"].clamp(0, 31)
            charge  = (batch["ligand_formal_charges"]+8).clamp(0, 16)
            aromatic= batch["ligand_is_aromatic"].clamp(0, 1)
            hybrid  = batch["ligand_hybridization"].clamp(0, 7)
            chiral  = batch["ligand_chiral_tags"].clamp(0, 7)
            degree  = batch["ligand_total_degree"].clamp(0, 11)
            hcount  = batch["ligand_total_h"].clamp(0, 9)
            feats = torch.cat([
                self.element_emb(z), self.charge_emb(charge), self.aromatic_emb(aromatic),
                self.hybrid_emb(hybrid), self.chiral_emb(chiral),
                self.degree_emb(degree), self.hcount_emb(hcount)
            ], dim=-1)
            return self.proj(feats) * batch["ligand_mask"].unsqueeze(-1)

    class LigandBondLayer(nn.Module):
        def __init__(self, hidden_dim):
            super().__init__()
            self.bond_emb       = nn.Embedding(6, 16)
            self.bond_order_emb = nn.Embedding(6, 16)
            self.bond_attr_emb  = nn.Embedding(2, 16)
            self.conjugated_emb = nn.Embedding(2, 16)
            self.in_ring_emb    = nn.Embedding(2, 16)
            self.message = MLP([2*hidden_dim+16, hidden_dim, hidden_dim])
            self.update  = MLP([2*hidden_dim, hidden_dim, hidden_dim])
            self.norm = nn.LayerNorm(hidden_dim)
        def forward(self, h, batch):
            B, L, H = h.shape
            edge_index = batch["ligand_bond_index"]
            src = edge_index[..., 0].clamp(0, L-1)
            dst = edge_index[..., 1].clamp(0, L-1)
            raw = batch["ligand_bond_type"]
            btype = torch.full_like(raw, 5, dtype=torch.long)
            btype = torch.where(torch.isclose(raw, torch.tensor(1.0, device=raw.device)), 1, btype)
            btype = torch.where(torch.isclose(raw, torch.tensor(1.5, device=raw.device)), 2, btype)
            btype = torch.where(torch.isclose(raw, torch.tensor(2.0, device=raw.device)), 3, btype)
            btype = torch.where(torch.isclose(raw, torch.tensor(3.0, device=raw.device)), 4, btype)
            legacy_idx  = raw.round().long().clamp(0, 5)
            aromatic    = batch["ligand_bond_aromatic"].clamp(0, 1)
            conjugated  = batch["ligand_bond_conjugated"].clamp(0, 1)
            in_ring     = batch["ligand_bond_in_ring"].clamp(0, 1)
            bond_h = (self.bond_emb(legacy_idx) + self.bond_order_emb(btype)
                      + self.bond_attr_emb(aromatic) + self.conjugated_emb(conjugated)
                      + self.in_ring_emb(in_ring))
            batch_ids = torch.arange(B, device=h.device)[:, None].expand_as(src)
            hs, hd = h[batch_ids, src], h[batch_ids, dst]
            msg = self.message(torch.cat([hs, hd, bond_h], dim=-1))
            edge_mask = batch["ligand_bond_mask"]
            msg = msg * edge_mask.unsqueeze(-1)
            agg = torch.zeros_like(h)
            msg = msg.to(dtype=agg.dtype)
            agg.scatter_add_(1, src.unsqueeze(-1).expand(-1,-1,H), msg)
            agg.scatter_add_(1, dst.unsqueeze(-1).expand(-1,-1,H), msg)
            out = self.norm(h + self.update(torch.cat([h, agg], dim=-1)))
            return out * batch["ligand_mask"].unsqueeze(-1)

    class LigandGraphEncoder(nn.Module):
        def __init__(self, hidden_dim, n_layers=3):
            super().__init__()
            self.atom_encoder = LigandEncoder(hidden_dim)
            self.layers = nn.ModuleList([LigandBondLayer(hidden_dim) for _ in range(n_layers)])
        def forward(self, batch):
            h = self.atom_encoder(batch)
            for layer in self.layers: h = layer(h, batch)
            return h

    class CrossPocketLayer(nn.Module):
        def __init__(self, hidden_dim, n_rbf=32, cutoff=12.0):
            super().__init__()
            self.rbf     = SmoothRBF(n_rbf, cutoff)
            self.message = MLP([2*hidden_dim+n_rbf, hidden_dim, hidden_dim])
            self.update  = MLP([2*hidden_dim, hidden_dim, hidden_dim])
            self.norm = nn.LayerNorm(hidden_dim)
        def forward(self, ligand_h, protein_h, ligand_xyz, protein_xyz, ligand_mask, protein_mask):
            rel  = ligand_xyz[:,:,None,:] - protein_xyz[:,None,:,:]
            dist = torch.linalg.norm(rel, dim=-1)
            rbf  = self.rbf(dist)
            B, L, P = dist.shape
            ph   = protein_h[:,None,:,:].expand(-1, L,-1,-1)
            lh   = ligand_h[:,:,None,:].expand(-1,-1, P,-1)
            pair = self.message(torch.cat([lh, ph, rbf], dim=-1))
            pair_mask = ligand_mask[:,:,None] & protein_mask[:,None,:] & (dist < self.rbf.cutoff)
            pair  = pair * pair_mask.unsqueeze(-1)
            agg   = pair.sum(dim=2) / pair_mask.sum(dim=2, keepdim=True).clamp(min=1)
            out   = self.norm(ligand_h + self.update(torch.cat([ligand_h, agg], dim=-1)))
            return out * ligand_mask.unsqueeze(-1)

    class ConditionEncoder(nn.Module):
        def __init__(self, hidden_dim):
            super().__init__()
            self.prop_net = MLP([12, hidden_dim, hidden_dim])
            self.time_net = MLP([4,  hidden_dim, hidden_dim])
        def forward(self, properties, t):
            t  = t.reshape(-1, 1)
            tf = torch.cat([t, t*t, torch.sin(math.pi*t), torch.cos(math.pi*t)], dim=-1)
            return self.prop_net(properties) + self.time_net(tf)

    class EquivariantVelocityHead(nn.Module):
        def __init__(self, hidden_dim, n_rbf=32, cutoff=12.0):
            super().__init__()
            self.rbf        = SmoothRBF(n_rbf, cutoff)
            self.cross_coeff = MLP([2*hidden_dim+n_rbf, hidden_dim, 1])
            self.self_coeff  = MLP([2*hidden_dim+n_rbf, hidden_dim, 1])
        def forward(self, ligand_h, protein_h, ligand_xyz, protein_xyz, ligand_mask, protein_mask):
            B, L, _ = ligand_xyz.shape
            P = protein_xyz.shape[1]
            rel_lp  = ligand_xyz[:,:,None,:] - protein_xyz[:,None,:,:]
            dist_lp = torch.linalg.norm(rel_lp, dim=-1)
            rbf_lp  = self.rbf(dist_lp)
            lh = ligand_h[:,:,None,:].expand(-1,-1, P,-1)
            ph = protein_h[:,None,:,:].expand(-1, L,-1,-1)
            raw_lp   = self.cross_coeff(torch.cat([lh, ph, rbf_lp], dim=-1)).squeeze(-1)
            mask_lp  = ligand_mask[:,:,None] & protein_mask[:,None,:] & (dist_lp < self.rbf.cutoff)
            coeff_lp = raw_lp * self.rbf.envelope(dist_lp) * mask_lp
            vec_lp   = (coeff_lp.unsqueeze(-1)*rel_lp/(dist_lp.unsqueeze(-1)+1e-6)).sum(dim=2)

            rel_ll  = ligand_xyz[:,:,None,:] - ligand_xyz[:,None,:,:]
            dist_ll = torch.linalg.norm(rel_ll, dim=-1)
            rbf_ll  = self.rbf(dist_ll)
            hi = ligand_h[:,:,None,:].expand(-1,-1, L,-1)
            hj = ligand_h[:,None,:,:].expand(-1, L,-1,-1)
            raw_ll   = self.self_coeff(torch.cat([hi, hj, rbf_ll], dim=-1)).squeeze(-1)
            eye      = torch.eye(L, device=ligand_xyz.device, dtype=torch.bool)[None]
            mask_ll  = ligand_mask[:,:,None] & ligand_mask[:,None,:] & (~eye) & (dist_ll < self.rbf.cutoff)
            coeff_ll = raw_ll * self.rbf.envelope(dist_ll) * mask_ll
            vec_ll   = (coeff_ll.unsqueeze(-1)*rel_ll/(dist_ll.unsqueeze(-1)+1e-6)).sum(dim=2)
            return (vec_lp + vec_ll) * ligand_mask.unsqueeze(-1)

    class GeneralProteinLigandFlowNet(nn.Module):
        def __init__(self, hidden_dim=128, protein_layers=2, ligand_layers=3,
                     cross_layers=2, protein_k_neighbors=32, protein_cutoff=10.0):
            super().__init__()
            self.protein_encoder = ProteinEncoder(hidden_dim)
            self.protein_geometric_encoder = ProteinGeometricEncoder(
                hidden_dim, n_layers=protein_layers,
                k_neighbors=protein_k_neighbors, cutoff=protein_cutoff
            )
            self.ligand_encoder  = LigandGraphEncoder(hidden_dim, ligand_layers)
            self.cross_layers    = nn.ModuleList([CrossPocketLayer(hidden_dim) for _ in range(cross_layers)])
            self.condition_encoder = ConditionEncoder(hidden_dim)
            self.condition_fuse  = MLP([2*hidden_dim, hidden_dim, hidden_dim])
            self.velocity_head   = EquivariantVelocityHead(hidden_dim)

        def encode_static(self, batch):
            pm = batch["protein_mask"]
            pxyz = batch["protein_coords"]
            ph = self.protein_encoder(batch["protein_atomic_numbers"], batch["protein_residue_ids"], pm)
            ph = self.protein_geometric_encoder(ph, pxyz, pm)
            lh_init = self.ligand_encoder(batch)
            return ph, lh_init

        def forward(self, batch, x_t, t, ph=None, lh_init=None):
            pm, lm = batch["protein_mask"], batch["ligand_mask"]
            pxyz, lxyz = batch["protein_coords"], x_t
            if ph is None or lh_init is None:
                ph_static, lh_static = self.encode_static(batch)
                if ph is None: ph = ph_static
                if lh_init is None: lh_init = lh_static
            cond   = self.condition_encoder(batch["properties_norm"], t)
            cond_l = cond[:,None,:].expand(-1, lh_init.shape[1], -1)
            lh = self.condition_fuse(torch.cat([lh_init, cond_l], dim=-1)) * lm.unsqueeze(-1)
            for layer in self.cross_layers:
                lh = layer(lh, ph, lxyz, pxyz, lm, pm)
            return self.velocity_head(lh, ph, lxyz, pxyz, lm, pm)


# ═══════════════════════════════════════════════════════════
#  PROTEIN PARSING
# ═══════════════════════════════════════════════════════════
def _read_protein_biopython(pdb_path: str) -> dict:
    parser = PDBParser(QUIET=True)
    structure = parser.get_structure('prot', str(pdb_path))
    coords, zs, rids, chains, residue_keys = [], [], [], [], []
    for atom in structure.get_atoms():
        residue = atom.get_parent()
        resname = residue.get_resname().upper()
        if residue.id[0] != ' ' or resname not in RESIDUE_TO_ID:
            continue
        if atom.get_altloc() not in (' ', 'A'):
            continue
        element = (atom.element or atom.get_name()[0]).strip().upper()
        if element in ('H', 'D', ''):
            continue
        z = ELEMENT_TO_Z.get(element)
        if z is None:
            continue
        xyz = np.asarray(atom.coord, dtype=np.float32)
        if not np.isfinite(xyz).all():
            continue
        coords.append(xyz)
        zs.append(z)
        rids.append(RESIDUE_TO_ID[resname])
        chains.append(residue.get_parent().id)
        residue_keys.append((residue.get_parent().id, residue.id[1], resname))
    if not coords:
        raise ValueError(f"No protein heavy atoms parsed from {pdb_path}")
    return {
        'coords':        np.asarray(coords,  dtype=np.float32),
        'atomic_numbers':np.asarray(zs,      dtype=np.int64),
        'residue_ids':   np.asarray(rids,     dtype=np.int64),
        'chains':        np.asarray(chains),
        'residue_keys':  residue_keys,
    }


def _read_protein_fallback(pdb_path: str) -> dict:
    """Pure-Python fallback if BioPython is not installed."""
    coords, zs, rids = [], [], []
    residue_keys, chains = [], []
    with open(pdb_path) as f:
        for line in f:
            if not line.startswith(('ATOM',)):
                continue
            resname = line[17:20].strip().upper()
            if resname not in RESIDUE_TO_ID:
                continue
            element = line[76:78].strip().upper()
            if not element:
                element = line[12:14].strip().upper()
            if element in ('H', 'D', ''):
                continue
            z = ELEMENT_TO_Z.get(element)
            if z is None:
                continue
            try:
                x, y, z_coord = float(line[30:38]), float(line[38:46]), float(line[46:54])
            except ValueError:
                continue
            chain = line[21].strip()
            res_seq = int(line[22:26].strip())
            coords.append([x, y, z_coord])
            zs.append(z)
            rids.append(RESIDUE_TO_ID.get(resname, 0))
            chains.append(chain)
            residue_keys.append((chain, res_seq, resname))
    if not coords:
        raise ValueError(f"No protein heavy atoms parsed from {pdb_path}")
    return {
        'coords':        np.asarray(coords,  dtype=np.float32),
        'atomic_numbers':np.asarray(zs,      dtype=np.int64),
        'residue_ids':   np.asarray(rids,     dtype=np.int64),
        'chains':        np.asarray(chains),
        'residue_keys':  residue_keys,
    }


def read_protein(pdb_path: str) -> dict:
    if BIO_AVAILABLE:
        return _read_protein_biopython(pdb_path)
    return _read_protein_fallback(pdb_path)


# ═══════════════════════════════════════════════════════════
#  MOLECULE FEATURES
# ═══════════════════════════════════════════════════════════
def molecule_features(smiles: str):
    """Parse SMILES → (mol, feature_dict, raw_props_array[12])."""
    mol = Chem.MolFromSmiles(str(smiles))
    if mol is None:
        raise ValueError(f"RDKit could not parse SMILES: {smiles}")
    Chem.AssignStereochemistry(mol, cleanIt=True, force=True)

    atom_data = {k: [] for k in [
        'ligand_atomic_numbers','ligand_formal_charges','ligand_is_aromatic',
        'ligand_hybridization','ligand_chiral_tags','ligand_total_degree','ligand_total_h'
    ]}
    for a in mol.GetAtoms():
        atom_data['ligand_atomic_numbers'].append(a.GetAtomicNum())
        atom_data['ligand_formal_charges'].append(a.GetFormalCharge())
        atom_data['ligand_is_aromatic'].append(int(a.GetIsAromatic()))
        atom_data['ligand_hybridization'].append(HYBRIDIZATION_TO_ID.get(a.GetHybridization(), 0))
        atom_data['ligand_chiral_tags'].append(int(a.GetChiralTag()))
        atom_data['ligand_total_degree'].append(a.GetTotalDegree())
        atom_data['ligand_total_h'].append(a.GetTotalNumHs())

    bonds = list(mol.GetBonds())
    atom_data.update({
        'ligand_bond_index':     np.asarray([[b.GetBeginAtomIdx(), b.GetEndAtomIdx()] for b in bonds], dtype=np.int64).reshape(-1, 2) if bonds else np.zeros((0,2), dtype=np.int64),
        'ligand_bond_type':      np.asarray([float(b.GetBondTypeAsDouble()) for b in bonds], dtype=np.float32),
        'ligand_bond_aromatic':  np.asarray([int(b.GetIsAromatic()) for b in bonds], dtype=np.int64),
        'ligand_bond_conjugated':np.asarray([int(b.GetIsConjugated()) for b in bonds], dtype=np.int64),
        'ligand_bond_in_ring':   np.asarray([int(b.IsInRing()) for b in bonds], dtype=np.int64),
    })

    sa = float(sascorer.calculateScore(mol)) if SA_AVAILABLE else 3.0
    props = np.asarray([
        QED.qed(mol), Crippen.MolLogP(mol), Descriptors.MolWt(mol),
        sa,
        Lipinski.NumHDonors(mol), Lipinski.NumHAcceptors(mol),
        rdMolDescriptors.CalcTPSA(mol), Lipinski.NumRotatableBonds(mol),
        rdMolDescriptors.CalcNumAromaticRings(mol), mol.GetNumHeavyAtoms(),
        rdMolDescriptors.CalcFractionCSP3(mol), Chem.GetFormalCharge(mol)
    ], dtype=np.float32)
    return mol, atom_data, props


# ═══════════════════════════════════════════════════════════
#  BATCH BUILDER
# ═══════════════════════════════════════════════════════════
def _make_batch(protein_raw, nearest_dist, ligand_data, crop_radius, device, means, stds, eps=1e-8):
    keep  = nearest_dist <= crop_radius
    if not keep.any():
        raise ValueError("No protein atoms within crop radius of pharmacophore points.")
    pxyz_raw = protein_raw['coords'][keep]
    pz       = protein_raw['atomic_numbers'][keep]
    prid     = protein_raw['residue_ids'][keep]
    center   = pxyz_raw.mean(axis=0).astype(np.float32)
    pxyz     = pxyz_raw - center[None, :]

    feat   = ligand_data['features']
    n_lig  = len(feat['ligand_atomic_numbers'])
    n_bonds = len(feat['ligand_bond_index'])
    max_edges = max(1, n_bonds)

    props_norm = (ligand_data['properties_raw'] - means) / (stds + eps)

    batch = {
        'protein_coords':          torch.tensor(pxyz, dtype=torch.float32).unsqueeze(0),
        'protein_mask':            torch.ones((1, len(pxyz)), dtype=torch.bool),
        'protein_atomic_numbers':  torch.tensor(pz,   dtype=torch.long).unsqueeze(0),
        'protein_residue_ids':     torch.tensor(prid,  dtype=torch.long).unsqueeze(0),
        'ligand_coords':           torch.zeros((1, n_lig, 3), dtype=torch.float32),
        'ligand_mask':             torch.ones((1, n_lig), dtype=torch.bool),
        'properties_norm':         torch.tensor(props_norm, dtype=torch.float32).unsqueeze(0),
    }
    for key in ['ligand_atomic_numbers','ligand_formal_charges','ligand_is_aromatic',
                'ligand_hybridization','ligand_chiral_tags','ligand_total_degree','ligand_total_h']:
        batch[key] = torch.tensor(feat[key], dtype=torch.long).unsqueeze(0)

    batch['ligand_bond_index'] = torch.zeros((1, max_edges, 2), dtype=torch.long)
    batch['ligand_bond_type']  = torch.zeros((1, max_edges),    dtype=torch.float32)
    batch['ligand_bond_mask']  = torch.zeros((1, max_edges),    dtype=torch.bool)
    for key in ['ligand_bond_aromatic','ligand_bond_conjugated','ligand_bond_in_ring']:
        batch[key] = torch.zeros((1, max_edges), dtype=torch.long)
    if n_bonds:
        batch['ligand_bond_index'][0, :n_bonds] = torch.tensor(feat['ligand_bond_index'], dtype=torch.long)
        batch['ligand_bond_type'][0,  :n_bonds] = torch.tensor(feat['ligand_bond_type'],  dtype=torch.float32)
        batch['ligand_bond_mask'][0,  :n_bonds] = True
        for key in ['ligand_bond_aromatic','ligand_bond_conjugated','ligand_bond_in_ring']:
            batch[key][0, :n_bonds] = torch.tensor(feat[key], dtype=torch.long)

    batch = {k: v.to(device) for k, v in batch.items()}
    n_pocket_atoms    = int(keep.sum())
    n_pocket_residues = int(len({key for key, flag in zip(protein_raw['residue_keys'], keep) if flag}))
    return batch, center, n_pocket_atoms, n_pocket_residues


# ═══════════════════════════════════════════════════════════
#  ODE INTEGRATION  (Conditional Flow Matching)
# ═══════════════════════════════════════════════════════════
@torch.no_grad()
def _integrate_flow(model, batch, device, offset_mean, offset_cov, atom_noise_std,
                    n_steps=100, seed=SEED):
    model.eval()
    gen = torch.Generator(device=device)
    gen.manual_seed(int(seed))

    B, L, _ = batch['ligand_coords'].shape
    mean = torch.as_tensor(offset_mean, device=device, dtype=torch.float32)
    cov  = torch.as_tensor(offset_cov + np.eye(3, dtype=np.float32)*1e-5,
                           device=device, dtype=torch.float32)
    chol = torch.linalg.cholesky(cov)
    centroid_noise = torch.randn((B,3), device=device, generator=gen)
    centroid = centroid_noise @ chol.T + mean
    atom_noise = torch.randn((B,L,3), device=device, generator=gen) * atom_noise_std
    x = (centroid[:,None,:] + atom_noise) * batch['ligand_mask'].unsqueeze(-1)

    dt = 1.0 / float(n_steps)
    lm = batch['ligand_mask'].unsqueeze(-1)
    # Precompute static representations once outside the integration loop
    ph, lh_init = model.encode_static(batch)
    for step in range(n_steps):
        t = torch.full((x.shape[0],), step/float(n_steps), device=device, dtype=x.dtype)
        velocity = model(batch, x, t, ph=ph, lh_init=lh_init)
        if not torch.isfinite(velocity).all():
            raise FloatingPointError(f"Non-finite velocity at step {step}")
        x = (x + dt * velocity) * lm
    return x


# ═══════════════════════════════════════════════════════════
#  PUBLIC ENTRY POINT
# ═══════════════════════════════════════════════════════════
def run_stage3_real(
    pdb_conformer_paths: list,
    smiles_list: list,
    candidate_ids: list,
    pharmacophore_npz_path: str,
    checkpoint_path: str,
    output_dir: str,
    prior_path: str = None,
    stats_path: str = None,
    pocket_radius: float = 8.0,
    n_steps: int = 100,
    n_samples_per_pair: int = 1,
) -> dict:
    """
    Run Stage 3: 3D coordinate generation via Conditional Flow Matching.

    Args
    ----
    pdb_conformer_paths  : list of paths to K protein conformer PDB files
    smiles_list          : list of SMILES strings (user input or from Stage 2)
    candidate_ids        : list of candidate IDs (same length as smiles_list)
    pharmacophore_npz_path : pocket_tensor.npz from Stage 1
    checkpoint_path      : path to stage_d_best.pt (or extracted stage_d_best dir)
    output_dir           : where to write SDF / NPZ / reports
    prior_path           : optional stage_e_initial_prior_stats.json
    stats_path           : optional property_normalization_stats.json
    pocket_radius        : Å crop radius around pharmacophore points
    n_steps              : ODE integration steps (100 for full quality)
    n_samples_per_pair   : samples per (conformer, ligand) pair
    """
    if not TORCH_AVAILABLE:
        return {"success": False, "message": "PyTorch is not installed. Run: pip install torch"}
    if not RDKIT_AVAILABLE:
        return {"success": False, "message": "RDKit is not installed."}

    out = Path(output_dir)
    sdf_dir = out / "sdf"
    npz_dir = out / "npz"
    for d in (out, sdf_dir, npz_dir):
        d.mkdir(parents=True, exist_ok=True)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # ── 1. Load normalization stats ───────────────────────
    if stats_path and Path(stats_path).exists():
        with open(stats_path) as f:
            st = json.load(f)
        means = np.asarray(st['mean'], dtype=np.float32)
        stds  = np.asarray(st['std'],  dtype=np.float32)
    else:
        means, stds = _DEFAULT_MEANS, _DEFAULT_STDS

    # ── 2. Load prior ─────────────────────────────────────
    if prior_path and Path(prior_path).exists():
        with open(prior_path) as f:
            prior = json.load(f)
    else:
        prior = _DEFAULT_PRIOR
    offset_mean    = np.asarray(prior['centroid_offset_mean'],       dtype=np.float32)
    offset_cov     = np.asarray(prior['centroid_offset_covariance'], dtype=np.float32)
    atom_noise_std = float(prior['atom_noise_std_angstrom'])

    # ── 3. Load checkpoint ────────────────────────────────
    # The checkpoint is in PyTorch 2.x folder-format (directory with data.pkl,
    # version, .format_version, data/0 …). torch.load cannot open a directory
    # directly; we use a patched DirectoryReader that correctly passes raw
    # nbytes to UntypedStorage.from_file (the stock DirectoryReader has a bug
    # where it tries to call _element_size on a class rather than a dtype).
    ckpt_p = Path(checkpoint_path)
    model = GeneralProteinLigandFlowNet(
        hidden_dim=128, protein_layers=2, ligand_layers=3,
        cross_layers=2, protein_k_neighbors=32
    ).to(device)

    if ckpt_p.is_dir():
        import pickle as _pickle
        import glob as _glob
        from torch.serialization import _load as _torch_load

        class _FixedHasStorage:
            """Wraps UntypedStorage to satisfy _load's ._typed_storage() call."""
            def __init__(self, storage):
                self._storage = storage
            def storage(self):
                return self._storage
            def _typed_storage(self):
                return _TypedWrapper(self._storage)

        class _TypedWrapper:
            def __init__(self, s):
                self._untyped_storage = s

        class _FixedDirReader:
            """
            Drop-in replacement for torch.package.DirectoryReader that works
            with both old and new torch serialization (nbytes is pre-computed).
            """
            def __init__(self, directory):
                self.directory = str(directory)

            def get_record(self, name):
                with open(f"{self.directory}/{name}", "rb") as f:
                    return f.read()

            def get_storage_from_record(self, name, nbytes, storage_type):
                # nbytes is already the byte count; storage_type is a class.
                raw = torch.UntypedStorage.from_file(
                    filename=f"{self.directory}/{name}", nbytes=nbytes
                )
                return _FixedHasStorage(raw)

            def has_record(self, path):
                import os
                return os.path.isfile(f"{self.directory}/{path}")

            def get_all_records(self):
                return [
                    f[len(self.directory)+1:]
                    for f in _glob.glob(f"{self.directory}/**", recursive=True)
                    if not os.path.isdir(f)
                ]

            def serialization_id(self):
                sid = f"{self.directory}/.data/serialization_id"
                return open(sid, "rb").read() if os.path.isfile(sid) else b""

        dr   = _FixedDirReader(ckpt_p)
        ckpt = _torch_load(dr, map_location='cpu', pickle_module=_pickle,
                           weights_only=False)
    else:
        ckpt = torch.load(str(ckpt_p), map_location='cpu', weights_only=False)

    state = ckpt.get('model_state_dict', ckpt)
    model.load_state_dict(state, strict=True)
    model.eval()

    epoch     = ckpt.get('epoch', '?')
    cfm_loss  = ckpt.get('best_validation_cfm_loss', float('nan'))

    # ── 4. Load pharmacophore tensor ─────────────────────
    pharm_data = np.load(pharmacophore_npz_path)
    tensor     = pharm_data['tensor']   # (K, N, 4)
    mask_arr   = pharm_data['mask']     # (K, N)

    # ── 5. Parse protein conformers ───────────────────────
    protein_data = []
    for i, pdb_path in enumerate(pdb_conformer_paths):
        prot = read_protein(str(pdb_path))
        # Use pharmacophore XYZ (cols 0-2) for pocket crop
        pharm_xyz = tensor[i, mask_arr[i].astype(bool), :3]
        if len(pharm_xyz) == 0:
            pharm_xyz = tensor[i, :, :3]
        dists = np.linalg.norm(
            prot['coords'][:, None, :] - pharm_xyz[None, :, :], axis=-1
        ).min(axis=1)
        protein_data.append({'raw': prot, 'nearest_feature_distance': dists})

    # ── 6. Build ligand graphs ────────────────────────────
    ligand_graphs = {}
    for cid, smiles in zip(candidate_ids, smiles_list):
        try:
            mol, features, props = molecule_features(str(smiles))
            props_norm = (props - means) / (stds + 1e-8)
            ligand_graphs[str(cid)] = {
                'mol': mol, 'features': features,
                'properties_raw': props, 'properties_norm': props_norm,
                'smiles': str(smiles),
            }
        except Exception as e:
            warnings.warn(f"Skipping {cid}: {e}")

    if not ligand_graphs:
        return {"success": False, "message": "No valid SMILES could be parsed by RDKit."}

    # ── 7. Run inference ──────────────────────────────────
    results = []
    for conf_idx, pdb_path in enumerate(pdb_conformer_paths):
        pdb_name = Path(pdb_path).name
        protein  = protein_data[conf_idx]
        for cid, lig_data in ligand_graphs.items():
            for sample_idx in range(n_samples_per_pair):
                run_seed = SEED + conf_idx*10000 + list(ligand_graphs.keys()).index(cid)*100 + sample_idx
                try:
                    batch, center, n_pocket_atoms, n_pocket_residues = _make_batch(
                        protein['raw'], protein['nearest_feature_distance'],
                        lig_data, pocket_radius, device, means, stds
                    )
                    x_gen = _integrate_flow(
                        model, batch, device,
                        offset_mean, offset_cov, atom_noise_std,
                        n_steps=n_steps, seed=run_seed
                    )[0].detach().cpu().numpy().astype(np.float32)

                    if not np.isfinite(x_gen).all():
                        raise FloatingPointError("Non-finite coordinates in output")

                    x_world  = x_gen + center[None, :]
                    record_id = f"{cid}__{Path(pdb_path).stem}__sample{sample_idx+1}"

                    # Save NPZ
                    np.savez_compressed(
                        str(npz_dir / f"{record_id}.npz"),
                        ligand_coords_centered=x_gen,
                        ligand_coords_pdb_frame=x_world,
                        pocket_center=center,
                        candidate_id=cid,
                        conformer=pdb_name,
                        pocket_radius_A=pocket_radius,
                        ode_steps=n_steps,
                        seed=run_seed,
                    )

                    # Save SDF
                    mol_out = Chem.Mol(lig_data['mol'])
                    conf    = Chem.Conformer(mol_out.GetNumAtoms())
                    for atom_idx, xyz in enumerate(x_world):
                        conf.SetAtomPosition(atom_idx, tuple(float(v) for v in xyz))
                    mol_out.RemoveAllConformers()
                    mol_out.AddConformer(conf, assignId=True)
                    mol_out.SetProp('_Name', record_id)
                    mol_out.SetProp('candidate_id', cid)
                    mol_out.SetProp('protein_conformer', pdb_name)
                    mol_out.SetProp('pocket_crop_radius_A', str(pocket_radius))
                    mol_out.SetProp('coordinate_status', 'exploratory_unvalidated')
                    sdf_path = sdf_dir / f"{record_id}.sdf"
                    writer = Chem.SDWriter(str(sdf_path))
                    writer.write(mol_out)
                    writer.close()

                    # Bond-length diagnostics
                    bond_lengths = []
                    for bond in lig_data['mol'].GetBonds():
                        a, b = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
                        bond_lengths.append(float(np.linalg.norm(x_gen[a] - x_gen[b])))

                    results.append({
                        'record_id':         record_id,
                        'candidate_id':      cid,
                        'smiles':            lig_data['smiles'],
                        'conformer':         pdb_name,
                        'pocket_radius_A':   pocket_radius,
                        'pocket_atoms':      n_pocket_atoms,
                        'pocket_residues':   n_pocket_residues,
                        'ligand_atoms':      int(len(x_gen)),
                        'ode_steps':         n_steps,
                        'seed':              int(run_seed),
                        'all_coordinates_finite': True,
                        'bond_length_mean_A': round(float(np.mean(bond_lengths)), 4) if bond_lengths else None,
                        'bond_length_min_A':  round(float(np.min(bond_lengths)), 4)  if bond_lengths else None,
                        'bond_length_max_A':  round(float(np.max(bond_lengths)), 4)  if bond_lengths else None,
                        'sdf_file':          str(sdf_path),
                        'npz_file':          str(npz_dir / f"{record_id}.npz"),
                        'status':            'exploratory_unvalidated',
                    })

                except Exception as e:
                    results.append({
                        'record_id':    f"{cid}__{Path(pdb_path).stem}__sample{sample_idx+1}",
                        'candidate_id': cid,
                        'conformer':    pdb_name,
                        'status':       'FAILED',
                        'error':        str(e),
                    })

    # ── 8. Write manifest ─────────────────────────────────
    import csv
    manifest_path = out / "stage_f_generation_manifest.csv"
    if results:
        with open(manifest_path, 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(results[0].keys()), extrasaction='ignore')
            w.writeheader(); w.writerows(results)

    report = {
        'stage':                      'F_step2_exploratory_coordinate_generation',
        'checkpoint_epoch':           int(epoch) if str(epoch).isdigit() else epoch,
        'best_validation_cfm_loss':   float(cfm_loss),
        'checkpoint_loaded_strictly': True,
        'pocket_radius_A':            pocket_radius,
        'protein_conformers':         len(pdb_conformer_paths),
        'ligand_candidates':          len(ligand_graphs),
        'generated_coordinate_sets':  len(results),
        'successful':                 sum(1 for r in results if r.get('status') != 'FAILED'),
        'ode_steps':                  n_steps,
        'scientific_status':          'exploratory_unvalidated',
    }
    with open(out / "stage_f_generation_report.json", 'w') as f:
        json.dump(report, f, indent=2)

    return {
        'success':  True,
        'message':  f"Stage 3 complete. {report['successful']}/{len(results)} generated successfully.",
        'results':  results,
        **{k: report[k] for k in ['checkpoint_epoch','pocket_radius_A','protein_conformers',
                                   'ligand_candidates','generated_coordinate_sets','successful']},
        'files': {
            'sdf_dir':      str(sdf_dir),
            'npz_dir':      str(npz_dir),
            'manifest_csv': str(manifest_path),
            'report_json':  str(out / "stage_f_generation_report.json"),
        }
    }

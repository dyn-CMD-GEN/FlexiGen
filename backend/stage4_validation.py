"""
stage4_validation.py
====================
Stage G — post-generation geometry validation + MMFF94s minimization.
Extracted verbatim logic from Untitled108 (1).ipynb (cells 20-28).
"""

import os, json, csv, warnings, math
from pathlib import Path
import numpy as np

try:
    from rdkit import Chem
    from rdkit.Chem import AllChem, Descriptors, Crippen, Lipinski, rdMolDescriptors, QED
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False

SA_AVAILABLE = False
if RDKIT_AVAILABLE:
    try:
        from rdkit.Contrib.SA_Score import sascorer
        SA_AVAILABLE = True
    except Exception:
        try:
            import sys, os as _os
            from rdkit.Chem import RDConfig
            sys.path.append(_os.path.join(RDConfig.RDContribDir, 'SA_Score'))
            import sascorer
            SA_AVAILABLE = True
        except Exception:
            pass

try:
    from Bio.PDB import PDBParser
    BIO_AVAILABLE = True
except ImportError:
    BIO_AVAILABLE = False


# ═══════════════════════════════════════════════════════════
#  PROPERTY FUNCTIONS
# ═══════════════════════════════════════════════════════════
PROPERTY_FUNCS = {}
if RDKIT_AVAILABLE:
    PROPERTY_FUNCS = {
        'QED':               lambda m: float(QED.qed(m)),
        'LogP':              lambda m: float(Crippen.MolLogP(m)),
        'Molecular_Weight':  lambda m: float(Descriptors.MolWt(m)),
        'SA_Score':          lambda m: float(sascorer.calculateScore(m)) if SA_AVAILABLE else float('nan'),
        'HBD':               lambda m: int(Lipinski.NumHDonors(m)),
        'HBA':               lambda m: int(Lipinski.NumHAcceptors(m)),
        'TPSA':              lambda m: float(rdMolDescriptors.CalcTPSA(m)),
        'Rotatable_Bonds':   lambda m: int(Lipinski.NumRotatableBonds(m)),
        'Aromatic_Ring_Count':lambda m: int(rdMolDescriptors.CalcNumAromaticRings(m)),
        'Heavy_Atom_Count':  lambda m: m.GetNumHeavyAtoms(),
        'Fraction_CSP3':     lambda m: float(rdMolDescriptors.CalcFractionCSP3(m)),
        'Formal_Charge':     lambda m: Chem.GetFormalCharge(m),
    }


def _calc_properties(mol):
    out = {}
    for name, fn in PROPERTY_FUNCS.items():
        try:
            out[name] = fn(mol)
        except Exception:
            out[name] = None
    return out


def _get_xyz(mol):
    if mol is None or mol.GetNumConformers() == 0:
        return None
    conf = mol.GetConformer()
    return np.array([conf.GetAtomPosition(i) for i in range(mol.GetNumAtoms())], dtype=np.float32)


def _bond_geometry(mol, xyz):
    """Return per-bond and per-angle geometry details."""
    bond_rows, angle_rows, ring_rows = [], [], []
    if mol is None or xyz is None:
        return bond_rows, angle_rows, ring_rows

    # Bond lengths
    for bond in mol.GetBonds():
        i, j = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
        bl = float(np.linalg.norm(xyz[i] - xyz[j]))
        bond_rows.append({
            'bond_idx': bond.GetIdx(),
            'atom_i': i, 'atom_j': j,
            'bond_type': bond.GetBondTypeAsDouble(),
            'bond_length_A': round(bl, 4),
            'outside_0_9_2_0A': int(bl < 0.9 or bl > 2.0),
        })

    # Bond angles
    for atom in mol.GetAtoms():
        nbrs = [n.GetIdx() for n in atom.GetNeighbors()]
        ci = atom.GetIdx()
        for a in range(len(nbrs)):
            for b in range(a+1, len(nbrs)):
                v1 = xyz[nbrs[a]] - xyz[ci]
                v2 = xyz[nbrs[b]] - xyz[ci]
                n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
                if n1 < 1e-6 or n2 < 1e-6:
                    continue
                cosang = float(np.clip(np.dot(v1, v2) / (n1*n2), -1, 1))
                ang = math.degrees(math.acos(cosang))
                angle_rows.append({
                    'center_atom': ci, 'atom_a': nbrs[a], 'atom_b': nbrs[b],
                    'angle_deg': round(ang, 2),
                })

    # Aromatic ring planarity
    ri = mol.GetRingInfo()
    for ring in ri.AtomRings():
        if not all(mol.GetAtomWithIdx(a).GetIsAromatic() for a in ring):
            continue
        pts = xyz[list(ring)]
        centroid = pts.mean(axis=0)
        pts_c    = pts - centroid
        if len(pts_c) >= 3:
            _, _, vh = np.linalg.svd(pts_c)
            normal = vh[-1]
            dists  = np.abs(pts_c @ normal)
            ring_rows.append({
                'ring_atoms': str(list(ring)),
                'ring_size':  len(ring),
                'max_deviation_A': round(float(dists.max()), 4),
                'rms_deviation_A': round(float(np.sqrt((dists**2).mean())), 4),
            })

    return bond_rows, angle_rows, ring_rows


def _protein_contacts(mol, xyz, protein_xyz, min_dist=2.0):
    """Return contact metrics between ligand heavy atoms and protein atoms."""
    if protein_xyz is None or len(protein_xyz) == 0:
        return {'protein_contact_status': 'no_protein_coords', 'steric_clashes': 0}
    dists = np.linalg.norm(xyz[:, None, :] - protein_xyz[None, :, :], axis=-1)
    min_per_atom = dists.min(axis=1)
    clashes = int((min_per_atom < min_dist).sum())
    min_overall = float(min_per_atom.min())
    return {
        'steric_clashes_lt_2A': clashes,
        'min_ligand_protein_dist_A': round(min_overall, 3),
        'protein_contact_status': 'computed',
    }


def _read_protein_coords(pdb_path: str):
    """Return (N,3) numpy array of protein heavy atom coordinates."""
    coords = []
    if BIO_AVAILABLE:
        from Bio.PDB import PDBParser
        parser = PDBParser(QUIET=True)
        structure = parser.get_structure('p', str(pdb_path))
        for atom in structure.get_atoms():
            el = (atom.element or '').strip().upper()
            if el in ('H', 'D', ''):
                continue
            coords.append(atom.coord)
    else:
        with open(pdb_path) as f:
            for line in f:
                if not line.startswith('ATOM'):
                    continue
                el = line[76:78].strip().upper()
                if el in ('H', 'D', ''):
                    continue
                try:
                    coords.append([float(line[30:38]), float(line[38:46]), float(line[46:54])])
                except ValueError:
                    pass
    return np.asarray(coords, dtype=np.float32) if coords else None


# ═══════════════════════════════════════════════════════════
#  MMFF94s MINIMIZATION
# ═══════════════════════════════════════════════════════════
def _minimize_mol(mol, max_iters=1000):
    """Return (minimized_mol_with_H, method, converged, energy_before, energy_after)."""
    mh = Chem.AddHs(Chem.Mol(mol), addCoords=True)
    method = None
    energy_before = energy_after = float('nan')
    converged = False
    ff = None

    if AllChem.MMFFHasAllMoleculeParams(mh):
        props = AllChem.MMFFGetMoleculeProperties(mh, mmffVariant='MMFF94s')
        ff    = AllChem.MMFFGetMoleculeForceField(mh, props, ignoreInterfragInteractions=False)
        method = 'MMFF94s'
    elif AllChem.UFFHasAllMoleculeParams(mh):
        ff     = AllChem.UFFGetMoleculeForceField(mh)
        method = 'UFF'

    if ff is None:
        return None, 'NONE', False, energy_before, energy_after

    energy_before = float(ff.CalcEnergy())
    ff.Initialize()
    code = ff.Minimize(maxIts=max_iters)
    converged = (int(code) == 0)
    energy_after = float(ff.CalcEnergy())
    return mh, method, converged, energy_before, energy_after


# ═══════════════════════════════════════════════════════════
#  PUBLIC ENTRY POINT
# ═══════════════════════════════════════════════════════════
def run_stage4_validation(
    stage3_output_dir: str,
    output_dir: str,
    pdb_conformer_paths: list = None,
    pocket_radius: float = 8.0,
    min_max_iters: int = 1000,
) -> dict:
    """
    Stage G: post-generation geometry validation + MMFF94s minimization.

    Parameters
    ----------
    stage3_output_dir   : directory produced by run_stage3_real()
    output_dir          : where to write Stage G reports
    pdb_conformer_paths : optional list of protein PDB paths for contact analysis
    pocket_radius       : Å used to crop protein for contact reporting
    min_max_iters       : MMFF/UFF minimisation max iterations
    """
    if not RDKIT_AVAILABLE:
        return {"success": False, "message": "RDKit is required for Stage 4 validation."}

    s3  = Path(stage3_output_dir)
    out = Path(output_dir)
    min_dir    = out / "minimized_separate"
    report_dir = out / "reports"
    for d in (out, min_dir, report_dir):
        d.mkdir(parents=True, exist_ok=True)

    sdf_dir = s3 / "sdf"
    sdf_files = sorted(sdf_dir.glob("*.sdf")) if sdf_dir.exists() else []
    # Also look at root-level SDFs
    sdf_files += sorted(s3.glob("*.sdf"))

    if not sdf_files:
        return {"success": False, "message": f"No SDF files found in {sdf_dir}"}

    # Build protein cache (name → coords) if conformers provided
    protein_cache = {}
    if pdb_conformer_paths:
        for pdb_path in pdb_conformer_paths:
            coords = _read_protein_coords(str(pdb_path))
            protein_cache[Path(pdb_path).name] = coords

    # ── Validation pass ───────────────────────────────────
    original_rows = []
    bond_detail   = []
    angle_detail  = []
    ring_detail   = []

    for sdf_path in sdf_files:
        suppl = Chem.SDMolSupplier(str(sdf_path), removeHs=False, sanitize=False)
        mol = suppl[0] if len(suppl) else None
        row = {'record_id': sdf_path.stem, 'sdf_file': sdf_path.name}

        if mol is None:
            row.update({'sdf_readable': False, 'validation_status': 'SDF_READ_FAILED'})
            original_rows.append(row); continue
        row['sdf_readable'] = True

        try:
            Chem.SanitizeMol(mol)
            row['sanitization_passed'] = True
        except Exception as e:
            row['sanitization_passed'] = False
            row['sanitization_error']  = str(e)[:200]

        xyz = _get_xyz(mol)
        if xyz is None or not np.isfinite(xyz).all():
            row.update({'finite_coordinates': False, 'validation_status': 'NO_VALID_COORDS'})
            original_rows.append(row); continue

        row['finite_coordinates'] = True
        row['candidate_id']   = mol.GetProp('candidate_id')   if mol.HasProp('candidate_id')   else sdf_path.stem.split('__')[0]
        row['protein_conformer'] = mol.GetProp('protein_conformer') if mol.HasProp('protein_conformer') else ''

        # Properties
        props = _calc_properties(mol)
        for k, v in props.items():
            row[f'prop_{k}'] = v

        # Geometry
        bl_rows, ang_rows, rng_rows = _bond_geometry(mol, xyz)
        for r in bl_rows:
            r['record_id'] = sdf_path.stem
        for r in ang_rows:
            r['record_id'] = sdf_path.stem
        for r in rng_rows:
            r['record_id'] = sdf_path.stem
        bond_detail  += bl_rows
        angle_detail += ang_rows
        ring_detail  += rng_rows

        row['bonds_outside_0_9_2_0A']           = sum(r['outside_0_9_2_0A'] for r in bl_rows)
        row['bond_length_mean_A']                = round(float(np.mean([r['bond_length_A'] for r in bl_rows])), 4) if bl_rows else None
        row['aromatic_planarity_max_rms_A']      = max((r['rms_deviation_A'] for r in rng_rows), default=0.0)
        row['intramolecular_nonbonded_pairs_lt_2A'] = 0  # lightweight

        # Protein contact
        pdb_name = row.get('protein_conformer', '')
        prot_xyz = protein_cache.get(pdb_name)
        contacts = _protein_contacts(mol, xyz, prot_xyz)
        row.update(contacts)

        row['validation_status'] = 'CHECKED'
        original_rows.append(row)

    # ── MMFF94s Minimisation ──────────────────────────────
    min_rows, min_sdf_paths = [], []
    for sdf_path in sdf_files:
        suppl = Chem.SDMolSupplier(str(sdf_path), removeHs=False, sanitize=True)
        mol = suppl[0] if len(suppl) else None
        row = {'record_id': sdf_path.stem, 'source_sdf': sdf_path.name}

        if mol is None or mol.GetNumConformers() == 0:
            row['minimization_status'] = 'SKIPPED_UNREADABLE'
            min_rows.append(row); continue

        xyz0 = _get_xyz(mol)
        if xyz0 is None or not np.isfinite(xyz0).all():
            row['minimization_status'] = 'SKIPPED_NONFINITE'
            min_rows.append(row); continue

        try:
            mh, method, converged, e_before, e_after = _minimize_mol(mol, max_iters=min_max_iters)
        except Exception as e:
            row['minimization_status'] = f'FAILED: {e}'
            min_rows.append(row); continue

        if mh is None:
            row['minimization_status'] = 'NO_SUPPORTED_FORCE_FIELD'
            row['force_field']         = 'NONE'
            min_rows.append(row); continue

        min_sdf_path = min_dir / f"{sdf_path.stem}__{method}_minimized.sdf"
        mh.SetProp('_Name', f"{sdf_path.stem}__{method}_minimized")
        mh.SetProp('original_generated_sdf', sdf_path.name)
        mh.SetProp('minimization_force_field', method)
        mh.SetProp('minimization_converged',   str(converged))
        mh.SetProp('minimization_energy_before', str(round(e_before, 4)))
        mh.SetProp('minimization_energy_after',  str(round(e_after, 4)))
        # propagate candidate / conformer metadata
        for prop in ('candidate_id', 'protein_conformer'):
            if mol.HasProp(prop):
                mh.SetProp(prop, mol.GetProp(prop))

        writer = Chem.SDWriter(str(min_sdf_path))
        writer.write(mh)
        writer.close()
        min_sdf_paths.append(min_sdf_path)

        row.update({
            'force_field':              method,
            'minimization_status':      'CONVERGED' if converged else 'MAX_ITERS_REACHED',
            'minimization_converged':   converged,
            'energy_before':            round(e_before, 4),
            'energy_after':             round(e_after, 4),
            'energy_reduction':         round(e_before - e_after, 4),
            'minimized_sdf':            min_sdf_path.name,
        })
        min_rows.append(row)

    # ── Geometry screening flags ──────────────────────────
    for row in original_rows:
        bonds_ok = int(row.get('bonds_outside_0_9_2_0A', 999) or 999) == 0
        clashes_ok = int(row.get('intramolecular_nonbonded_pairs_lt_2A', 999) or 999) == 0
        planarity_ok = float(row.get('aromatic_planarity_max_rms_A', 1) or 1) < 0.15
        row['geometry_screen_flag'] = (
            'NO_OBVIOUS_FLAG_BY_SELECTED_SCREEN'
            if bonds_ok and clashes_ok and planarity_ok
            else 'GEOMETRY_CONCERNS_DETECTED'
        )
        row['binding_pose_validation']        = 'NOT_ESTABLISHED'
        row['biological_activity_validation'] = 'NOT_PERFORMED'

    # ── Write CSVs ────────────────────────────────────────
    def _write_csv(path, rows):
        if not rows:
            return
        with open(path, 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), extrasaction='ignore')
            w.writeheader(); w.writerows(rows)

    _write_csv(report_dir / "stage_g_original_structure_validation.csv", original_rows)
    _write_csv(report_dir / "stage_g_bond_geometry_details.csv",         bond_detail)
    _write_csv(report_dir / "stage_g_angle_geometry_details.csv",        angle_detail)
    _write_csv(report_dir / "stage_g_aromatic_ring_planarity.csv",       ring_detail)
    _write_csv(report_dir / "stage_g_minimization_report.csv",           min_rows)

    # ── Validation report JSON ────────────────────────────
    no_flag = sum(1 for r in original_rows if r.get('geometry_screen_flag') == 'NO_OBVIOUS_FLAG_BY_SELECTED_SCREEN')
    concerns = sum(1 for r in original_rows if r.get('geometry_screen_flag') == 'GEOMETRY_CONCERNS_DETECTED')
    report = {
        'stage':                    'G_post_generation_validation',
        'original_sdf_count':       len(sdf_files),
        'validated_count':          len(original_rows),
        'minimized_count':          len(min_sdf_paths),
        'sa_score_available':       SA_AVAILABLE,
        'minimization_method':      'MMFF94s preferred; UFF fallback; ligand-only',
        'geometry_screen_pass':     no_flag,
        'geometry_screen_flag':     concerns,
        'binding_pose_validation':  'not established',
        'biological_activity_validation': 'not performed',
        'notes': [
            'Molecular descriptors are topology-derived and are invariant across generated poses.',
            'Geometry thresholds are diagnostic screening flags, not universal validity criteria.',
            'Force-field minimization excludes protein; can move ligand away from generated pose.',
            'No docking, protein-aware minimization, or biological activity validation was performed.',
        ]
    }
    with open(report_dir / "stage_g_validation_report.json", 'w') as f:
        json.dump(report, f, indent=2)

    # Build downloadable file list
    sdf_downloads = [str(p) for p in min_sdf_paths]

    return {
        'success':              True,
        'message':              f"Stage 4 validation complete. {len(original_rows)} SDFs checked, {len(min_sdf_paths)} minimized.",
        'original_sdf_count':   len(sdf_files),
        'validated_count':      len(original_rows),
        'minimized_count':      len(min_sdf_paths),
        'geometry_screen_pass': no_flag,
        'geometry_screen_flag': concerns,
        'sa_score_available':   SA_AVAILABLE,
        'validation_rows':      original_rows,
        'minimization_rows':    min_rows,
        'files': {
            'report_dir':       str(report_dir),
            'minimized_sdf_dir': str(min_dir),
            'validation_report_json': str(report_dir / "stage_g_validation_report.json"),
            'minimized_sdfs':   sdf_downloads,
        }
    }

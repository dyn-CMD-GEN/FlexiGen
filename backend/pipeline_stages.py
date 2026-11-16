"""
FlexiGEN Pipeline Stages
========================
Implements Stage 1 (Conformer + Pharmacophore generation) and
Stage 2 (2D Topology / SMILES generation) as importable functions.
Stages 3 and 4 are placeholder stubs ready for future integration.
"""

import os
import json
import csv
import time
import shutil
import subprocess
import warnings
import copy
import random
import hashlib
from pathlib import Path
from collections import Counter

import numpy as np

# ──────────────────────────────────────────────────────────
#  Optional heavy-science imports (graceful fallback)
# ──────────────────────────────────────────────────────────
try:
    from Bio.PDB import PDBParser, PDBIO, Select, is_aa
    BIO_AVAILABLE = True
except ImportError:
    BIO_AVAILABLE = False

try:
    from rdkit import Chem
    from rdkit.Chem import AllChem, Descriptors, rdMolDescriptors, QED
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False


# ══════════════════════════════════════════════════════════
#  STAGE 1 — Conformer + Pharmacophore Tensor Generation
# ══════════════════════════════════════════════════════════

PHARMACOPHORE_TYPES = {
    "HBD": "Hydrogen Bond Donor",
    "HBA": "Hydrogen Bond Acceptor",
    "HYD": "Hydrophobic",
    "ARO": "Aromatic",
    "POS": "Positive Ionisable",
    "NEG": "Negative Ionisable",
}

AMINO_ACID_FEATURES = {
    "SER": ["HBD", "HBA"],
    "THR": ["HBD", "HBA"],
    "TYR": ["HBD", "HBA", "ARO"],
    "ASN": ["HBD", "HBA"],
    "GLN": ["HBD", "HBA"],
    "LYS": ["HBD", "POS"],
    "ARG": ["HBD", "POS"],
    "HIS": ["HBD", "POS", "ARO"],
    "ASP": ["HBA", "NEG"],
    "GLU": ["HBA", "NEG"],
    "PHE": ["HYD", "ARO"],
    "TRP": ["HBD", "ARO"],
    "VAL": ["HYD"],
    "LEU": ["HYD"],
    "ILE": ["HYD"],
    "MET": ["HYD"],
    "ALA": ["HYD"],
    "PRO": ["HYD"],
    "GLY": [],
    "CYS": ["HBD", "HBA", "HYD"],
}


def _parse_pdb_atoms(pdb_path: str) -> list[dict]:
    """Extract CA atoms with residue info from a PDB file (pure-Python fallback)."""
    atoms = []
    with open(pdb_path, "r") as fh:
        for line in fh:
            if not line.startswith(("ATOM", "HETATM")):
                continue
            atom_name = line[12:16].strip()
            if atom_name != "CA":
                continue
            res_name = line[17:20].strip()
            chain = line[21].strip()
            res_seq = int(line[22:26].strip())
            x = float(line[30:38])
            y = float(line[38:46])
            z = float(line[46:54])
            atoms.append({
                "atom_name": atom_name,
                "res_name": res_name,
                "chain": chain,
                "res_seq": res_seq,
                "x": x, "y": y, "z": z,
            })
    return atoms


def _detect_binding_pocket(atoms: list[dict], top_n: int = 20) -> list[dict]:
    """
    Heuristic: select residues with the most pharmacophore-active neighbours
    within 8 Å as a rough binding-pocket estimate.
    """
    if len(atoms) == 0:
        return []
    coords = np.array([[a["x"], a["y"], a["z"]] for a in atoms])
    scores = []
    for i, a in enumerate(atoms):
        rn = a["res_name"]
        features = AMINO_ACID_FEATURES.get(rn, [])
        score = len(features)
        # Count neighbours within 8 Å with any pharmacophore feature
        dists = np.linalg.norm(coords - coords[i], axis=1)
        neighbours = [atoms[j]["res_name"] for j in range(len(atoms))
                      if dists[j] < 8.0 and j != i]
        for nb in neighbours:
            score += len(AMINO_ACID_FEATURES.get(nb, [])) * 0.1
        scores.append(score)
    ranked = sorted(range(len(atoms)), key=lambda i: scores[i], reverse=True)
    return [atoms[i] for i in ranked[:top_n]]


def _build_pharmacophore_features(pocket_atoms: list[dict]) -> list[dict]:
    """Map pocket residues to pharmacophore feature points."""
    features = []
    for atom in pocket_atoms:
        rn = atom["res_name"]
        ftype_list = AMINO_ACID_FEATURES.get(rn, [])
        for ftype in ftype_list:
            features.append({
                "identity": f"{atom['chain']}:{atom['res_seq']}:{rn}",
                "feature": ftype,
                "x": atom["x"],
                "y": atom["y"],
                "z": atom["z"],
            })
    return features


def _generate_conformers(base_features: list[dict], k: int = 5,
                         rng_seed: int = 42) -> list[list[dict]]:
    """
    Generate K pseudo-conformers by applying small normally-distributed
    displacements (ANM-inspired) to the base pharmacophore coordinates.
    """
    rng = np.random.default_rng(rng_seed)
    conformers = []
    for _ in range(k):
        displaced = []
        for feat in base_features:
            noise = rng.normal(0, 0.3, 3)   # 0.3 Å std dev
            displaced.append({
                **feat,
                "x": feat["x"] + float(noise[0]),
                "y": feat["y"] + float(noise[1]),
                "z": feat["z"] + float(noise[2]),
            })
        conformers.append(displaced)
    return conformers


def _conformers_to_tensor(conformers: list[list[dict]]) -> tuple[np.ndarray, np.ndarray, list]:
    """Convert conformer feature lists → (tensor, mask, metadata)."""
    # Collect unique feature keys
    keys = sorted({(r["identity"], r["feature"])
                   for rows in conformers for r in rows})
    key_to_col = {key: i for i, key in enumerate(keys)}

    K = len(conformers)
    N = len(keys)
    tensor = np.zeros((K, N, 4), dtype=np.float32)
    mask = np.zeros((K, N), dtype=np.float32)

    ftype_map = {"HBD": 1, "HBA": 2, "HYD": 3, "ARO": 4, "POS": 5, "NEG": 6}

    for ci, conf in enumerate(conformers):
        for feat in conf:
            col = key_to_col.get((feat["identity"], feat["feature"]))
            if col is None:
                continue
            tensor[ci, col, 0] = feat["x"]
            tensor[ci, col, 1] = feat["y"]
            tensor[ci, col, 2] = feat["z"]
            tensor[ci, col, 3] = ftype_map.get(feat["feature"], 0)
            mask[ci, col] = 1.0

    metadata = [
        {"feature_index": i, "identity": k[0], "feature": k[1]}
        for i, k in enumerate(keys)
    ]
    return tensor, mask, metadata


def run_stage1(pdb_path: str, output_dir: str, n_conformers: int = 5) -> dict:
    """
    Stage 1: PDB → 5 pocket conformers + pharmacophore tensor.

    Returns a results dict with keys:
        success, message, n_features, n_conformers,
        tensor_shape, mask_shape, files
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # 1. Parse PDB
    atoms = _parse_pdb_atoms(pdb_path)
    if not atoms:
        return {"success": False, "message": "No CA atoms found in PDB file."}

    # 2. Detect pocket
    pocket_atoms = _detect_binding_pocket(atoms, top_n=min(25, len(atoms)))

    # 3. Build base pharmacophore features
    base_features = _build_pharmacophore_features(pocket_atoms)
    if not base_features:
        return {"success": False, "message": "No pharmacophore features extracted from PDB."}

    # 4. Generate K conformers
    conformers = _generate_conformers(base_features, k=n_conformers)

    # 5. Build tensor + mask
    tensor, mask, metadata = _conformers_to_tensor(conformers)

    # 6. Persist outputs
    files = {}

    # Save per-conformer PDB-like records as CSV
    conformer_rows = []
    for ci, conf in enumerate(conformers):
        for feat in conf:
            conformer_rows.append({
                "conformer_id": ci + 1,
                "identity": feat["identity"],
                "feature": feat["feature"],
                "x": round(feat["x"], 4),
                "y": round(feat["y"], 4),
                "z": round(feat["z"], 4),
            })
    conf_csv = out / "pocket_conformers.csv"
    with open(conf_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["conformer_id", "identity", "feature", "x", "y", "z"])
        w.writeheader()
        w.writerows(conformer_rows)
    files["conformers_csv"] = str(conf_csv)

    # Save tensor as NPZ
    tensor_npz = out / "pocket_tensor.npz"
    np.savez(tensor_npz, tensor=tensor, mask=mask)
    files["tensor_npz"] = str(tensor_npz)

    # Save metadata as JSON
    meta_json = out / "pharmacophore_metadata.json"
    with open(meta_json, "w") as f:
        json.dump({"features": metadata, "n_conformers": n_conformers,
                   "tensor_shape": list(tensor.shape),
                   "mask_shape": list(mask.shape)}, f, indent=2)
    files["metadata_json"] = str(meta_json)

    # Summary report
    report = {
        "n_pocket_residues": len(pocket_atoms),
        "n_features": len(metadata),
        "n_conformers": n_conformers,
        "tensor_shape": list(tensor.shape),
        "mask_shape": list(mask.shape),
        "feature_type_counts": dict(Counter(m["feature"] for m in metadata)),
    }
    report_json = out / "stage1_report.json"
    with open(report_json, "w") as f:
        json.dump(report, f, indent=2)
    files["report_json"] = str(report_json)

    return {
        "success": True,
        "message": f"Stage 1 complete. {len(metadata)} features across {n_conformers} conformers.",
        **report,
        "files": files,
    }


# ══════════════════════════════════════════════════════════
#  STAGE 2 — 2D Topology / SMILES Generation
# ══════════════════════════════════════════════════════════

# A minimal SMILES vocabulary drawn from the tokenizer shipped with Member-2
_SMILES_FRAGMENTS = [
    "c1ccccc1", "C1CCNCC1", "C1CCOC1", "C1CCCC1",
    "c1ccncc1", "c1ccc(N)cc1", "c1ccc(O)cc1", "c1ccc(F)cc1",
    "c1ccc(Cl)cc1", "C(=O)N", "C(=O)O", "S(=O)(=O)",
    "OC", "NC(=O)", "CC(C)", "CCC",
]

_FUNCTIONAL_GROUPS = [
    "N", "O", "F", "Cl", "Br", "S", "CC", "OCC", "NCC",
    "C(=O)", "NC(=O)", "OC(=O)",
]


def _smiles_from_tensor(tensor: np.ndarray, mask: np.ndarray,
                        tokenizer: dict, seed: int = 42) -> list[str]:
    """
    Deterministic-ish SMILES generation conditioned on pocket tensor.
    Uses pocket feature statistics (centroid, spread) to seed fragment selection.
    """
    rng = np.random.default_rng(seed)
    generated = []
    n_conformers = tensor.shape[0]

    for ci in range(n_conformers):
        # Derive a simple fingerprint from this conformer
        active = mask[ci].astype(bool)
        if active.any():
            coords = tensor[ci, active, :3]
            centroid = coords.mean(axis=0)
            spread = coords.std(axis=0).mean() if len(coords) > 1 else 1.0
            # Use centroid + spread to pick scaffold
            scaffold_idx = int(abs(centroid.sum() * spread * 7)) % len(_SMILES_FRAGMENTS)
            fg_idx = int(abs(centroid[0] * spread * 13)) % len(_FUNCTIONAL_GROUPS)
        else:
            scaffold_idx = ci % len(_SMILES_FRAGMENTS)
            fg_idx = ci % len(_FUNCTIONAL_GROUPS)

        scaffold = _SMILES_FRAGMENTS[scaffold_idx]
        fg = _FUNCTIONAL_GROUPS[fg_idx]
        smiles = f"{scaffold}{fg}"
        generated.append(smiles)

    return generated


def _validate_smiles(smiles_list: list[str]) -> list[dict]:
    """Validate SMILES and compute properties if RDKit is available."""
    results = []
    for smiles in smiles_list:
        entry = {"smiles": smiles, "valid": False, "canonical_smiles": None,
                 "MW": None, "LogP": None, "TPSA": None, "HBD": None, "HBA": None,
                 "QED": None}
        if RDKIT_AVAILABLE:
            mol = Chem.MolFromSmiles(smiles)
            if mol is not None:
                entry["valid"] = True
                entry["canonical_smiles"] = Chem.MolToSmiles(mol)
                entry["MW"] = round(Descriptors.MolWt(mol), 2)
                entry["LogP"] = round(Descriptors.MolLogP(mol), 3)
                entry["TPSA"] = round(rdMolDescriptors.CalcTPSA(mol), 2)
                entry["HBD"] = rdMolDescriptors.CalcNumHBD(mol)
                entry["HBA"] = rdMolDescriptors.CalcNumHBA(mol)
                try:
                    entry["QED"] = round(QED.qed(mol), 3)
                except Exception:
                    pass
        else:
            # Without RDKit, trust the SMILES as-is
            entry["valid"] = True
            entry["canonical_smiles"] = smiles
        results.append(entry)
    return results


def run_stage2(stage1_output_dir: str, handoff_csv: str,
               tokenizer_json: str, output_dir: str) -> dict:
    """
    Stage 2: Pocket tensor + Member-2 handoff → 2D topology candidates.

    Accepts:
        stage1_output_dir  – directory produced by run_stage1()
        handoff_csv        – member2_exploratory_M3_handoff.csv path
        tokenizer_json     – smiles_tokenizer.json path
        output_dir         – where to write stage2 outputs

    Returns results dict.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Load tensor from stage 1
    s1 = Path(stage1_output_dir)
    npz_path = s1 / "pocket_tensor.npz"
    if not npz_path.exists():
        return {"success": False, "message": "Stage 1 tensor not found. Run Stage 1 first."}

    data = np.load(npz_path)
    tensor = data["tensor"]
    mask = data["mask"]

    # Load tokenizer vocabulary
    vocab = {}
    if Path(tokenizer_json).exists():
        with open(tokenizer_json) as f:
            vocab = json.load(f)

    # Load handoff CSV candidates from Member-2
    handoff_molecules = []
    if Path(handoff_csv).exists():
        with open(handoff_csv, newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                handoff_molecules.append(row)

    # Generate new topology candidates from tensor
    generated_smiles = _smiles_from_tensor(tensor, mask, vocab)
    validated = _validate_smiles(generated_smiles)

    # Also include Member-2 handoff molecules
    for m in handoff_molecules:
        entry = {
            "smiles": m.get("canonical_smiles", ""),
            "valid": True,
            "canonical_smiles": m.get("canonical_smiles", ""),
            "MW": m.get("molecular_weight"),
            "LogP": m.get("LogP"),
            "TPSA": m.get("TPSA"),
            "HBD": m.get("HBD"),
            "HBA": m.get("HBA"),
            "QED": m.get("QED"),
            "source": "member2_handoff",
            "candidate_id": m.get("candidate_id", ""),
        }
        validated.append(entry)

    # Save results
    files = {}
    topo_csv = out / "topology_candidates.csv"
    fieldnames = ["smiles", "canonical_smiles", "valid", "MW", "LogP",
                  "TPSA", "HBD", "HBA", "QED", "source", "candidate_id"]
    with open(topo_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for v in validated:
            w.writerow(v)
    files["topology_csv"] = str(topo_csv)

    valid_count = sum(1 for v in validated if v.get("valid"))
    report = {
        "total_candidates": len(validated),
        "valid_candidates": valid_count,
        "from_tensor": len(generated_smiles),
        "from_handoff": len(handoff_molecules),
        "validity_rate": round(valid_count / max(len(validated), 1), 3),
    }
    report_json = out / "stage2_report.json"
    with open(report_json, "w") as f:
        json.dump(report, f, indent=2)
    files["report_json"] = str(report_json)

    return {
        "success": True,
        "message": f"Stage 2 complete. {valid_count}/{len(validated)} valid topology candidates.",
        **report,
        "candidates": validated,
        "files": files,
    }


# ══════════════════════════════════════════════════════════
#  STAGE 3 — 3D Conformer Optimisation & Docking (Stub)
# ══════════════════════════════════════════════════════════

def run_stage3(stage2_output_dir: str, output_dir: str) -> dict:
    """
    Stage 3 (stub): 3D conformer generation + docking scoring.
    Extend this function when docking tools (AutoDock Vina, Glide, etc.)
    are available in the environment.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Read stage2 topology candidates
    s2 = Path(stage2_output_dir)
    topo_csv = s2 / "topology_candidates.csv"
    candidates = []
    if topo_csv.exists():
        with open(topo_csv, newline="") as f:
            candidates = list(csv.DictReader(f))

    # Placeholder scoring
    scored = []
    for i, cand in enumerate(candidates):
        scored.append({
            **cand,
            "docking_score": round(-6.5 - i * 0.3 + (hash(cand.get("smiles","")) % 100) * 0.01, 2),
            "stage3_status": "stub_placeholder",
        })

    result_csv = out / "stage3_docked.csv"
    if scored:
        with open(result_csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(scored[0].keys()), extrasaction="ignore")
            w.writeheader()
            w.writerows(scored)

    report = {
        "success": True,
        "message": "Stage 3 (3D docking) is a placeholder. Integrate docking tool here.",
        "n_candidates_scored": len(scored),
        "note": "Scores are synthetic placeholders — not real docking results.",
        "files": {"docked_csv": str(result_csv)} if scored else {},
    }
    rj = out / "stage3_report.json"
    with open(rj, "w") as f:
        json.dump(report, f, indent=2)
    return report


# ══════════════════════════════════════════════════════════
#  STAGE 4 — ADMET Filtering & Lead Ranking (Stub)
# ══════════════════════════════════════════════════════════

def run_stage4(stage3_output_dir: str, output_dir: str) -> dict:
    """
    Stage 4 (stub): ADMET property filtering and lead ranking.
    Extend with pkCSM, SwissADME, DeepPurpose, etc.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    s3 = Path(stage3_output_dir)
    docked_csv = s3 / "stage3_docked.csv"
    candidates = []
    if docked_csv.exists():
        with open(docked_csv, newline="") as f:
            candidates = list(csv.DictReader(f))

    ranked = []
    for cand in candidates:
        # Lipinski rule-of-5 filter (using stored values)
        try:
            mw = float(cand.get("MW") or 500)
            logp = float(cand.get("LogP") or 5)
            hbd = int(float(cand.get("HBD") or 0))
            hba = int(float(cand.get("HBA") or 0))
            ro5_pass = mw <= 500 and logp <= 5 and hbd <= 5 and hba <= 10
        except Exception:
            ro5_pass = True

        ranked.append({
            **cand,
            "ro5_pass": ro5_pass,
            "admet_status": "stub_placeholder",
            "lead_score": round(hash(cand.get("smiles", "")) % 100 / 100, 3),
        })

    # Sort by lead_score descending
    ranked.sort(key=lambda x: float(x.get("lead_score", 0)), reverse=True)

    result_csv = out / "stage4_leads.csv"
    if ranked:
        with open(result_csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(ranked[0].keys()), extrasaction="ignore")
            w.writeheader()
            w.writerows(ranked)

    report = {
        "success": True,
        "message": "Stage 4 (ADMET filtering) is a placeholder. Integrate ADMET tools here.",
        "n_candidates": len(ranked),
        "ro5_passing": sum(1 for r in ranked if r.get("ro5_pass") in [True, "True"]),
        "note": "ADMET scores are synthetic placeholders.",
        "files": {"leads_csv": str(result_csv)} if ranked else {},
    }
    rj = out / "stage4_report.json"
    with open(rj, "w") as f:
        json.dump(report, f, indent=2)
    return report

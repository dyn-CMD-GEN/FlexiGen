"""
cdi_ranking.py — Composite Docking Index (CDI) Ranking for FlexiGEN
=====================================================================
Computes a weighted, normalised composite score from multiple docking
and physicochemical metrics to rank final drug candidates.

CDI Score (lower = better lead compound):
  CDI = w_vina   * rank_vina
      + w_cnn    * rank_gnina_affinity      (inverted: higher affinity → better)
      + w_rmsd   * rank_rmsd                (lower RMSD → better stability)
      + w_energy * rank_energy_change       (more negative ΔE → better)
      + w_qc     * qc_penalty               (QC flag/reject → penalty)
      + w_lipo   * rank_logp_norm           (Lipinski-range logP preferred)
      + w_mw     * rank_mw_norm             (MW 300–500 preferred)

All individual rankings are min–max normalised to [0, 1] so weights
are interpretable as relative importance.  Ties share their mean rank.

Usage:
    from cdi_ranking import compute_cdi_ranking, compute_rdkit_props

Output columns appended to each record:
    cdi_score           float   composite score (0–1; lower = better)
    cdi_rank            int     1 = best candidate
    rank_vina           float   normalised Vina rank (0–1)
    rank_gnina          float   normalised GNINA CNN-affinity rank (0–1)
    rank_rmsd           float   normalised RMSD rank (0–1)
    rank_energy         float   normalised ΔE rank (0–1)
    mw                  float   molecular weight (Da)
    logp                float   Wildman–Crippen logP
    hbd                 int     H-bond donors
    hba                 int     H-bond acceptors
    tpsa                float   topological polar surface area (Å²)
    lipinski_pass       bool    Lipinski Ro5 pass
    cdi_tier            str     "Tier 1 / 2 / 3" label
    final_verdict       str     human-readable summary verdict
"""

import math
import csv
import json
from pathlib import Path
from typing import List, Dict, Any, Optional


# ─────────────────────────────────────────────────────────────────
#  Default CDI weights  (sum need NOT equal 1 — they are relative)
# ─────────────────────────────────────────────────────────────────
DEFAULT_WEIGHTS = {
    "w_vina":   0.25,   # AutoDock Vina score (binding affinity proxy)
    "w_gnina":  0.20,   # GNINA CNNaffinity (deep-learning affinity)
    "w_rmsd":   0.15,   # Ligand RMSD after OpenMM relaxation (pose stability)
    "w_energy": 0.10,   # OpenMM ΔE minimisation (complex stability)
    "w_qc":     0.10,   # QC verdict penalty
    "w_qed":    0.08,   # Quantitative Estimate of Drug-likeness (0–1, higher=better)
    "w_sas":    0.05,   # Synthetic Accessibility Score (1–10, lower=better)
    "w_tox":    0.04,   # Toxicity / PAINS / Brenk structural alert penalty
    "w_lipo":   0.02,   # Lipophilicity (logP) drug-likeness
    "w_mw":     0.01,   # Molecular weight drug-likeness
}

# QC verdict → penalty applied to the QC component rank (0 = best, 1 = worst)
QC_PENALTY = {
    "PASS_QC":          0.00,
    "PASS":             0.00,
    "FLAG_ENERGY":      0.40,
    "FLAG_RMSD":        0.40,
    "FLAG_ENERGY_RMSD": 0.60,
    "REJECT_VINA":      0.80,
    "REJECT_QC":        0.80,
    "REJECT":           0.90,
    "ERROR":            1.00,
    "SKIPPED":          0.50,
}

# Lipinski Ro5 thresholds
LIPINSKI = dict(mw_max=500, logp_max=5.0, hbd_max=5, hba_max=10)

# Preferred drug-like ranges for normalised penalty
IDEAL_MW_LOW,  IDEAL_MW_HIGH  = 300, 500
IDEAL_LOGP_LOW, IDEAL_LOGP_HIGH = 1.0, 3.5

# Lazy-loaded SAS and FilterCatalog
_SAS_AVAILABLE = False
_TOX_CATALOG = None
try:
    import os, sys
    from rdkit.Chem import RDConfig
    sa_path = os.path.join(RDConfig.RDContribDir, 'SA_Score')
    if sa_path not in sys.path:
        sys.path.append(sa_path)
    import sascorer
    _SAS_AVAILABLE = True
except Exception:
    pass

try:
    from rdkit.Chem.FilterCatalog import FilterCatalog, FilterCatalogParams
    _fparams = FilterCatalogParams()
    _fparams.AddCatalog(FilterCatalogParams.FilterCatalogs.PAINS)
    _fparams.AddCatalog(FilterCatalogParams.FilterCatalogs.BRENK)
    _TOX_CATALOG = FilterCatalog(_fparams)
except Exception:
    pass


# ─────────────────────────────────────────────────────────────────
#  RDKit physicochemical & drug-likeness property computation
# ─────────────────────────────────────────────────────────────────
def compute_rdkit_props(smiles: str) -> Dict[str, Any]:
    """
    Compute MW, logP, HBD, HBA, TPSA, rotatable bonds, Lipinski Ro5,
    QED (drug-likeness), SAS (synthetic accessibility), Fsp3, and
    toxicity/structural alerts (PAINS & Brenk filters).
    """
    props: Dict[str, Any] = {}
    if not smiles or not str(smiles).strip():
        return props
    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors, rdMolDescriptors, Lipinski, QED

        mol = Chem.MolFromSmiles(str(smiles).strip())
        if mol is None or mol.GetNumAtoms() == 0:
            return props

        mw           = round(Descriptors.MolWt(mol), 2)
        logp         = round(Descriptors.MolLogP(mol), 3)
        hbd          = int(Lipinski.NumHDonors(mol))
        hba          = int(Lipinski.NumHAcceptors(mol))
        tpsa         = round(rdMolDescriptors.CalcTPSA(mol), 2)
        rot_bonds    = int(rdMolDescriptors.CalcNumRotatableBonds(mol))
        n_rings      = int(rdMolDescriptors.CalcNumRings(mol))
        n_aromrings  = int(rdMolDescriptors.CalcNumAromaticRings(mol))
        fsp3         = round(rdMolDescriptors.CalcFractionCSP3(mol), 3)

        # QED: Quantitative Estimate of Drug-likeness
        try:
            qed = round(float(QED.default(mol)), 3)
        except Exception:
            qed = None

        # SAS: Synthetic Accessibility Score
        sas = None
        if _SAS_AVAILABLE:
            try:
                sas = round(float(sascorer.calculateScore(mol)), 2)
            except Exception:
                sas = None

        # Toxicity / PAINS / Brenk structural alerts
        tox_alerts_list = []
        if _TOX_CATALOG is not None:
            try:
                matches = _TOX_CATALOG.GetMatches(mol)
                tox_alerts_list = [m.GetDescription() for m in matches]
            except Exception:
                tox_alerts_list = []

        tox_count = len(tox_alerts_list)
        if tox_count == 0:
            tox_risk = "Low (Clean)"
            tox_str  = "Clean (0 alerts)"
        elif tox_count <= 2:
            tox_risk = "Moderate"
            tox_str  = f"{tox_count} alert(s): " + "; ".join(tox_alerts_list)
        else:
            tox_risk = "High"
            tox_str  = f"{tox_count} alerts: " + "; ".join(tox_alerts_list)

        lipinski_pass = bool(
            mw   <= LIPINSKI["mw_max"]  and
            logp <= LIPINSKI["logp_max"] and
            hbd  <= LIPINSKI["hbd_max"]  and
            hba  <= LIPINSKI["hba_max"]
        )
        veber_pass = bool(rot_bonds <= 10 and tpsa <= 140.0)

        props = {
            "mw":              mw,
            "logp":            logp,
            "hbd":             hbd,
            "hba":             hba,
            "tpsa":            tpsa,
            "rot_bonds":       rot_bonds,
            "n_rings":         n_rings,
            "n_aromrings":     n_aromrings,
            "fsp3":            fsp3,
            "qed":             qed,
            "sas":             sas,
            "tox_risk":        tox_risk,
            "tox_alerts":      tox_str,
            "tox_alert_count": tox_count,
            "lipinski_pass":   lipinski_pass,
            "veber_pass":      veber_pass,
        }
    except Exception:
        pass
    return props


def _safe_float(val, default: float = None):
    """Return float or default if val is None / empty / 'None' / NaN."""
    if val is None:
        return default
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (ValueError, TypeError):
        return default


def _minmax_norm(values: List[Optional[float]], invert: bool = False) -> List[float]:
    """
    Min–max normalise a list (None → mean of valid values).
    invert=True flips the scale so higher raw value → better (lower normalised rank).
    """
    valid = [v for v in values if v is not None]
    if not valid:
        return [0.5] * len(values)

    lo, hi = min(valid), max(valid)
    span = hi - lo if hi != lo else 1.0

    filled = [v if v is not None else (sum(valid) / len(valid)) for v in values]
    normed = [(v - lo) / span for v in filled]

    if invert:
        normed = [1.0 - n for n in normed]
    return normed


def _mw_penalty(mw: Optional[float]) -> float:
    """0 = ideal MW range (300–500), 1 = extremely far from ideal."""
    if mw is None:
        return 0.5
    if IDEAL_MW_LOW <= mw <= IDEAL_MW_HIGH:
        return 0.0
    deviation = max(IDEAL_MW_LOW - mw, mw - IDEAL_MW_HIGH)
    return min(1.0, deviation / 300.0)


def _logp_penalty(logp: Optional[float]) -> float:
    """0 = ideal logP range (1–3.5), 1 = very lipophilic or hydrophilic."""
    if logp is None:
        return 0.5
    if IDEAL_LOGP_LOW <= logp <= IDEAL_LOGP_HIGH:
        return 0.0
    deviation = max(IDEAL_LOGP_LOW - logp, logp - IDEAL_LOGP_HIGH)
    return min(1.0, deviation / 4.0)


# ─────────────────────────────────────────────────────────────────
#  Main CDI computation
# ─────────────────────────────────────────────────────────────────
def compute_cdi_ranking(
    records: List[Dict[str, Any]],
    weights: Dict[str, float] = None,
    smiles_key: str = "smiles",
) -> List[Dict[str, Any]]:
    """
    Compute CDI scores and append ranking columns to each record dict.

    Parameters
    ----------
    records   : list of dicts — one per docking candidate.
                Expected keys (all optional with graceful fallback):
                  candidate_id, smiles, vina_score_kcal_mol,
                  gnina_CNNaffinity, gnina_CNNscore,
                  final_ligand_rmsd_A, energy_change_kJ_mol, qc_verdict
    weights   : CDI component weights dict (defaults to DEFAULT_WEIGHTS)
    smiles_key: key name for SMILES string in record dict

    Returns
    -------
    List of enriched record dicts, sorted by cdi_rank ascending (best first).
    """
    if not records:
        return []

    W = {**DEFAULT_WEIGHTS, **(weights or {})}
    # Normalise weights so they sum to 1
    total_w = sum(W.values()) or 1.0
    W = {k: v / total_w for k, v in W.items()}

    n = len(records)

    # ── Extract raw metric vectors ──────────────────────────────
    vina_scores  = [_safe_float(r.get("vina_score_kcal_mol") or r.get("vina_top_score") or r.get("vina_score") or r.get("gnina_vina_score")) for r in records]
    gnina_aff    = [_safe_float(r.get("gnina_CNNaffinity") or r.get("CNNaffinity")) for r in records]
    rmsd_vals    = [_safe_float(r.get("final_ligand_rmsd_A") or r.get("rmsd")) for r in records]
    energy_vals  = [_safe_float(r.get("energy_change_kJ_mol") or r.get("energy_after") or r.get("energy_reduction")) for r in records]
    qc_verdicts  = [str(r.get("qc_verdict") or r.get("geometry_screen_flag") or "").upper() for r in records]

    has_docking = any(v is not None for v in vina_scores) or any(g is not None for g in gnina_aff)

    # ── Normalised ranks (0=best, 1=worst) ─────────────────────
    # Vina: lower (more negative) = better → invert=False on ascending sort
    rank_vina   = _minmax_norm(vina_scores,  invert=False)
    # GNINA affinity: higher = better → invert=True
    rank_gnina  = _minmax_norm(gnina_aff,    invert=True)
    # RMSD: lower = better → invert=False
    rank_rmsd   = _minmax_norm(rmsd_vals,    invert=False)
    # Energy change: more negative = better → invert=False (already ascending)
    rank_energy = _minmax_norm(energy_vals,  invert=False)
    # QC penalty: look up from table
    rank_qc     = [QC_PENALTY.get(v, 0.5) for v in qc_verdicts]

    # Additional geometry ranks for pre-docking fallback
    rank_clash = _minmax_norm([
        _safe_float(r.get("steric_clashes_lt_2A") or (10.0 if str(r.get("has_protein_clash")).lower() in ("true", "1") else 0.0), 0.0)
        for r in records
    ], invert=False)
    rank_geom_bond = _minmax_norm([
        abs(_safe_float(r.get("bond_length_mean_A"), 1.45) - 1.45) for r in records
    ], invert=False)

    # ── Physicochemical properties & drug-likeness ──────────────
    for r in records:
        smiles = r.get(smiles_key) or r.get("smiles") or r.get("canonical_smiles") or ""
        props = compute_rdkit_props(smiles)
        if props:
            r.update(props)
        else:
            # Fallback to existing properties in record if available
            mw = _safe_float(r.get("mw") or r.get("prop_Molecular_Weight") or r.get("MW"))
            logp = _safe_float(r.get("logp") or r.get("prop_LogP") or r.get("LogP"))
            hbd = _safe_float(r.get("hbd") or r.get("prop_HBD") or r.get("HBD"))
            hba = _safe_float(r.get("hba") or r.get("prop_HBA") or r.get("HBA"))
            tpsa = _safe_float(r.get("tpsa") or r.get("prop_TPSA") or r.get("TPSA"))
            if mw is not None:
                r["mw"] = round(mw, 2)
            if logp is not None:
                r["logp"] = round(logp, 3)
            if hbd is not None:
                r["hbd"] = int(hbd)
            if hba is not None:
                r["hba"] = int(hba)
            if tpsa is not None:
                r["tpsa"] = round(tpsa, 2)
            if mw is not None and logp is not None:
                r["lipinski_pass"] = bool(
                    mw <= LIPINSKI["mw_max"] and
                    logp <= LIPINSKI["logp_max"] and
                    (hbd is None or hbd <= LIPINSKI["hbd_max"]) and
                    (hba is None or hba <= LIPINSKI["hba_max"])
                )

    mw_penalties   = [_mw_penalty(r.get("mw"))    for r in records]
    logp_penalties = [_logp_penalty(r.get("logp")) for r in records]

    # Drug-likeness & ADMET metrics normalisation
    qed_scores   = [_safe_float(r.get("qed")) for r in records]
    sas_scores   = [_safe_float(r.get("sas")) for r in records]
    tox_counts   = [_safe_float(r.get("tox_alert_count"), 0.0) for r in records]

    # QED: higher = better → invert=True
    rank_qed     = _minmax_norm(qed_scores, invert=True)
    # SAS: lower (easier synthesis) = better → invert=False
    rank_sas     = _minmax_norm(sas_scores, invert=False)
    # Toxicity penalty: 0 alerts = 0.0, 1 alert = 0.4, 2+ alerts = 0.8+
    rank_tox     = [min(1.0, float(c) * 0.4) for c in tox_counts]

    # ── Composite CDI score ─────────────────────────────────────
    cdi_scores = []
    for i in range(n):
        if has_docking:
            cdi = (
                W.get("w_vina", 0.25)   * rank_vina[i]   +
                W.get("w_gnina", 0.20)  * rank_gnina[i]  +
                W.get("w_rmsd", 0.15)   * rank_rmsd[i]   +
                W.get("w_energy", 0.10) * rank_energy[i] +
                W.get("w_qc", 0.10)     * rank_qc[i]     +
                W.get("w_qed", 0.08)    * rank_qed[i]    +
                W.get("w_sas", 0.05)    * rank_sas[i]    +
                W.get("w_tox", 0.04)    * rank_tox[i]    +
                W.get("w_lipo", 0.02)   * logp_penalties[i] +
                W.get("w_mw", 0.01)     * mw_penalties[i]
            )
        else:
            # Pre-docking adaptive scoring based on MMFF energy, clash freedom, bond realism, QED, SAS & Ro5
            cdi = (
                0.25 * rank_energy[i] +
                0.20 * rank_clash[i] +
                0.15 * rank_geom_bond[i] +
                0.15 * rank_qc[i] +
                0.10 * rank_qed[i] +
                0.05 * rank_sas[i] +
                0.05 * rank_tox[i] +
                0.03 * logp_penalties[i] +
                0.02 * mw_penalties[i]
            )
        cdi_scores.append(round(cdi, 5))

    # ── Assign ranks (1 = best / lowest CDI) ───────────────────
    sorted_indices = sorted(range(n), key=lambda i: cdi_scores[i])
    cdi_ranks = [0] * n
    for rank_pos, idx in enumerate(sorted_indices, start=1):
        cdi_ranks[idx] = rank_pos

    # ── Tier classification ─────────────────────────────────────
    def _tier(rank: int) -> str:
        pct = rank / n
        if pct <= 0.25:
            return "Tier 1 — Top Lead"
        elif pct <= 0.60:
            return "Tier 2 — Promising"
        else:
            return "Tier 3 — Low Priority"

    # ── Final verdict ───────────────────────────────────────────
    def _verdict(r: Dict, rank: int, cdi: float, tier: str) -> str:
        qc = r.get("qc_verdict", "")
        lip = r.get("lipinski_pass")
        qed = _safe_float(r.get("qed"))
        sas = _safe_float(r.get("sas"))
        tox = r.get("tox_risk")
        parts = [tier]
        if qed is not None:
            parts.append(f"QED: {qed:.2f}")
        if sas is not None:
            parts.append(f"SAS: {sas:.1f}")
        if tox:
            parts.append(f"Tox: {tox}")
        if qc and "PASS" in str(qc).upper():
            parts.append("QC-pass")
        if lip is True or lip == "True":
            parts.append("Lipinski-compliant")
        elif lip is False or lip == "False":
            parts.append("Lipinski-violation")
        v_score = _safe_float(r.get("vina_score_kcal_mol") or r.get("vina_top_score"))
        if v_score is not None and v_score < -8.0:
            parts.append(f"strong binder (Vina {v_score:.1f})")
        elif v_score is not None and v_score < -6.0:
            parts.append(f"moderate binder (Vina {v_score:.1f})")
        elif not has_docking:
            parts.append("pre-docking geometry rank (run Stage 4b for Vina/GNINA)")
        return " | ".join(parts)

    # ── Write back ──────────────────────────────────────────────
    for i, r in enumerate(records):
        tier   = _tier(cdi_ranks[i])
        r["cdi_score"]         = cdi_scores[i]
        r["cdi_rank"]          = cdi_ranks[i]
        r["cdi_tier"]          = tier
        r["rank_vina"]         = round(rank_vina[i], 4)
        r["rank_gnina"]        = round(rank_gnina[i], 4)
        r["rank_rmsd"]         = round(rank_rmsd[i], 4)
        r["rank_energy"]       = round(rank_energy[i], 4)
        r["docking_evaluated"] = has_docking
        r["final_verdict"]     = _verdict(r, cdi_ranks[i], cdi_scores[i], tier)
        # Ensure consistent column aliases for frontend display
        rmsd_val = r.get("final_ligand_rmsd_A") or r.get("rmsd") or r.get("rmsd_A")
        if rmsd_val is not None:
            r["final_ligand_rmsd_A"] = rmsd_val
            r["rmsd"] = rmsd_val
        vina_val = r.get("vina_score_kcal_mol") or r.get("vina_top_score")
        if vina_val is not None:
            r["vina_score_kcal_mol"] = vina_val
            r["vina_top_score"] = vina_val

    # Sort by CDI rank
    records.sort(key=lambda r: r["cdi_rank"])
    return records


# ─────────────────────────────────────────────────────────────────
#  Convenience: load CSV → rank → save CSV + JSON
# ─────────────────────────────────────────────────────────────────
def rank_from_csv(
    input_csv: str,
    output_dir: str,
    weights: Dict[str, float] = None,
    smiles_key: str = "smiles",
    top_n: int = None,
) -> Dict[str, Any]:
    """
    Load a Stage 4b results CSV, compute CDI ranking, write:
      - cdi_ranked_candidates.csv   (all candidates, sorted)
      - cdi_top_candidates.csv      (top_n if specified)
      - cdi_ranking_report.json     (summary statistics)

    Returns a summary dict suitable for API responses.
    """
    input_path = Path(input_csv)
    out_dir    = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        return {"success": False, "message": f"Input CSV not found: {input_csv}"}

    # Load records
    with open(input_path, newline="", encoding="utf-8") as f:
        records = list(csv.DictReader(f))

    if not records:
        return {"success": False, "message": "Input CSV is empty"}

    # Compute CDI
    ranked = compute_cdi_ranking(records, weights=weights, smiles_key=smiles_key)

    # Determine top N
    top_n_actual = top_n or max(1, len(ranked) // 4)  # default = top 25%
    top_candidates = ranked[:top_n_actual]

    # Write all ranked
    all_csv = out_dir / "cdi_ranked_candidates.csv"
    if ranked:
        fieldnames = list(ranked[0].keys())
        with open(all_csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            w.writerows(ranked)

    # Write top N
    top_csv = out_dir / "cdi_top_candidates.csv"
    if top_candidates:
        fieldnames_top = list(top_candidates[0].keys())
        with open(top_csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames_top, extrasaction="ignore")
            w.writeheader()
            w.writerows(top_candidates)

    # Summary stats
    cdi_vals   = [r["cdi_score"]  for r in ranked]
    vina_vals  = [_safe_float(r.get("vina_score_kcal_mol") or r.get("vina_top_score") or r.get("gnina_vina_score")) for r in ranked]
    vina_valid = [v for v in vina_vals if v is not None]
    has_docking = any(r.get("docking_evaluated") for r in ranked)
    tier_counts = {}
    for r in ranked:
        t = r.get("cdi_tier", "Unknown")
        tier_counts[t] = tier_counts.get(t, 0) + 1

    report = {
        "success":          True,
        "has_docking":      has_docking,
        "n_total":          len(ranked),
        "n_top":            len(top_candidates),
        "top_n_cutoff":     top_n_actual,
        "cdi_score_min":    round(min(cdi_vals), 5) if cdi_vals else None,
        "cdi_score_max":    round(max(cdi_vals), 5) if cdi_vals else None,
        "cdi_score_mean":   round(sum(cdi_vals)/len(cdi_vals), 5) if cdi_vals else None,
        "vina_best":        round(min(vina_valid), 3) if vina_valid else None,
        "vina_mean":        round(sum(vina_valid)/len(vina_valid), 3) if vina_valid else None,
        "tier_counts":      tier_counts,
        "top_candidates":   top_candidates,
        "weights_used":     {**DEFAULT_WEIGHTS, **(weights or {})},
        "output_csv":       str(all_csv),
        "top_csv":          str(top_csv),
    }

    report_json = out_dir / "cdi_ranking_report.json"
    with open(report_json, "w", encoding="utf-8") as f:
        # Exclude bulky top_candidates list from JSON (keep it in CSV)
        slim = {k: v for k, v in report.items() if k != "top_candidates"}
        json.dump(slim, f, indent=2)

    return report

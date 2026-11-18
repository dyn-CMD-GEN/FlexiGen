"""
FlexiGEN Backend API  — v3 (Full 4-stage pipeline)
====================================================
Flask REST API connecting all pipeline stages.

Stage 1 — Conformer + Pharmacophore generation (pure Python)
Stage 2 — 2D Topology / SMILES (pocket tensor + Member-2 handoff)
Stage 3 — 3D coordinate generation (GeneralProteinLigandFlowNet)
Stage 4a — Geometry validation + MMFF94s minimisation (Stage G)
Stage 4b — Vina docking + OpenMM relaxation + GNINA rescoring (Stage4.ipynb)

Run:   python app.py
"""

import os, json, uuid, shutil, glob, zipfile, csv, time
from pathlib import Path
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

from pipeline_stages import run_stage1, run_stage2
from stage3_flow_matching import run_stage3_real, TORCH_AVAILABLE, RDKIT_AVAILABLE
from stage4_validation import run_stage4_validation

# Stage 4b — Vina + OpenMM + GNINA (graceful import)
try:
    from stage4_docking import (
        run_stage4_full, prepare_receptor,
        _VINA, _VINA_BIN_OK, _OPENMM, _PDBFIXER, _MEEKO, GNINA_BIN, VINA_BIN
    )
    DOCKING_AVAILABLE = True
except Exception as _e:
    DOCKING_AVAILABLE = False
    _VINA = _VINA_BIN_OK = _OPENMM = _PDBFIXER = _MEEKO = False
    GNINA_BIN = VINA_BIN = None
    import warnings; warnings.warn(f"stage4_docking import failed: {_e}")

# CDI Ranking (graceful import)
try:
    from cdi_ranking import compute_cdi_ranking, rank_from_csv
    CDI_AVAILABLE = True
except Exception as _e2:
    CDI_AVAILABLE = False
    import warnings; warnings.warn(f"cdi_ranking import failed: {_e2}")

# ──────────────────────────────────────────────────────────
#  Paths
# ──────────────────────────────────────────────────────────
BASE_DIR        = Path(__file__).parent
UPLOAD_DIR      = BASE_DIR / "uploads"
OUTPUTS_DIR     = BASE_DIR / "outputs"
CHECKPOINT_DIR  = BASE_DIR / "checkpoints"
CHECKPOINT_PATH = CHECKPOINT_DIR / "stage_d_best"   # extracted dir from ZIP

STAGE1_OUT  = OUTPUTS_DIR / "stage1"
STAGE2_OUT  = OUTPUTS_DIR / "stage2"
STAGE3_OUT  = OUTPUTS_DIR / "stage3"
STAGE4_OUT  = OUTPUTS_DIR / "stage4"
STAGE4B_OUT = OUTPUTS_DIR / "stage4b"   # docking + relaxation + GNINA

M2_DIR         = BASE_DIR.parent / "Member2_Outputs_For_M3"
HANDOFF_CSV    = M2_DIR / "member2_exploratory_M3_handoff.csv"
TOKENIZER_JSON = M2_DIR / "smiles_tokenizer.json"

# Optional Stage D/E auxiliary files (not required)
PRIOR_PATH = BASE_DIR / "checkpoints" / "stage_e_initial_prior_stats.json"
STATS_PATH = BASE_DIR / "checkpoints" / "property_normalization_stats.json"

for d in (UPLOAD_DIR, STAGE1_OUT, STAGE2_OUT, STAGE3_OUT, STAGE4_OUT, STAGE4B_OUT):
    d.mkdir(parents=True, exist_ok=True)

# ──────────────────────────────────────────────────────────
#  App
# ──────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200 MB

@app.errorhandler(404)
def handle_404(e):
    return jsonify({"success": False, "error": "Not Found", "message": str(e)}), 404

@app.errorhandler(500)
def handle_500(e):
    return jsonify({"success": False, "error": "Internal Server Error", "message": str(e)}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    return jsonify({"success": False, "error": "Server Exception", "message": str(e)}), 500


# ═══════════════════════════════════════════════════════════
#  HEALTH
# ═══════════════════════════════════════════════════════════
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "version": "3.0.0",
        "stages": ["stage1", "stage2", "stage3", "stage4", "stage4b"],
        "torch_available":     TORCH_AVAILABLE,
        "rdkit_available":     RDKIT_AVAILABLE,
        "checkpoint_present":  CHECKPOINT_PATH.exists(),
        "handoff_csv_present": HANDOFF_CSV.exists(),
        "tokenizer_present":   TOKENIZER_JSON.exists(),
        "docking_available":   DOCKING_AVAILABLE,
        "vina_available":      _VINA or _VINA_BIN_OK,
        "vina_binary":         str(VINA_BIN) if VINA_BIN else None,
        "openmm_available":    _OPENMM,
        "gnina_available":     GNINA_BIN is not None,
        "cdi_available":       CDI_AVAILABLE,
    })


# ═══════════════════════════════════════════════════════════
#  EXPERIMENT MANAGEMENT & GLOBAL METRICS
# ═══════════════════════════════════════════════════════════
@app.route("/api/experiments", methods=["GET"])
def list_experiments():
    """List all past experiment runs and their stage completion states."""
    runs = {}
    
    # 1. Scan Stage 1 outputs
    if STAGE1_OUT.exists():
        for d in STAGE1_OUT.iterdir():
            if d.is_dir():
                rid = d.name
                mtime = os.path.getmtime(d)
                target_label = "PARP1 (ARTD1)"
                upload_matches = list(UPLOAD_DIR.glob(f"{rid}_*.pdb"))
                if upload_matches:
                    clean_name = upload_matches[0].stem.split("_", 1)[-1]
                    if clean_name.startswith("PARP1") or "7KK5" in clean_name:
                        target_label = "PARP1 (Benchmark)"
                    elif clean_name:
                        target_label = clean_name.replace(".pdb", "")
                runs.setdefault(rid, {
                    "run_id": rid,
                    "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(mtime)),
                    "timestamp": mtime,
                    "target_protein": target_label,
                    "stage1": False,
                    "stage2": False,
                    "stage3": False,
                    "stage4": False,
                    "stage4b": False,
                    "cdi": False,
                    "n_conformers": 0,
                    "n_candidates": 0,
                    "n_generated": 0,
                    "n_validated": 0,
                    "n_docked": 0,
                    "top_cdi_score": None,
                    "top_candidate_id": None,
                })
                # Check Stage 1 files
                rep_p = d / "stage1_report.json"
                if rep_p.exists():
                    runs[rid]["stage1"] = True
                    try:
                        with open(rep_p) as f:
                            rep = json.load(f)
                            runs[rid]["n_conformers"] = rep.get("n_conformers", 5)
                            runs[rid]["n_features"] = rep.get("n_features", 0)
                    except Exception:
                        pass

    # 2. Scan Stage 2
    if STAGE2_OUT.exists():
        for d in STAGE2_OUT.iterdir():
            if d.is_dir() and d.name in runs:
                cand_csv = d / "topology_candidates.csv"
                if cand_csv.exists():
                    runs[d.name]["stage2"] = True
                    try:
                        with open(cand_csv, newline="") as f:
                            runs[d.name]["n_candidates"] = max(0, sum(1 for _ in f) - 1)
                    except Exception:
                        pass

    # 3. Scan Stage 3
    if STAGE3_OUT.exists():
        for d in STAGE3_OUT.iterdir():
            if d.is_dir() and d.name in runs:
                manifest = d / "stage_f_generation_manifest.csv"
                if manifest.exists():
                    runs[d.name]["stage3"] = True
                    sdf_count = len(list((d / "sdf").glob("*.sdf"))) if (d / "sdf").exists() else 0
                    runs[d.name]["n_generated"] = sdf_count

    # 4. Scan Stage 4
    if STAGE4_OUT.exists():
        for d in STAGE4_OUT.iterdir():
            if d.is_dir() and d.name in runs:
                val_csv = d / "reports" / "stage_g_original_structure_validation.csv"
                if val_csv.exists():
                    runs[d.name]["stage4"] = True
                    try:
                        with open(val_csv, newline="") as f:
                            runs[d.name]["n_validated"] = max(0, sum(1 for _ in f) - 1)
                    except Exception:
                        pass

    # 5. Scan Stage 4b and CDI
    if STAGE4B_OUT.exists():
        for d in STAGE4B_OUT.iterdir():
            if d.is_dir() and d.name in runs:
                rel_csv = d / "relaxation_summary.csv"
                if rel_csv.exists():
                    runs[d.name]["stage4b"] = True
                    try:
                        with open(rel_csv, newline="") as f:
                            runs[d.name]["n_docked"] = max(0, sum(1 for _ in f) - 1)
                    except Exception:
                        pass
                
                cdi_csv = d / "cdi" / "cdi_ranked_candidates.csv"
                if cdi_csv.exists():
                    runs[d.name]["cdi"] = True
                    try:
                        with open(cdi_csv, newline="") as f:
                            reader = csv.DictReader(f)
                            first_row = next(reader, None)
                            if first_row:
                                runs[d.name]["top_cdi_score"] = float(first_row.get("cdi_score", 0))
                                runs[d.name]["top_candidate_id"] = first_row.get("candidate_id") or first_row.get("record_id")
                    except Exception:
                        pass

    # Sort descending by timestamp
    sorted_runs = sorted(runs.values(), key=lambda r: r.get("timestamp", 0), reverse=True)
    return jsonify({"success": True, "experiments": sorted_runs, "count": len(sorted_runs)})


@app.route("/api/experiments/summary", methods=["GET"])
def experiments_summary():
    """Aggregate real platform metrics across all experiment runs."""
    total_runs = 0
    total_conformers = 0
    total_candidates = 0
    total_generated_3d = 0
    total_validated = 0
    total_docked = 0
    top_candidates = []

    if STAGE1_OUT.exists():
        for d in STAGE1_OUT.iterdir():
            if d.is_dir():
                total_runs += 1
                rep_p = d / "stage1_report.json"
                if rep_p.exists():
                    try:
                        with open(rep_p) as f:
                            rep = json.load(f)
                            total_conformers += int(rep.get("n_conformers", 5))
                    except Exception:
                        pass

    if STAGE2_OUT.exists():
        for d in STAGE2_OUT.iterdir():
            if d.is_dir():
                cand_csv = d / "topology_candidates.csv"
                if cand_csv.exists():
                    try:
                        with open(cand_csv, newline="") as f:
                            total_candidates += max(0, sum(1 for _ in f) - 1)
                    except Exception:
                        pass

    if STAGE3_OUT.exists():
        for d in STAGE3_OUT.iterdir():
            if d.is_dir() and (d / "sdf").exists():
                total_generated_3d += len(list((d / "sdf").glob("*.sdf")))

    if STAGE4_OUT.exists():
        for d in STAGE4_OUT.iterdir():
            if d.is_dir():
                val_csv = d / "reports" / "stage_g_original_structure_validation.csv"
                if val_csv.exists():
                    try:
                        with open(val_csv, newline="") as f:
                            total_validated += max(0, sum(1 for _ in f) - 1)
                    except Exception:
                        pass

    if STAGE4B_OUT.exists():
        for d in STAGE4B_OUT.iterdir():
            if d.is_dir():
                rel_csv = d / "relaxation_summary.csv"
                if rel_csv.exists():
                    try:
                        with open(rel_csv, newline="") as f:
                            total_docked += max(0, sum(1 for _ in f) - 1)
                    except Exception:
                        pass
                
                cdi_top_csv = d / "cdi" / "cdi_top_candidates.csv"
                if cdi_top_csv.exists():
                    try:
                        with open(cdi_top_csv, newline="") as f:
                            for r in csv.DictReader(f):
                                top_candidates.append({
                                    "run_id": d.name,
                                    "candidate_id": r.get("candidate_id") or r.get("record_id"),
                                    "cdi_score": float(r.get("cdi_score", 0)),
                                    "cdi_tier": r.get("cdi_tier", "Tier 1"),
                                    "vina_score": float(r.get("vina_score_kcal_mol", 0)) if r.get("vina_score_kcal_mol") else None,
                                    "gnina_affinity": float(r.get("gnina_CNNaffinity", 0)) if r.get("gnina_CNNaffinity") else None,
                                    "smiles": r.get("smiles", ""),
                                })
                    except Exception:
                        pass

    # Sort top candidates by CDI score ascending (lower is better)
    top_candidates.sort(key=lambda x: x["cdi_score"])

    return jsonify({
        "success": True,
        "metrics": {
            "total_runs": total_runs,
            "total_conformers": total_conformers,
            "total_candidates": total_candidates,
            "total_generated_3d": total_generated_3d,
            "total_validated": total_validated,
            "total_docked": total_docked,
            "top_ranked_count": len(top_candidates),
        },
        "top_candidates": top_candidates[:10],
    })


@app.route("/api/structure/protein/<run_id>", methods=["GET"])
def get_protein_structure(run_id):
    """Return raw PDB content for protein viewer (uploaded PDB or conformer PDB)."""
    conformer_num = request.args.get("conformer", type=int)
    s1_dir = STAGE1_OUT / run_id
    
    pdb_path = None
    if conformer_num:
        conf_p = s1_dir / f"conformer_{conformer_num}.pdb"
        if conf_p.exists():
            pdb_path = conf_p
            
    if not pdb_path or not pdb_path.exists():
        # Fall back to uploaded PDB
        upload_matches = list(UPLOAD_DIR.glob(f"{run_id}_*.pdb"))
        if upload_matches:
            pdb_path = upload_matches[0]
            
    if not pdb_path or not pdb_path.exists():
        # Check receptor_clean.pdb in stage4b
        rec_p = STAGE4B_OUT / run_id / "receptor" / "receptor_clean.pdb"
        if rec_p.exists():
            pdb_path = rec_p

    if not pdb_path or not pdb_path.exists():
        # Fall back to default benchmark PARP1
        default_pdb = UPLOAD_DIR / "default_parp1.pdb"
        if default_pdb.exists():
            pdb_path = default_pdb

    if not pdb_path or not pdb_path.exists():
        return jsonify({"success": False, "message": "Protein structure not found for this run"}), 404

    content = pdb_path.read_text(encoding="utf-8", errors="replace")
    
    # Also fetch pharmacophore metadata if available
    pharma_p = s1_dir / "pharmacophore_metadata.json"
    pharma_data = None
    if pharma_p.exists():
        try:
            with open(pharma_p) as f:
                pharma_data = json.load(f)
        except Exception:
            pass

    return jsonify({
        "success": True,
        "run_id": run_id,
        "filename": pdb_path.name,
        "pdb_content": content,
        "pharmacophore": pharma_data,
    })


# ═══════════════════════════════════════════════════════════
#  STAGE 1 — PDB → Conformers + Pharmacophore Tensor
# ═══════════════════════════════════════════════════════════
@app.route("/api/stage1/run", methods=["POST"])
def stage1_run():
    # Support 1-click benchmark run using default PARP1 PDB
    use_default = False
    if request.is_json:
        use_default = bool(request.json.get("use_default"))
    elif request.form.get("use_default") in ("true", "1", "True"):
        use_default = True

    if "pdb_file" not in request.files and not use_default:
        return jsonify({"success": False, "message": "No PDB file uploaded. Use key 'pdb_file' or set 'use_default': true."}), 400

    run_id = str(uuid.uuid4())[:8]
    if use_default:
        default_pdb = UPLOAD_DIR / "default_parp1.pdb"
        if not default_pdb.exists():
            # Find any existing 7KK5 PDB in uploads
            matches = list(UPLOAD_DIR.glob("*_7KK5.pdb"))
            if matches:
                shutil.copy(str(matches[0]), str(default_pdb))
        if not default_pdb.exists():
            return jsonify({"success": False, "message": "Default PARP1 PDB benchmark file not found on server."}), 404
        upload_path = UPLOAD_DIR / f"{run_id}_PARP1_7KK5.pdb"
        shutil.copy(str(default_pdb), str(upload_path))
    else:
        file = request.files["pdb_file"]
        if not file.filename.lower().endswith((".pdb", ".ent")):
            return jsonify({"success": False, "message": "File must be .pdb or .ent"}), 400
        upload_path = UPLOAD_DIR / f"{run_id}_{file.filename}"
        file.save(str(upload_path))

    n_conformers = 5
    if request.form and request.form.get("n_conformers"):
        n_conformers = int(request.form.get("n_conformers"))
    elif request.is_json and request.json.get("n_conformers"):
        n_conformers = int(request.json.get("n_conformers"))
    n_conformers = max(2, min(n_conformers, 20))

    out_dir = STAGE1_OUT / run_id
    result  = run_stage1(str(upload_path), str(out_dir), n_conformers=n_conformers)
    result["run_id"] = run_id
    return jsonify(result)


@app.route("/api/stage1/status/<run_id>", methods=["GET"])
def stage1_status(run_id):
    rp = STAGE1_OUT / run_id / "stage1_report.json"
    if not rp.exists():
        return jsonify({"success": False, "message": "Run not found"}), 404
    with open(rp) as f:
        return jsonify({"success": True, "run_id": run_id, **json.load(f)})


@app.route("/api/stage1/download/<run_id>/<filename>")
def stage1_download(run_id, filename):
    allowed = {"pocket_conformers.csv", "pharmacophore_metadata.json", "stage1_report.json"}
    if filename not in allowed:
        return jsonify({"error": "Not allowed"}), 403
    p = STAGE1_OUT / run_id / filename
    if not p.exists():
        return jsonify({"error": "Not found"}), 404
    return send_file(str(p), as_attachment=True)


# ═══════════════════════════════════════════════════════════
#  STAGE 2 — 2D Topology from tensor + Member-2 handoff
# ═══════════════════════════════════════════════════════════
@app.route("/api/stage2/run", methods=["POST"])
def stage2_run():
    data         = request.get_json(silent=True) or {}
    stage1_run_id = data.get("stage1_run_id") or request.form.get("stage1_run_id")
    if not stage1_run_id:
        return jsonify({"success": False, "message": "Provide 'stage1_run_id'"}), 400

    s1_dir = STAGE1_OUT / stage1_run_id
    if not s1_dir.exists():
        return jsonify({"success": False, "message": f"Stage 1 run '{stage1_run_id}' not found"}), 404

    out_dir = STAGE2_OUT / stage1_run_id
    result  = run_stage2(str(s1_dir), str(HANDOFF_CSV), str(TOKENIZER_JSON), str(out_dir))
    result["run_id"] = stage1_run_id
    return jsonify(result)


@app.route("/api/stage2/candidates/<run_id>")
def stage2_candidates(run_id):
    import csv as _csv
    csv_path = STAGE2_OUT / run_id / "topology_candidates.csv"
    if not csv_path.exists():
        return jsonify({"success": False, "message": "No candidates found"}), 404
    with open(csv_path, newline="") as f:
        rows = list(_csv.DictReader(f))
    return jsonify({"success": True, "run_id": run_id, "candidates": rows})


@app.route("/api/stage2/download/<run_id>/<filename>")
def stage2_download(run_id, filename):
    allowed = {"topology_candidates.csv", "stage2_report.json"}
    if filename not in allowed:
        return jsonify({"error": "Not allowed"}), 403
    p = STAGE2_OUT / run_id / filename
    if not p.exists():
        return jsonify({"error": "Not found"}), 404
    return send_file(str(p), as_attachment=True)


# ═══════════════════════════════════════════════════════════
#  STAGE 3 — 3D Coordinate Generation (FlowNet)
# ═══════════════════════════════════════════════════════════
@app.route("/api/stage3/run", methods=["POST"])
def stage3_run():
    """
    JSON body:
      {
        "run_id"       : "<stage1_run_id>",           // required
        "smiles_list"  : ["CC...", "COc..."],         // optional; falls back to stage2 candidates
        "candidate_ids": ["CID_001", "CID_002"],      // parallel to smiles_list
        "pocket_radius": 8.0,                         // optional, default 8.0
        "n_steps"      : 100,                         // ODE steps, default 100
        "n_samples"    : 1                            // samples per pair, default 1
      }
    """
    data   = request.get_json(silent=True) or {}
    run_id = data.get("run_id") or request.form.get("run_id")
    if not run_id:
        return jsonify({"success": False, "message": "Provide 'run_id'"}), 400

    s1_dir = STAGE1_OUT / run_id
    s2_dir = STAGE2_OUT / run_id
    if not s1_dir.exists():
        return jsonify({"success": False, "message": f"Stage 1 run '{run_id}' not found. Run Stage 1 first."}), 404

    # ── Collect pocket conformer PDB files ───────────────
    # Stage 1 saves the uploaded PDB; we need conformer PDB files.
    # Fallback: use the uploaded PDB for all conformers.
    upload_pdb_matches = list(UPLOAD_DIR.glob(f"{run_id}_*.pdb"))
    upload_pdb         = upload_pdb_matches[0] if upload_pdb_matches else None

    # Look for per-conformer PDBs written by stage1 (if any)
    conformer_pdbs = sorted(s1_dir.glob("conformer_*.pdb"))
    if not conformer_pdbs and upload_pdb:
        # Create dummy conformer copies from the single uploaded PDB
        npz_path = s1_dir / "pocket_tensor.npz"
        n_conf   = 5
        if npz_path.exists():
            import numpy as np
            d = np.load(npz_path)
            n_conf = d["tensor"].shape[0]
        conformer_pdbs = []
        for ci in range(n_conf):
            dst = s1_dir / f"conformer_{ci+1}.pdb"
            shutil.copy(str(upload_pdb), str(dst))
            conformer_pdbs.append(dst)

    if not conformer_pdbs:
        return jsonify({"success": False, "message": "No protein conformer PDB files found. Run Stage 1 first."}), 400

    # ── Collect SMILES ────────────────────────────────────
    smiles_list   = data.get("smiles_list")
    candidate_ids = data.get("candidate_ids")

    if not smiles_list:
        # Pull from stage2 candidates CSV
        import csv as _csv
        s2_csv = s2_dir / "topology_candidates.csv"
        if s2_csv.exists():
            with open(s2_csv, newline="") as f:
                rows = [r for r in _csv.DictReader(f) if r.get("canonical_smiles")]
            smiles_list   = [r["canonical_smiles"] for r in rows]
            candidate_ids = [r.get("candidate_id") or f"CID_{i+1:03d}" for i, r in enumerate(rows)]
        else:
            # Fall back to Member-2 handoff
            if HANDOFF_CSV.exists():
                import csv as _csv
                with open(HANDOFF_CSV, newline="") as f:
                    rows = list(_csv.DictReader(f))
                smiles_list   = [r["canonical_smiles"] for r in rows]
                candidate_ids = [r.get("candidate_id", f"M2_{i}") for i, r in enumerate(rows)]

    if not smiles_list:
        return jsonify({"success": False, "message": "No SMILES available. Provide 'smiles_list' or run Stage 2 first."}), 400

    if not candidate_ids:
        candidate_ids = [f"CID_{i+1:03d}" for i in range(len(smiles_list))]

    # ── Pharmacophore tensor path ─────────────────────────
    pharm_npz = s1_dir / "pocket_tensor.npz"
    if not pharm_npz.exists():
        return jsonify({"success": False, "message": "pocket_tensor.npz not found. Run Stage 1 first."}), 400

    # ── Parameters ───────────────────────────────────────
    pocket_radius = float(data.get("pocket_radius", 8.0))
    n_steps       = int(data.get("n_steps", 20))
    n_samples     = int(data.get("n_samples", 1))

    out_dir = STAGE3_OUT / run_id

    result = run_stage3_real(
        pdb_conformer_paths  = [str(p) for p in conformer_pdbs],
        smiles_list          = smiles_list,
        candidate_ids        = candidate_ids,
        pharmacophore_npz_path = str(pharm_npz),
        checkpoint_path      = str(CHECKPOINT_PATH),
        output_dir           = str(out_dir),
        prior_path           = str(PRIOR_PATH) if PRIOR_PATH.exists() else None,
        stats_path           = str(STATS_PATH) if STATS_PATH.exists() else None,
        pocket_radius        = pocket_radius,
        n_steps              = n_steps,
        n_samples_per_pair   = n_samples,
    )
    result["run_id"] = run_id
    # Map backend keys to frontend expectations
    result["n_generated"] = result.get("successful", result.get("generated_coordinate_sets", 0))
    result["n_failed"]    = result.get("generated_coordinate_sets", 0) - result.get("successful", 0)
    result["n_steps"]     = n_steps
    result["pocket_radius"] = pocket_radius
    if "records" not in result and "results" in result:
        result["records"] = result.pop("results")
    elif "records" not in result:
        result["records"] = []
    result["manifest_rows"] = result.get("records", [])
    return jsonify(result)


@app.route("/api/stage3/status/<run_id>")
def stage3_status(run_id):
    rp = STAGE3_OUT / run_id / "stage_f_generation_report.json"
    if not rp.exists():
        return jsonify({"success": False, "message": "Run not found"}), 404
    with open(rp) as f:
        return jsonify({"success": True, "run_id": run_id, **json.load(f)})


@app.route("/api/stage3/results/<run_id>")
def stage3_results(run_id):
    import csv as _csv
    csv_p = STAGE3_OUT / run_id / "stage_f_generation_manifest.csv"
    if not csv_p.exists():
        return jsonify({"success": False, "message": "No manifest found"}), 404
    with open(csv_p, newline="") as f:
        rows = list(_csv.DictReader(f))
    return jsonify({"success": True, "run_id": run_id, "results": rows})


@app.route("/api/stage3/download_sdf/<run_id>/<record_id>")
def stage3_download_sdf(run_id, record_id):
    # Sanitize record_id
    record_id = record_id.replace("..", "").replace("/", "").replace("\\", "")
    p = STAGE3_OUT / run_id / "sdf" / f"{record_id}.sdf"
    if not p.exists():
        return jsonify({"error": "SDF not found"}), 404
    return send_file(str(p), as_attachment=True, download_name=f"{record_id}.sdf")


@app.route("/api/stage3/download_archive/<run_id>")
def stage3_download_archive(run_id):
    """Stream a ZIP of all SDF files for a run."""
    sdf_dir = STAGE3_OUT / run_id / "sdf"
    if not sdf_dir.exists():
        return jsonify({"error": "No SDF directory for this run"}), 404
    archive = STAGE3_OUT / run_id / "stage3_sdf_archive.zip"
    with zipfile.ZipFile(str(archive), 'w', zipfile.ZIP_DEFLATED) as zf:
        for sdf in sdf_dir.glob("*.sdf"):
            zf.write(str(sdf), arcname=sdf.name)
    return send_file(str(archive), as_attachment=True, download_name=f"stage3_{run_id}_sdf.zip")


@app.route("/api/stage3/download/<run_id>/<filename>")
def stage3_download_report(run_id, filename):
    allowed = {"stage_f_generation_manifest.csv", "stage_f_generation_report.json"}
    if filename not in allowed:
        return jsonify({"error": "Not allowed"}), 403
    p = STAGE3_OUT / run_id / filename
    if not p.exists():
        return jsonify({"error": "Not found"}), 404
    return send_file(str(p), as_attachment=True)


# ═══════════════════════════════════════════════════════════
#  STAGE 4 — Geometry Validation + MMFF Minimisation
# ═══════════════════════════════════════════════════════════
@app.route("/api/stage4/run", methods=["POST"])
def stage4_run():
    data   = request.get_json(silent=True) or {}
    run_id = data.get("run_id") or request.form.get("run_id")
    if not run_id:
        return jsonify({"success": False, "message": "Provide 'run_id'"}), 400

    s3_dir = STAGE3_OUT / run_id
    if not s3_dir.exists():
        return jsonify({"success": False, "message": f"Stage 3 output for '{run_id}' not found. Run Stage 3 first."}), 404

    # Collect conformer PDBs for protein contact analysis
    s1_dir       = STAGE1_OUT / run_id
    conformer_pdbs = [str(p) for p in sorted(s1_dir.glob("conformer_*.pdb"))]

    out_dir = STAGE4_OUT / run_id
    result  = run_stage4_validation(
        stage3_output_dir  = str(s3_dir),
        output_dir         = str(out_dir),
        pdb_conformer_paths = conformer_pdbs if conformer_pdbs else None,
        pocket_radius      = float(data.get("pocket_radius", 8.0)),
        min_max_iters      = int(data.get("min_max_iters", 1000)),
    )
    result["run_id"] = run_id
    # Remove large in-memory lists from HTTP response
    result.pop("validation_rows", None)
    result.pop("minimization_rows", None)
    return jsonify(result)


@app.route("/api/stage4/validation_rows/<run_id>")
def stage4_validation_rows(run_id):
    import csv as _csv
    val_csv = STAGE4_OUT / run_id / "reports" / "stage_g_original_structure_validation.csv"
    min_csv = STAGE4_OUT / run_id / "reports" / "stage_g_minimization_report.csv"
    if not val_csv.exists():
        return jsonify({"success": False, "message": "Validation report not found"}), 404

    min_dict = {}
    if min_csv.exists():
        with open(min_csv, newline="") as f:
            for r in _csv.DictReader(f):
                min_dict[r.get("record_id")] = r

    rows = []
    with open(val_csv, newline="") as f:
        for r in _csv.DictReader(f):
            rid = r.get("record_id")
            if rid in min_dict:
                r.update(min_dict[rid])
            # Add convenient alias fields for frontend
            r["bond_len_mean_A"] = r.get("bond_length_mean_A")
            r["max_ring_rmsd_A"] = r.get("aromatic_planarity_max_rms_A")
            r["has_protein_clash"] = "True" if int(r.get("steric_clashes_lt_2A", 0) or 0) > 0 else "False"
            r["energy_before_kcal_mol"] = r.get("energy_before")
            r["energy_after_kcal_mol"]  = r.get("energy_after")
            rows.append(r)
    return jsonify({"success": True, "run_id": run_id, "rows": rows})


@app.route("/api/stage4/download/<run_id>/<filename>")
def stage4_download(run_id, filename):
    allowed = {
        "stage_g_validation_report.json",
        "stage_g_original_structure_validation.csv",
        "stage_g_bond_geometry_details.csv",
        "stage_g_minimization_report.csv",
        "stage_g_aromatic_ring_planarity.csv",
    }
    if filename not in allowed:
        return jsonify({"error": "Not allowed"}), 403
    # Reports live in reports/ sub-dir
    p = STAGE4_OUT / run_id / "reports" / filename
    if not p.exists():
        p = STAGE4_OUT / run_id / filename
    if not p.exists():
        return jsonify({"error": "Not found"}), 404
    return send_file(str(p), as_attachment=True)


@app.route("/api/stage4/download_minimized/<run_id>/<filename>")
def stage4_download_minimized(run_id, filename):
    filename = filename.replace("..", "").replace("/", "").replace("\\", "")
    p = STAGE4_OUT / run_id / "minimized_separate" / filename
    if not p.exists():
        return jsonify({"error": "Not found"}), 404
    return send_file(str(p), as_attachment=True)


@app.route("/api/stage4/download_min_archive/<run_id>")
def stage4_download_min_archive(run_id):
    min_dir = STAGE4_OUT / run_id / "minimized_separate"
    if not min_dir.exists():
        return jsonify({"error": "No minimized SDF dir for this run"}), 404
    archive = STAGE4_OUT / run_id / "stage4_minimized.zip"
    with zipfile.ZipFile(str(archive), 'w', zipfile.ZIP_DEFLATED) as zf:
        for sdf in min_dir.glob("*.sdf"):
            zf.write(str(sdf), arcname=sdf.name)
    return send_file(str(archive), as_attachment=True, download_name=f"stage4_{run_id}_minimized.zip")


# ═══════════════════════════════════════════════════════════════════
#  STAGE 4B — Vina Docking + OpenMM Relaxation + GNINA Rescoring
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/stage4b/run", methods=["POST"])
def stage4b_run():
    """
    Run AutoDock Vina pocket docking → OpenMM constrained relaxation → GNINA CNN rescoring.

    JSON body:
      {
        "run_id"          : "<stage1/stage3 run_id>",
        "pocket_center"   : [x, y, z],     // optional — auto-detected from PDB if absent
        "box_size"        : [20, 20, 20],  // optional, default 20 Å each axis
        "exhaustiveness"  : 8,             // Vina exhaustiveness (1–32)
        "num_modes"       : 3,             // top N docking poses
        "max_mm_iters"    : 500,           // OpenMM minimisation steps
        "run_gnina"       : true           // attempt GNINA CNN rescoring
      }
    """
    if not DOCKING_AVAILABLE:
        return jsonify({
            "success": False,
            "message": "Stage 4b not available — stage4_docking.py failed to import. "
                       "Check backend logs for details."
        }), 503

    data   = request.get_json(silent=True) or {}
    run_id = data.get("run_id") or request.form.get("run_id")
    if not run_id:
        return jsonify({"success": False, "message": "Provide 'run_id'"}), 400

    # Collect SDF files from Stage 3 outputs
    s3_dir  = STAGE3_OUT / run_id
    sdf_dir = s3_dir / "sdf"
    sdf_paths = sorted(sdf_dir.glob("*.sdf")) if sdf_dir.exists() else []
    if not sdf_paths:
        return jsonify({"success": False,
                        "message": "No SDF files found for this run_id. Run Stage 3 first."}), 404

    # Collect receptor PDB from uploads
    upload_pdbs = list(UPLOAD_DIR.glob(f"{run_id}_*.pdb"))
    receptor_pdb = str(upload_pdbs[0]) if upload_pdbs else None

    pocket_center = data.get("pocket_center")                      # list [x,y,z] or None
    box_size      = data.get("box_size", [20.0, 20.0, 20.0])

    # Collect parallel SMILES list from Stage 3 manifest
    s3_manifest = s3_dir / "stage_f_generation_manifest.csv"
    smiles_by_stem = {}
    if s3_manifest.exists():
        with open(s3_manifest, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                smiles_by_stem[row.get("record_id", "")] = row.get("smiles", "")
    smiles_list = [smiles_by_stem.get(p.stem, "") for p in sdf_paths]

    out_dir = STAGE4B_OUT / run_id

    try:
        result = run_stage4_full(
            sdf_paths        = [str(p) for p in sdf_paths],
            candidate_ids    = [p.stem for p in sdf_paths],
            receptor_pdb     = receptor_pdb,
            output_dir       = str(out_dir),
            pocket_center    = pocket_center,
            box_size         = box_size,
            exhaustiveness   = int(data.get("exhaustiveness", 4)),
            num_modes        = int(data.get("num_modes", 3)),
            max_mm_iters     = int(data.get("max_mm_iters", 100)),
            run_gnina        = bool(data.get("run_gnina", True)),
            smiles_list      = smiles_list,
        )
        # Add summary count aliases for frontend
        result["n_total"]   = result.get("n_candidates", len(sdf_paths))
        result["n_docked"]  = result.get("n_candidates", len(sdf_paths))
        result["n_relaxed"] = result.get("n_candidates", len(sdf_paths))
        result["n_qc_pass"] = result.get("n_passed_qc", 0)
        result["n_gnina"]   = result.get("n_candidates", len(sdf_paths))
        # Strip large in-memory lists before returning over HTTP
        result.pop("records", None)
        result["run_id"] = run_id
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Stage 4b error: {str(e)}"}), 500


@app.route("/api/stage4b/results/<run_id>")
def stage4b_results(run_id):
    """Return per-candidate docking/relaxation/GNINA rows as JSON."""
    import csv as _csv
    csv_p = STAGE4B_OUT / run_id / "relaxation_summary.csv"
    if not csv_p.exists():
        # Also try the stage5 manifest
        csv_p = STAGE4B_OUT / run_id / "stage5_input_manifest.csv"
    if not csv_p.exists():
        return jsonify({"success": False, "message": "No results found — run Stage 4b first"}), 404
    with open(csv_p, newline="") as f:
        rows = list(_csv.DictReader(f))
    return jsonify({"success": True, "run_id": run_id, "records": rows})


@app.route("/api/stage4b/download_manifest/<run_id>")
def stage4b_manifest(run_id):
    """Download the Stage 5 input manifest CSV."""
    p = STAGE4B_OUT / run_id / "stage5_input_manifest.csv"
    if not p.exists():
        return jsonify({"error": "stage5_input_manifest.csv not found — run Stage 4b first"}), 404
    return send_file(str(p), as_attachment=True,
                     download_name=f"stage5_manifest_{run_id}.csv")


@app.route("/api/stage4b/download_archive/<run_id>")
def stage4b_archive(run_id):
    """Download a ZIP of all relaxed complex PDB files."""
    base    = STAGE4B_OUT / run_id
    archive = base / "stage4b_relaxed.zip"
    pdbs    = list(base.rglob("relaxed_complex.pdb"))
    if not pdbs:
        return jsonify({"error": "No relaxed PDB files found for this run"}), 404
    with zipfile.ZipFile(str(archive), 'w', zipfile.ZIP_DEFLATED) as zf:
        for pdb in pdbs:
            zf.write(str(pdb), arcname=str(pdb.relative_to(base)))
    return send_file(str(archive), as_attachment=True,
                     download_name=f"stage4b_{run_id}_relaxed.zip")


@app.route("/api/stage4b/download_relaxed/<run_id>/<path:pair_id>")
def stage4b_download_relaxed(run_id, pair_id):
    """Download a single relaxed complex PDB by candidate pair ID."""
    pair_id = pair_id.replace("..", "").replace("\\", "")
    p = STAGE4B_OUT / run_id / pair_id / "relaxed_complex.pdb"
    if not p.exists():
        return jsonify({"error": "Relaxed PDB not found"}), 404
    return send_file(str(p), as_attachment=True,
                     download_name=f"{pair_id}_relaxed.pdb")


# ═══════════════════════════════════════════════════════════════════
#  CDI RANKING — Composite Docking Index final candidate selection
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/cdi/rank", methods=["POST"])
def cdi_rank():
    """
    Compute CDI ranking from Stage 4b results.

    JSON body:
      {
        "run_id"  : "<stage4b_run_id>",
        "top_n"   : 10,              // optional — top N to highlight (default top 25%)
        "weights" : {                // optional weight overrides
          "w_vina"  : 0.30,
          "w_gnina" : 0.25,
          "w_rmsd"  : 0.15,
          "w_energy": 0.15,
          "w_qc"    : 0.10,
          "w_lipo"  : 0.03,
          "w_mw"    : 0.02
        }
      }
    Returns the top candidates with CDI scores, tiers and final verdicts.
    """
    if not CDI_AVAILABLE:
        return jsonify({"success": False,
                        "message": "CDI ranking module not available — check backend logs"}), 503

    data   = request.get_json(silent=True) or {}
    run_id = data.get("run_id") or request.form.get("run_id")
    if not run_id:
        return jsonify({"success": False, "message": "Provide 'run_id'"}), 400

    top_n   = int(data.get("top_n", 0)) or None
    weights = data.get("weights") or None

    # Prefer full relaxation_summary first (all candidates), then stage5 manifest
    csv_p = None
    for csv_name in ("relaxation_summary.csv", "stage5_input_manifest.csv"):
        p = STAGE4B_OUT / run_id / csv_name
        if p.exists():
            csv_p = p
            break
    if not csv_p:
        # Fall back to Stage 4a validation CSV
        csv_p = STAGE4_OUT / run_id / "reports" / "stage_g_original_structure_validation.csv"

    if not csv_p.exists():
        return jsonify({"success": False,
                        "message": "No docking/validation results found. Run Stage 4 or 4b first."}), 404

    # Load Stage 3 manifest for SMILES and conformer lookup
    s3_manifest = STAGE3_OUT / run_id / "stage_f_generation_manifest.csv"
    s3_records = {}
    cand_smiles = {}
    if s3_manifest.exists():
        with open(s3_manifest, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                rid = row.get("record_id")
                if rid:
                    s3_records[rid] = row
                cid = row.get("candidate_id")
                if cid and row.get("smiles"):
                    cand_smiles[cid] = row["smiles"]

    # Load Stage 4 minimization report for MMFF energy data
    s4_min = STAGE4_OUT / run_id / "reports" / "stage_g_minimization_report.csv"
    min_records = {}
    if s4_min.exists():
        with open(s4_min, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                rid = row.get("record_id")
                if rid:
                    min_records[rid] = row

    # Load input records from csv_p and enrich them
    with open(csv_p, newline="", encoding="utf-8") as f:
        records = list(csv.DictReader(f))

    for r in records:
        rec_id = r.get("record_id") or r.get("candidate_id") or ""
        # Match from Stage 3 manifest
        s3_data = s3_records.get(rec_id) or s3_records.get(r.get("candidate_id", ""))
        if s3_data:
            if not r.get("smiles"):
                r["smiles"] = s3_data.get("smiles", "")
            if not r.get("candidate_id"):
                r["candidate_id"] = s3_data.get("candidate_id", "")
            if not r.get("conformer"):
                r["conformer"] = s3_data.get("conformer", "")
        # Fall back to candidate-level smiles
        if not r.get("smiles") and r.get("candidate_id") in cand_smiles:
            r["smiles"] = cand_smiles[r["candidate_id"]]

        # Merge Stage 4 minimization report
        min_data = min_records.get(rec_id)
        if min_data:
            for k in ("energy_before", "energy_after", "energy_reduction", "minimization_converged"):
                if k in min_data and not r.get(k):
                    r[k] = min_data[k]
            if not r.get("energy_change_kJ_mol") and min_data.get("energy_reduction"):
                try:
                    r["energy_change_kJ_mol"] = -abs(float(min_data["energy_reduction"]))
                except ValueError:
                    pass

    out_dir = STAGE4B_OUT / run_id / "cdi"
    out_dir.mkdir(parents=True, exist_ok=True)
    enriched_csv = out_dir / "cdi_input_enriched.csv"
    if records:
        with open(enriched_csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(records[0].keys()), extrasaction="ignore")
            w.writeheader()
            w.writerows(records)

    result = rank_from_csv(
        input_csv  = str(enriched_csv),
        output_dir = str(out_dir),
        weights    = weights,
        top_n      = top_n,
    )
    result["run_id"] = run_id
    return jsonify(result)


@app.route("/api/cdi/results/<run_id>")
def cdi_results(run_id):
    """Return full CDI-ranked candidate list as JSON."""
    import csv as _csv
    csv_p = STAGE4B_OUT / run_id / "cdi" / "cdi_ranked_candidates.csv"
    if not csv_p.exists():
        return jsonify({"success": False,
                        "message": "CDI ranking not run yet — call /api/cdi/rank first"}), 404
    with open(csv_p, newline="", encoding="utf-8") as f:
        rows = list(_csv.DictReader(f))
    return jsonify({"success": True, "run_id": run_id, "ranked_candidates": rows,
                    "n_total": len(rows)})


@app.route("/api/cdi/top/<run_id>")
def cdi_top(run_id):
    """Return only the top (Tier 1) CDI candidates as JSON."""
    import csv as _csv
    csv_p = STAGE4B_OUT / run_id / "cdi" / "cdi_top_candidates.csv"
    if not csv_p.exists():
        return jsonify({"success": False,
                        "message": "CDI top candidates not available — call /api/cdi/rank first"}), 404
    with open(csv_p, newline="", encoding="utf-8") as f:
        rows = list(_csv.DictReader(f))
    return jsonify({"success": True, "run_id": run_id, "top_candidates": rows,
                    "n_top": len(rows)})


@app.route("/api/cdi/download/<run_id>/<filename>")
def cdi_download(run_id, filename):
    """Download CDI ranking CSV or JSON report."""
    allowed = {
        "cdi_ranked_candidates.csv",
        "cdi_top_candidates.csv",
        "cdi_ranking_report.json",
    }
    if filename not in allowed:
        return jsonify({"error": "Not allowed"}), 403
    p = STAGE4B_OUT / run_id / "cdi" / filename
    if not p.exists():
        return jsonify({"error": "Not found — run CDI ranking first"}), 404
    return send_file(str(p), as_attachment=True)


@app.route("/api/structure/3d/<run_id>/<path:candidate_id>", methods=["GET"])
def get_3d_structure(run_id, candidate_id):
    """
    Return 3D coordinates (SDF/PDB) and full ADMET/drug-likeness properties
    for interactive 3D WebGL visualisation in the frontend (3Dmol.js).
    """
    candidate_id = candidate_id.strip()
    pair_id = f"{candidate_id}__P1"

    # 1. Complex PDB (OpenMM relaxed complex)
    complex_pdb_p = STAGE4B_OUT / run_id / pair_id / "relaxed_complex.pdb"
    if not complex_pdb_p.exists():
        complex_pdb_p = STAGE4B_OUT / run_id / candidate_id / "relaxed_complex.pdb"
    complex_pdb_text = complex_pdb_p.read_text(encoding="utf-8", errors="replace") if complex_pdb_p.exists() else None

    # 2. Docked pose SDF
    docked_sdf_p = STAGE4B_OUT / run_id / pair_id / "docking" / "docked_pose.sdf"
    if not docked_sdf_p.exists():
        docked_sdf_p = STAGE4B_OUT / run_id / candidate_id / "docking" / "docked_pose.sdf"
    docked_sdf_text = docked_sdf_p.read_text(encoding="utf-8", errors="replace") if docked_sdf_p.exists() else None

    # 3. Stage 4 Minimized SDF
    min_sdf_p = STAGE4_OUT / run_id / "minimized_sdf" / f"{candidate_id}.sdf"
    min_sdf_text = min_sdf_p.read_text(encoding="utf-8", errors="replace") if min_sdf_p.exists() else None

    # 4. Stage 3 Generated SDF
    s3_sdf_p = STAGE3_OUT / run_id / "sdf" / f"{candidate_id}.sdf"
    if not s3_sdf_p.exists():
        matches = list((STAGE3_OUT / run_id / "sdf").glob(f"{candidate_id}*.sdf"))
        if not matches and candidate_id.startswith("CAND_"):
            try:
                idx = int(candidate_id.split("_")[1])
                matches = list((STAGE3_OUT / run_id / "sdf").glob(f"CID_{idx:03d}*.sdf"))
            except Exception:
                pass
        if not matches and candidate_id.startswith("CID_"):
            try:
                idx = int(candidate_id.split("_")[1])
                matches = list((STAGE3_OUT / run_id / "sdf").glob(f"CAND_{idx}*.sdf"))
            except Exception:
                pass
        if matches:
            s3_sdf_p = matches[0]
    s3_sdf_text = s3_sdf_p.read_text(encoding="utf-8", errors="replace") if s3_sdf_p.exists() else None

    # 5. Receptor PDB
    rec_pdb_p = STAGE4B_OUT / run_id / "receptor" / "receptor_clean.pdb"
    if not rec_pdb_p.exists():
        upload_pdbs = list(UPLOAD_DIR.glob(f"{run_id}_*.pdb"))
        if upload_pdbs:
            rec_pdb_p = upload_pdbs[0]
    rec_pdb_text = rec_pdb_p.read_text(encoding="utf-8", errors="replace") if rec_pdb_p.exists() else None

    # Determine best ligand 3D structure and format
    best_ligand_text = docked_sdf_text or min_sdf_text or s3_sdf_text
    best_format = "sdf"

    if not best_ligand_text and complex_pdb_text:
        lig_lines = [line for line in complex_pdb_text.splitlines() if line.startswith("HETATM")]
        if lig_lines:
            best_ligand_text = "\n".join(lig_lines) + "\nEND\n"
            best_format = "pdb"

    if not best_ligand_text and not complex_pdb_text:
        return jsonify({"success": False, "message": f"No 3D structure found for candidate {candidate_id}"}), 404

    # 6. Extract or compute ADMET / drug-likeness properties
    props = {}
    smiles = ""
    cdi_csv = STAGE4B_OUT / run_id / "cdi" / "cdi_ranked_candidates.csv"
    if not cdi_csv.exists():
        cdi_csv = STAGE4B_OUT / run_id / "relaxation_summary.csv"
    if cdi_csv.exists():
        with open(cdi_csv, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("candidate_id") == candidate_id or row.get("record_id") == candidate_id or row.get("pair_id") == pair_id:
                    props = dict(row)
                    smiles = row.get("smiles", "")
                    break

    if not props.get("qed") or not props.get("sas"):
        if not smiles and best_ligand_text and best_format == "sdf":
            try:
                from rdkit import Chem
                m = Chem.MolFromMolBlock(best_ligand_text, removeHs=False)
                if m:
                    smiles = Chem.MolToSmiles(m)
            except Exception:
                pass
        if smiles:
            from cdi_ranking import compute_rdkit_props
            extra = compute_rdkit_props(smiles)
            props.update(extra)

    return jsonify({
        "success":          True,
        "candidate_id":     candidate_id,
        "format":           best_format,
        "ligand_structure": best_ligand_text,
        "complex_pdb":      complex_pdb_text,
        "receptor_pdb":     rec_pdb_text,
        "has_complex":      complex_pdb_text is not None,
        "has_docked":       docked_sdf_text is not None,
        "properties":       props,
    })


# ═══════════════════════════════════════════════════════════
#  FULL PIPELINE (convenience)
# ═══════════════════════════════════════════════════════════
@app.route("/api/pipeline/full", methods=["POST"])
def pipeline_full():
    if "pdb_file" not in request.files:
        return jsonify({"success": False, "message": "No PDB file uploaded"}), 400

    file         = request.files["pdb_file"]
    n_conformers = int(request.form.get("n_conformers", 5))
    smiles_input = request.form.get("smiles_list", "")   # optional comma-sep SMILES
    n_steps      = int(request.form.get("n_steps", 20))  # 20 ODE steps (optimal accuracy & speed)
    n_samples    = int(request.form.get("n_samples", 1))
    pocket_radius = float(request.form.get("pocket_radius", 8.0))

    run_id      = str(uuid.uuid4())[:8]
    upload_path = UPLOAD_DIR / f"{run_id}_{file.filename}"
    file.save(str(upload_path))

    s1_dir = STAGE1_OUT / run_id
    s2_dir = STAGE2_OUT / run_id
    s3_dir = STAGE3_OUT / run_id
    s4_dir = STAGE4_OUT / run_id

    results = {"run_id": run_id}

    # Stage 1
    r1 = run_stage1(str(upload_path), str(s1_dir), n_conformers=n_conformers)
    results["stage1"] = r1
    if not r1["success"]:
        return jsonify(results)

    # Stage 2
    r2 = run_stage2(str(s1_dir), str(HANDOFF_CSV), str(TOKENIZER_JSON), str(s2_dir))
    results["stage2"] = r2

    # Stage 3 — collect SMILES
    smiles_list, candidate_ids = [], []
    if smiles_input.strip():
        for i, s in enumerate(smiles_input.split(",")):
            s = s.strip()
            if s:
                smiles_list.append(s)
                candidate_ids.append(f"USR_{i+1:03d}")

    if not smiles_list and r2.get("success"):
        # fall back to stage2 candidates
        for cand in r2.get("candidates", []):
            if cand.get("canonical_smiles"):
                smiles_list.append(cand["canonical_smiles"])
                candidate_ids.append(cand.get("candidate_id") or f"CID_{len(smiles_list):03d}")

    if not smiles_list and HANDOFF_CSV.exists():
        import csv as _csv
        with open(HANDOFF_CSV, newline="") as f:
            rows = list(_csv.DictReader(f))
        smiles_list   = [r["canonical_smiles"] for r in rows]
        candidate_ids = [r.get("candidate_id", f"M2_{i}") for i, r in enumerate(rows)]

    pharm_npz = s1_dir / "pocket_tensor.npz"
    conformer_pdbs = []
    upload_pdb_matches = list(UPLOAD_DIR.glob(f"{run_id}_*.pdb"))
    upload_pdb = upload_pdb_matches[0] if upload_pdb_matches else None
    if upload_pdb:
        for ci in range(n_conformers):
            dst = s1_dir / f"conformer_{ci+1}.pdb"
            shutil.copy(str(upload_pdb), str(dst))
            conformer_pdbs.append(str(dst))

    if smiles_list and pharm_npz.exists() and conformer_pdbs:
        r3 = run_stage3_real(
            pdb_conformer_paths    = conformer_pdbs,
            smiles_list            = smiles_list,
            candidate_ids          = candidate_ids,
            pharmacophore_npz_path = str(pharm_npz),
            checkpoint_path        = str(CHECKPOINT_PATH),
            output_dir             = str(s3_dir),
            prior_path             = str(PRIOR_PATH) if PRIOR_PATH.exists() else None,
            stats_path             = str(STATS_PATH) if STATS_PATH.exists() else None,
            pocket_radius          = pocket_radius,
            n_steps                = n_steps,
            n_samples_per_pair     = n_samples,
        )
        results["stage3"] = r3

        if r3.get("success"):
            r4 = run_stage4_validation(
                stage3_output_dir  = str(s3_dir),
                output_dir         = str(s4_dir),
                pdb_conformer_paths = conformer_pdbs,
                pocket_radius      = pocket_radius,
            )
            r4.pop("validation_rows", None); r4.pop("minimization_rows", None)
            results["stage4"] = r4
    else:
        results["stage3"] = {"success": False, "message": "Skipped (missing SMILES or checkpoint)"}
        results["stage4"] = {"success": False, "message": "Skipped (Stage 3 not run)"}

    results["success"] = True
    results["message"] = "Full pipeline completed."
    return jsonify(results)


# ═══════════════════════════════════════════════════════════
#  SMILES INPUT ENDPOINT (user provides own SMILES)
# ═══════════════════════════════════════════════════════════
@app.route("/api/stage3/smiles_input", methods=["POST"])
def stage3_smiles_input():
    """
    Accept user-provided SMILES and run Stage 3 directly.
    JSON body:
      {
        "run_id"       : "<stage1_run_id>",
        "smiles_list"  : ["CC...", "COc..."],
        "candidate_ids": ["My_A", "My_B"],   // optional
        "pocket_radius": 8.0,
        "n_steps"      : 100,
        "n_samples"    : 1
      }
    """
    return stage3_run()   # same logic, different docs entry point


# ═══════════════════════════════════════════════════════════
#  ENTRY POINT
# ═══════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("=" * 60)
    print("  FlexiGEN Backend API v3  -  http://127.0.0.1:5000")
    print("  PyTorch   :", "OK" if TORCH_AVAILABLE  else "MISSING (install torch)")
    print("  RDKit     :", "OK" if RDKIT_AVAILABLE  else "MISSING (install rdkit)")
    print("  Docking   :", "OK" if DOCKING_AVAILABLE else "MISSING (graceful fallback active)")
    print("  GNINA     :", str(GNINA_BIN) if GNINA_BIN else "Not found (CNN scores disabled)")
    print("  Checkpoint:", "OK" if CHECKPOINT_PATH.exists() else "MISSING - " + str(CHECKPOINT_PATH))
    print("=" * 60)
    # threaded=True ensures health check pings are answered immediately even during heavy stage runs
    app.run(debug=False, host="0.0.0.0", port=5000, threaded=True)

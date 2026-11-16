"""
FlexiGEN Backend API
====================
Flask REST API connecting all pipeline stages.
Run:   python app.py
"""

import os
import json
import uuid
import shutil
from pathlib import Path
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

from pipeline_stages import run_stage1, run_stage2, run_stage3, run_stage4

# ──────────────────────────────────────────────────────────
#  Configuration
# ──────────────────────────────────────────────────────────
BASE_DIR      = Path(__file__).parent
UPLOAD_DIR    = BASE_DIR / "uploads"
OUTPUTS_DIR   = BASE_DIR / "outputs"
STAGE1_OUT    = OUTPUTS_DIR / "stage1"
STAGE2_OUT    = OUTPUTS_DIR / "stage2"
STAGE3_OUT    = OUTPUTS_DIR / "stage3"
STAGE4_OUT    = OUTPUTS_DIR / "stage4"

# Member-2 handoff files (bundled with the project)
M2_OUTPUTS    = BASE_DIR.parent / "Member2_Outputs_For_M3"
HANDOFF_CSV   = M2_OUTPUTS / "member2_exploratory_M3_handoff.csv"
TOKENIZER_JSON = M2_OUTPUTS / "smiles_tokenizer.json"

for d in (UPLOAD_DIR, STAGE1_OUT, STAGE2_OUT, STAGE3_OUT, STAGE4_OUT):
    d.mkdir(parents=True, exist_ok=True)

# ──────────────────────────────────────────────────────────
#  App
# ──────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024   # 100 MB


# ──────────────────────────────────────────────────────────
#  Health check
# ──────────────────────────────────────────────────────────
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "version": "1.0.0",
        "stages": ["stage1", "stage2", "stage3", "stage4"],
        "handoff_csv_present": HANDOFF_CSV.exists(),
        "tokenizer_present": TOKENIZER_JSON.exists(),
    })


# ──────────────────────────────────────────────────────────
#  STAGE 1 — Upload PDB + run conformer/pharmacophore gen
# ──────────────────────────────────────────────────────────
@app.route("/api/stage1/run", methods=["POST"])
def stage1_run():
    if "pdb_file" not in request.files:
        return jsonify({"success": False, "message": "No PDB file uploaded. Use key 'pdb_file'."}), 400

    file = request.files["pdb_file"]
    if not file.filename.lower().endswith((".pdb", ".ent")):
        return jsonify({"success": False, "message": "File must be .pdb or .ent"}), 400

    n_conformers = int(request.form.get("n_conformers", 5))
    if not 2 <= n_conformers <= 20:
        return jsonify({"success": False, "message": "n_conformers must be between 2 and 20"}), 400

    # Save uploaded file
    run_id = str(uuid.uuid4())[:8]
    upload_path = UPLOAD_DIR / f"{run_id}_{file.filename}"
    file.save(str(upload_path))

    # Run stage 1
    out_dir = STAGE1_OUT / run_id
    result = run_stage1(str(upload_path), str(out_dir), n_conformers=n_conformers)
    result["run_id"] = run_id
    return jsonify(result)


@app.route("/api/stage1/status/<run_id>", methods=["GET"])
def stage1_status(run_id):
    report_path = STAGE1_OUT / run_id / "stage1_report.json"
    if not report_path.exists():
        return jsonify({"success": False, "message": "Run not found"}), 404
    with open(report_path) as f:
        return jsonify({"success": True, "run_id": run_id, **json.load(f)})


@app.route("/api/stage1/download/<run_id>/<filename>", methods=["GET"])
def stage1_download(run_id, filename):
    allowed = {"pocket_conformers.csv", "pharmacophore_metadata.json",
                "stage1_report.json"}
    if filename not in allowed:
        return jsonify({"error": "File not allowed"}), 403
    path = STAGE1_OUT / run_id / filename
    if not path.exists():
        return jsonify({"error": "File not found"}), 404
    return send_file(str(path), as_attachment=True)


# ──────────────────────────────────────────────────────────
#  STAGE 2 — 2D Topology from tensor + Member-2 handoff
# ──────────────────────────────────────────────────────────
@app.route("/api/stage2/run", methods=["POST"])
def stage2_run():
    data = request.get_json(silent=True) or {}
    stage1_run_id = data.get("stage1_run_id") or request.form.get("stage1_run_id")

    if not stage1_run_id:
        return jsonify({"success": False, "message": "Provide 'stage1_run_id'"}), 400

    s1_dir = STAGE1_OUT / stage1_run_id
    if not s1_dir.exists():
        return jsonify({"success": False,
                        "message": f"Stage 1 output for run '{stage1_run_id}' not found."}), 404

    out_dir = STAGE2_OUT / stage1_run_id
    result = run_stage2(
        stage1_output_dir=str(s1_dir),
        handoff_csv=str(HANDOFF_CSV),
        tokenizer_json=str(TOKENIZER_JSON),
        output_dir=str(out_dir),
    )
    result["run_id"] = stage1_run_id
    return jsonify(result)


@app.route("/api/stage2/status/<run_id>", methods=["GET"])
def stage2_status(run_id):
    report_path = STAGE2_OUT / run_id / "stage2_report.json"
    if not report_path.exists():
        return jsonify({"success": False, "message": "Run not found"}), 404
    with open(report_path) as f:
        return jsonify({"success": True, "run_id": run_id, **json.load(f)})


@app.route("/api/stage2/candidates/<run_id>", methods=["GET"])
def stage2_candidates(run_id):
    """Return topology candidates as JSON for the frontend."""
    import csv as _csv
    csv_path = STAGE2_OUT / run_id / "topology_candidates.csv"
    if not csv_path.exists():
        return jsonify({"success": False, "message": "No candidates found"}), 404
    rows = []
    with open(csv_path, newline="") as f:
        rows = list(_csv.DictReader(f))
    return jsonify({"success": True, "run_id": run_id, "candidates": rows})


@app.route("/api/stage2/download/<run_id>/<filename>", methods=["GET"])
def stage2_download(run_id, filename):
    allowed = {"topology_candidates.csv", "stage2_report.json"}
    if filename not in allowed:
        return jsonify({"error": "File not allowed"}), 403
    path = STAGE2_OUT / run_id / filename
    if not path.exists():
        return jsonify({"error": "File not found"}), 404
    return send_file(str(path), as_attachment=True)


# ──────────────────────────────────────────────────────────
#  STAGE 3 — 3D Docking (stub)
# ──────────────────────────────────────────────────────────
@app.route("/api/stage3/run", methods=["POST"])
def stage3_run():
    data = request.get_json(silent=True) or {}
    run_id = data.get("run_id") or request.form.get("run_id")
    if not run_id:
        return jsonify({"success": False, "message": "Provide 'run_id'"}), 400

    s2_dir = STAGE2_OUT / run_id
    if not s2_dir.exists():
        return jsonify({"success": False,
                        "message": f"Stage 2 output for run '{run_id}' not found."}), 404

    out_dir = STAGE3_OUT / run_id
    result = run_stage3(str(s2_dir), str(out_dir))
    result["run_id"] = run_id
    return jsonify(result)


@app.route("/api/stage3/status/<run_id>", methods=["GET"])
def stage3_status(run_id):
    report_path = STAGE3_OUT / run_id / "stage3_report.json"
    if not report_path.exists():
        return jsonify({"success": False, "message": "Run not found"}), 404
    with open(report_path) as f:
        return jsonify({"success": True, "run_id": run_id, **json.load(f)})


@app.route("/api/stage3/download/<run_id>/<filename>", methods=["GET"])
def stage3_download(run_id, filename):
    allowed = {"stage3_docked.csv", "stage3_report.json"}
    if filename not in allowed:
        return jsonify({"error": "File not allowed"}), 403
    path = STAGE3_OUT / run_id / filename
    if not path.exists():
        return jsonify({"error": "File not found"}), 404
    return send_file(str(path), as_attachment=True)


# ──────────────────────────────────────────────────────────
#  STAGE 4 — ADMET & Lead Ranking (stub)
# ──────────────────────────────────────────────────────────
@app.route("/api/stage4/run", methods=["POST"])
def stage4_run():
    data = request.get_json(silent=True) or {}
    run_id = data.get("run_id") or request.form.get("run_id")
    if not run_id:
        return jsonify({"success": False, "message": "Provide 'run_id'"}), 400

    s3_dir = STAGE3_OUT / run_id
    if not s3_dir.exists():
        return jsonify({"success": False,
                        "message": f"Stage 3 output for run '{run_id}' not found."}), 404

    out_dir = STAGE4_OUT / run_id
    result = run_stage4(str(s3_dir), str(out_dir))
    result["run_id"] = run_id
    return jsonify(result)


@app.route("/api/stage4/status/<run_id>", methods=["GET"])
def stage4_status(run_id):
    report_path = STAGE4_OUT / run_id / "stage4_report.json"
    if not report_path.exists():
        return jsonify({"success": False, "message": "Run not found"}), 404
    with open(report_path) as f:
        return jsonify({"success": True, "run_id": run_id, **json.load(f)})


@app.route("/api/stage4/download/<run_id>/<filename>", methods=["GET"])
def stage4_download(run_id, filename):
    allowed = {"stage4_leads.csv", "stage4_report.json"}
    if filename not in allowed:
        return jsonify({"error": "File not allowed"}), 403
    path = STAGE4_OUT / run_id / filename
    if not path.exists():
        return jsonify({"error": "File not found"}), 404
    return send_file(str(path), as_attachment=True)


# ──────────────────────────────────────────────────────────
#  Run all stages sequentially (convenience endpoint)
# ──────────────────────────────────────────────────────────
@app.route("/api/pipeline/full", methods=["POST"])
def pipeline_full():
    """Upload PDB, run all 4 stages sequentially, return all results."""
    if "pdb_file" not in request.files:
        return jsonify({"success": False, "message": "No PDB file uploaded"}), 400

    file = request.files["pdb_file"]
    n_conformers = int(request.form.get("n_conformers", 5))
    run_id = str(uuid.uuid4())[:8]

    upload_path = UPLOAD_DIR / f"{run_id}_{file.filename}"
    file.save(str(upload_path))

    s1_dir = STAGE1_OUT / run_id
    s2_dir = STAGE2_OUT / run_id
    s3_dir = STAGE3_OUT / run_id
    s4_dir = STAGE4_OUT / run_id

    results = {"run_id": run_id}

    r1 = run_stage1(str(upload_path), str(s1_dir), n_conformers=n_conformers)
    results["stage1"] = r1
    if not r1["success"]:
        return jsonify(results)

    r2 = run_stage2(str(s1_dir), str(HANDOFF_CSV), str(TOKENIZER_JSON), str(s2_dir))
    results["stage2"] = r2
    if not r2["success"]:
        return jsonify(results)

    r3 = run_stage3(str(s2_dir), str(s3_dir))
    results["stage3"] = r3

    r4 = run_stage4(str(s3_dir), str(s4_dir))
    results["stage4"] = r4

    results["success"] = True
    results["message"] = "Full pipeline completed."
    return jsonify(results)


# ──────────────────────────────────────────────────────────
#  Entry point
# ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("  FlexiGEN Backend API  — http://127.0.0.1:5000")
    print("=" * 55)
    app.run(debug=True, host="0.0.0.0", port=5000)

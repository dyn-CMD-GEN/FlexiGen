# FlexiGEN — Pocket-Conditioned Drug Discovery Pipeline

A full-stack pipeline for pocket-conditioned molecular generation, connecting 4 stages from PDB input to lead compound ranking.

---

## Project Layout

```
FlexiGEN/
├── backend/
│   ├── app.py                  # Flask REST API
│   ├── pipeline_stages.py      # Stage 1–4 implementations
│   ├── uploads/                # Uploaded PDB files
│   └── outputs/
│       ├── stage1/             # Conformers + pharmacophore tensors
│       ├── stage2/             # 2D topology candidates
│       ├── stage3/             # Docking results (stub)
│       └── stage4/             # ADMET leads (stub)
├── frontend/
│   ├── index.html              # Single-page application
│   ├── style.css               # Dark-theme UI
│   └── app.js                  # Pipeline orchestration JS
├── Member2_Outputs_For_M3/     # Stage-2 handoff files
│   ├── member2_exploratory_M3_handoff.csv
│   └── smiles_tokenizer.json
└── start_backend.bat           # One-click server start (Windows)
```

---

## Running the App

### 1. Start the backend
```bat
start_backend.bat
```
Or manually:
```bash
cd backend
python app.py
```
Server runs at **http://127.0.0.1:5000**

### 2. Open the frontend
Open `frontend/index.html` in any modern browser.

---

## Pipeline Stages

| Stage | Purpose | Status |
|-------|---------|--------|
| **Stage 1** | PDB upload → K pocket conformers + pharmacophore tensor (K×N×4) | ✅ Implemented |
| **Stage 2** | Pocket tensor + Member-2 handoff → 2D SMILES topology candidates | ✅ Implemented |
| **Stage 3** | 3D conformer generation + docking scoring | 🔧 Stub — connect AutoDock Vina / Glide |
| **Stage 4** | ADMET property filtering + lead ranking | 🔧 Stub — connect pkCSM / SwissADME |

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/health` | Server health + file availability |
| POST | `/api/stage1/run` | Upload PDB, generate conformers/tensor |
| GET  | `/api/stage1/status/<run_id>` | Stage 1 results |
| GET  | `/api/stage1/download/<run_id>/<file>` | Download output files |
| POST | `/api/stage2/run` | Generate 2D topology candidates |
| GET  | `/api/stage2/candidates/<run_id>` | JSON list of SMILES candidates |
| POST | `/api/stage3/run` | Run docking stub |
| POST | `/api/stage4/run` | Run ADMET stub |
| POST | `/api/pipeline/full` | Run all 4 stages in one call |

---

## Extending Stages 3 & 4

Edit `backend/pipeline_stages.py`:

**Stage 3** — replace `run_stage3()` body with real docking:
```python
# Example: AutoDock Vina
import subprocess
subprocess.run(["vina", "--receptor", receptor_pdbqt,
                "--ligand", ligand_pdbqt, "--out", output_pdbqt, ...])
```

**Stage 4** — replace `run_stage4()` body with real ADMET:
```python
# Example: pkCSM API or DeepPurpose
import requests
r = requests.post("https://biosig.lab.uq.edu.au/pkcsm/api/...", json={"smiles": smiles})
```

---

## Member-2 Handoff Files

| File | Contents |
|------|----------|
| `member2_exploratory_M3_handoff.csv` | 2 exploratory SMILES (M2_EXP_001, M2_EXP_002) with Lipinski properties |
| `smiles_tokenizer.json` | 81-token SMILES vocabulary (ChEMBL-37 derived) for pocket-conditioned transformer |

> ⚠ Member-2 outputs are **exploratory/unvalidated**. Biological activity has not been confirmed.

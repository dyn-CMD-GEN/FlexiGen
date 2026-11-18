"""
FlexiGEN Stage 4 — Docking, Relaxation & GNINA Deep Rescoring
==============================================================
Implements the full Stage 4 pipeline from Stage4.ipynb:

  Step A  : AutoDock Vina pocket docking
  Step B  : Protein–ligand complex assembly (OpenMM system)
  Step C  : Constrained OpenMM energy minimisation
  Step D  : GNINA deep neural-network rescoring  (optional — needs gnina binary)
  QC Gate : RMSD / energy filter → stage5_input_manifest.csv

Dependencies (pip-installable on Windows):
  pip install vina meeko openmm pdbfixer

GNINA:
  Windows: not natively supported.
  Run via WSL2 or use the stub scorer (returns None) if binary absent.
  Binary detection: PATH lookup for 'gnina' or 'gnina.exe'.
"""

import os, json, shutil, subprocess, warnings
from pathlib import Path
import numpy as np
import pandas as pd

# ── optional imports ──────────────────────────────────────────
try:
    from rdkit import Chem
    from rdkit.Chem import AllChem, rdDetermineBonds
    _RDKIT = True
except ImportError:
    _RDKIT = False
    warnings.warn("RDKit not found — Stage 4 ligand preparation disabled.")

try:
    import openmm as mm
    from openmm import app, unit
    _OPENMM = True
except ImportError:
    _OPENMM = False
    warnings.warn("OpenMM not found — Stage 4 relaxation disabled.")

try:
    from vina import Vina
    _VINA = True
except ImportError:
    _VINA = False
    warnings.warn("AutoDock Vina Python bindings not found — will use binary fallback if available.")

# ── Vina binary fallback (Windows .exe) ──────────────────────
def _find_vina_binary():
    """Locate AutoDock Vina binary (exe or system command)."""
    bin_dir = Path(__file__).parent / "bin"
    candidates = [
        str(bin_dir / "vina.exe"),
        str(bin_dir / "vina"),
        os.path.expandvars(r"%LOCALAPPDATA%\vina.exe"),
        os.path.expanduser(r"~\AppData\Local\vina.exe"),
        r"C:\Program Files\AutoDock Vina\vina.exe",
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    for name in ("vina", "vina.exe", "vina_1.2.7_win.exe"):
        found = shutil.which(name)
        if found:
            return found
    return None

VINA_BIN = _find_vina_binary()
_VINA_BIN_OK = VINA_BIN is not None   # can use subprocess docking

try:
    import pdbfixer
    _PDBFIXER = True
except ImportError:
    _PDBFIXER = False
    warnings.warn("pdbfixer not found — protein cleaning disabled.")

try:
    import meeko
    from meeko import MoleculePreparation, PDBQTMolecule, RDKitMolCreate
    _MEEKO = True
except ImportError:
    _MEEKO = False
    warnings.warn("meeko not found — PDBQT preparation disabled.")

# ── GNINA binary detection ──────────────────────────────────────
def _find_gnina():
    """Return path to gnina binary if found, else None."""
    bin_dir = Path(__file__).parent / "bin"
    candidates = [
        str(bin_dir / "gnina.bat"),
        str(bin_dir / "gnina.exe"),
        str(bin_dir / "gnina"),
        "/usr/bin/gnina",
        "/usr/local/bin/gnina",
        "/usr/local/bin/gnina.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\gnina.exe"),
        os.path.expanduser(r"~\AppData\Local\gnina.exe")
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    for name in ("gnina", "gnina.exe", "gnina.bat"):
        found = shutil.which(name)
        if found:
            return found
    return None

GNINA_BIN = _find_gnina()


# ════════════════════════════════════════════════════════════════
#  STEP A — Ligand preparation + AutoDock Vina docking
# ════════════════════════════════════════════════════════════════
def prepare_ligand_to_pdbqt(input_path: str, out_dir: str):
    """
    Auto-detects .npz, .sdf, or .pdbqt and prepares a valid Vina PDBQT.
    Returns (pdbqt_path, rdkit_mol_or_None).
    Verbatim from Stage4.ipynb Cell 5.
    """
    if not _RDKIT or not _MEEKO:
        raise RuntimeError("RDKit and meeko required for ligand preparation.")

    if input_path.endswith('.pdbqt'):
        return input_path, None

    mol = None
    if input_path.endswith('.npz'):
        data = np.load(input_path, allow_pickle=True)
        coords = data['pos'] if 'pos' in data else data['coords']
        atomic_nums = data['atom_types'] if 'atom_types' in data else data['elements']

        rwmol = Chem.RWMol()
        conf = Chem.Conformer(len(atomic_nums))
        for i, z in enumerate(atomic_nums):
            a_idx = rwmol.AddAtom(Chem.Atom(int(z)))
            conf.SetAtomPosition(a_idx, coords[i].tolist())
        rwmol.AddConformer(conf)
        mol = rwmol.GetMol()
        try:
            rdDetermineBonds.DetermineConnectivity(mol)
            rdDetermineBonds.DetermineBondOrders(mol, charge=0)
        except Exception:
            pass
    elif input_path.endswith('.sdf'):
        suppl = Chem.SDMolSupplier(input_path, removeHs=False)
        mol = suppl[0] if suppl else None

    if mol is None:
        raise ValueError(f"Could not parse molecule from {input_path}")

    mol = Chem.AddHs(mol, addCoords=True)
    prep = MoleculePreparation()
    mol_prep_list = prep.prepare(mol)
    pdbqt_str = meeko.PDBQTWriterLegacy.write_string(mol_prep_list[0])[0]

    pdbqt_out = os.path.join(out_dir, "prepared_ligand.pdbqt")
    with open(pdbqt_out, "w") as f:
        f.write(pdbqt_str)
    return pdbqt_out, mol


def run_vina_docking(receptor_pdbqt: str, ligand_path: str,
                     center: list, box_size: list,
                     outdir: str, exhaustiveness: int = 4, num_modes: int = 3,
                     cpu_count: int = None):
    """
    Run AutoDock Vina pocket docking.
    Verbatim from Stage4.ipynb Cell 5 with CPU allocation.
    Returns dict with keys: docked_sdf, docked_pdbqt, scores_csv, top_score.
    """
    if not _VINA and not _VINA_BIN_OK:
        return {"success": False, "message": "AutoDock Vina not installed (neither vina package nor binary found)"}

    os.makedirs(outdir, exist_ok=True)
    ligand_pdbqt, original_mol = prepare_ligand_to_pdbqt(ligand_path, outdir)
    docked_pdbqt_path = os.path.join(outdir, "docked_poses.pdbqt")

    if _VINA:
        v = Vina(sf_name='vina', cpu=(cpu_count or 2))
        v.set_receptor(receptor_pdbqt)
        v.set_ligand_from_file(ligand_pdbqt)
        v.compute_vina_maps(center=center, box_size=box_size)
        v.dock(exhaustiveness=exhaustiveness, n_poses=num_modes)
        v.write_poses(docked_pdbqt_path, n_poses=num_modes, overwrite=True)

        energies = v.energies(n_poses=num_modes)
        scores = [{"mode": i+1, "affinity_kcal_mol": e[0],
                   "rmsd_lb": e[1], "rmsd_ub": e[2]} for i, e in enumerate(energies)]
        top_score = energies[0][0] if energies else None
    else:
        # Run via AutoDock Vina binary CLI with apportioned CPU allocation
        effective_cpu = cpu_count if cpu_count is not None else max(1, (os.cpu_count() or 4) // 2)
        cmd = [
            VINA_BIN,
            "--receptor", receptor_pdbqt,
            "--ligand", ligand_pdbqt,
            "--center_x", str(center[0]),
            "--center_y", str(center[1]),
            "--center_z", str(center[2]),
            "--size_x", str(box_size[0]),
            "--size_y", str(box_size[1]),
            "--size_z", str(box_size[2]),
            "--exhaustiveness", str(exhaustiveness),
            "--num_modes", str(num_modes),
            "--cpu", str(effective_cpu),
            "--out", docked_pdbqt_path,
        ]
        p = subprocess.run(cmd, capture_output=True, text=True)
        scores = []
        if os.path.exists(docked_pdbqt_path):
            mode = 1
            with open(docked_pdbqt_path) as f:
                for line in f:
                    if line.startswith("REMARK VINA RESULT:"):
                        parts = line.split()
                        if len(parts) >= 4:
                            scores.append({
                                "mode": mode,
                                "affinity_kcal_mol": float(parts[3]),
                                "rmsd_lb": float(parts[4]) if len(parts) > 4 else 0.0,
                                "rmsd_ub": float(parts[5]) if len(parts) > 5 else 0.0,
                            })
                            mode += 1
        top_score = scores[0]["affinity_kcal_mol"] if scores else None

    scores_csv = os.path.join(outdir, "docking_scores.csv")
    pd.DataFrame(scores).to_csv(scores_csv, index=False)

    # Export Mode 1 to docked_pose.sdf via meeko
    docked_sdf_path = os.path.join(outdir, "docked_pose.sdf")
    try:
        pdbqt_mol = PDBQTMolecule.from_file(docked_pdbqt_path, is_dlg=False)
        mols = RDKitMolCreate.from_pdbqt_mol(pdbqt_mol)
        if mols:
            w = Chem.SDWriter(docked_sdf_path)
            w.write(mols[0]); w.close()
    except Exception:
        pass

    # Fail-safe: transfer Mode 1 coordinates onto original mol
    if not os.path.exists(docked_sdf_path) and original_mol is not None:
        coords = []
        with open(docked_pdbqt_path) as f:
            for line in f:
                if line.startswith("MODEL 2") or line.startswith("ENDMDL"):
                    break
                if line.startswith(("ATOM", "HETATM")):
                    coords.append([float(line[30:38]), float(line[38:46]), float(line[46:54])])
        if len(coords) == original_mol.GetNumAtoms():
            conf = original_mol.GetConformer()
            for i, (x, y, z) in enumerate(coords):
                conf.SetAtomPosition(i, Chem.rdGeometry.Point3D(x, y, z))
            w = Chem.SDWriter(docked_sdf_path)
            w.write(original_mol); w.close()

    return {
        "success": os.path.exists(docked_sdf_path),
        "docked_sdf":    docked_sdf_path if os.path.exists(docked_sdf_path) else None,
        "docked_pdbqt":  docked_pdbqt_path,
        "scores_csv":    scores_csv,
        "top_score_kcal_mol": top_score,
    }


# ════════════════════════════════════════════════════════════════
#  STEP B — Protein–ligand complex assembly
# ════════════════════════════════════════════════════════════════
def build_complex_system(target_clean_pdb: str, docked_sdf: str, outdir: str,
                         base_system_xml: str = None, n_prot_atoms: int = None):
    """
    Build OpenMM protein–ligand system.
    Returns paths: complex_pdb, system_xml, ligand_indices_json, protein_indices_json.
    """
    if not _OPENMM:
        return {"success": False, "message": "OpenMM not installed (pip install openmm)"}
    if not _RDKIT:
        return {"success": False, "message": "RDKit required."}

    os.makedirs(outdir, exist_ok=True)

    if base_system_xml and n_prot_atoms:
        system = mm.XmlSerializer.deserialize(base_system_xml)
        n_prot = n_prot_atoms
    else:
        prot_pdb   = app.PDBFile(target_clean_pdb)
        forcefield = app.ForceField('amber14-all.xml')
        system     = forcefield.createSystem(
            prot_pdb.topology,
            nonbondedMethod=app.CutoffNonPeriodic,
            nonbondedCutoff=1.2 * unit.nanometers,
            constraints=app.HBonds
        )
        n_prot = prot_pdb.topology.getNumAtoms()

    suppl = Chem.SDMolSupplier(docked_sdf, removeHs=False)
    mol   = suppl[0] if suppl else None
    if mol is None:
        raise ValueError(f"Cannot load docked SDF: {docked_sdf}")

    mol = Chem.AddHs(mol, addCoords=True)
    AllChem.ComputeGasteigerCharges(mol)
    conf = mol.GetConformer()

    n_lig    = mol.GetNumAtoms()
    prot_idx = list(range(n_prot))
    lig_idx  = list(range(n_prot, n_prot + n_lig))

    # Nonbonded force
    nbf = None
    for fi in range(system.getNumForces()):
        f = system.getForce(fi)
        if isinstance(f, mm.NonbondedForce):
            nbf = f; break

    vdw = {'H':0.12,'C':0.17,'N':0.155,'O':0.152,'F':0.147,'P':0.18,'S':0.18,'Cl':0.175,'Br':0.185,'I':0.198}
    for atom in mol.GetAtoms():
        system.addParticle(atom.GetMass() * unit.amu)
        elem  = atom.GetSymbol()
        sigma = 2.0 * vdw.get(elem, 0.17) * unit.nanometers
        eps   = 0.40 * unit.kilojoules_per_mole
        try:
            q = float(atom.GetProp('_GasteigerCharge'))
            if np.isnan(q): q = 0.0
        except Exception:
            q = 0.0
        if nbf:
            nbf.addParticle(q * unit.elementary_charge, sigma, eps)

    bond_force = mm.HarmonicBondForce()
    for bond in mol.GetBonds():
        i  = bond.GetBeginAtomIdx() + n_prot
        j  = bond.GetEndAtomIdx()   + n_prot
        p1 = conf.GetAtomPosition(bond.GetBeginAtomIdx())
        p2 = conf.GetAtomPosition(bond.GetEndAtomIdx())
        d  = np.sqrt((p1.x-p2.x)**2+(p1.y-p2.y)**2+(p1.z-p2.z)**2)*0.1
        bond_force.addBond(i, j, d*unit.nanometer,
                           250000.0*unit.kilojoules_per_mole/(unit.nanometer**2))
    system.addForce(bond_force)

    lig_idx_file  = os.path.join(outdir, "ligand_indices.json")
    prot_idx_file = os.path.join(outdir, "protein_indices.json")
    with open(lig_idx_file,  "w") as f: json.dump(lig_idx,  f)
    with open(prot_idx_file, "w") as f: json.dump(prot_idx, f)

    # Combined complex PDB
    complex_pdb = os.path.join(outdir, "initial_complex.pdb")
    with open(target_clean_pdb) as rf, open(complex_pdb, "w") as wf:
        for line in rf:
            if line.startswith(("ATOM", "HETATM")):
                wf.write(line)
        for atom in mol.GetAtoms():
            pos = conf.GetAtomPosition(atom.GetIdx())
            elem = atom.GetSymbol()
            atom_name = f"{elem}{atom.GetIdx()+1}"[:4]
            wf.write(f"HETATM{atom.GetIdx()+1:>5} {atom_name:<4} LIG L   1    "
                     f"{pos.x:8.3f}{pos.y:8.3f}{pos.z:8.3f}  1.00  0.00          {elem:>2}\n")
        wf.write("END\n")

    system_xml = os.path.join(outdir, "system.xml")

    return {
        "success":         True,
        "complex_pdb":     complex_pdb,
        "system_xml":      system_xml,
        "system_obj":      system,
        "ligand_indices":  lig_idx,
        "protein_indices": prot_idx,
        "n_protein_atoms": n_prot,
        "n_ligand_atoms":  n_lig,
    }


# ════════════════════════════════════════════════════════════════
#  STEP C — Constrained OpenMM energy minimisation
# ════════════════════════════════════════════════════════════════
def run_openmm_relaxation(complex_pdb: str, system_xml: str = None,
                          ligand_indices_json: str = None, protein_indices_json: str = None,
                          outdir: str = "", max_iterations: int = 40,
                          record_every: int = 10, restraint_k: float = 1000.0,
                          system_obj = None, ligand_indices: list = None,
                          protein_indices: list = None):
    """
    OpenMM constrained relaxation with protein backbone restraints.
    Runs fast in-memory minimization without redundant disk I/O.
    """
    if not _OPENMM:
        return {"success": False, "message": "OpenMM not installed."}

    os.makedirs(outdir, exist_ok=True)

    if ligand_indices is not None:
        lig_idx = ligand_indices
    elif ligand_indices_json and os.path.exists(ligand_indices_json):
        with open(ligand_indices_json) as f: lig_idx = json.load(f)
    else:
        lig_idx = []

    if protein_indices is not None:
        prot_idx = protein_indices
    elif protein_indices_json and os.path.exists(protein_indices_json):
        with open(protein_indices_json) as f: prot_idx = json.load(f)
    else:
        prot_idx = []

    if system_obj is not None:
        system = system_obj
    elif system_xml and os.path.exists(system_xml):
        with open(system_xml) as f: system = mm.XmlSerializer.deserialize(f.read())
    else:
        return {"success": False, "message": "No OpenMM system provided."}

    pdb = app.PDBFile(complex_pdb)

    # Harmonic protein restraints
    restraint = mm.CustomExternalForce("0.5*k*((x-x0)^2+(y-y0)^2+(z-z0)^2)")
    restraint.addGlobalParameter("k", restraint_k * unit.kilojoule_per_mole/(unit.nanometer**2))
    for pname in ("x0","y0","z0"):
        restraint.addPerParticleParameter(pname)
    init_pos = list(pdb.positions)
    n_particles = system.getNumParticles()
    if len(init_pos) != n_particles:
        if len(init_pos) > n_particles:
            init_pos = init_pos[:n_particles]
        else:
            last = init_pos[-1] if len(init_pos) > 0 else mm.Vec3(0,0,0)*unit.nanometers
            init_pos = list(init_pos) + [last] * (n_particles - len(init_pos))

    for idx in prot_idx:
        if idx < len(init_pos):
            pos = init_pos[idx].value_in_unit(unit.nanometers)
            restraint.addParticle(idx, [pos[0], pos[1], pos[2]])
    system.addForce(restraint)

    available = [mm.Platform.getPlatform(i).getName() for i in range(mm.Platform.getNumPlatforms())]
    pname  = 'CUDA' if 'CUDA' in available else ('OpenCL' if 'OpenCL' in available else 'CPU')
    plat   = mm.Platform.getPlatformByName(pname)
    ctx    = mm.Context(system, mm.VerletIntegrator(1.0*unit.femtoseconds), plat)
    ctx.setPositions(init_pos)

    try:
        init_pos_arr = np.array(init_pos.value_in_unit(unit.angstroms))
    except AttributeError:
        init_pos_arr = np.array([p.value_in_unit(unit.angstroms) for p in init_pos])
    s0    = ctx.getState(getEnergy=True, getForces=True, getPositions=True)
    e0    = s0.getPotentialEnergy().value_in_unit(unit.kilojoules_per_mole)
    f0    = np.array(s0.getForces().value_in_unit(unit.kilojoule_per_mole/unit.nanometer))
    mf0   = float(np.max(np.linalg.norm(f0, axis=-1)))

    trace = [{"iteration":0,"ligand_rmsd_A":0.0,"potential_energy_kJ_mol":e0,"max_force_kJ_mol_nm":mf0}]
    # Continuous OpenMM minimization (avoids resetting L-BFGS optimizer 50 times)
    max_iters = min(int(max_iterations or 100), 200)
    mm.LocalEnergyMinimizer.minimize(
        ctx,
        tolerance=10.0 * unit.kilojoules_per_mole / unit.nanometer,
        maxIterations=max_iters
    )
    st   = ctx.getState(getEnergy=True, getForces=True, getPositions=True)
    cp   = np.array(st.getPositions().value_in_unit(unit.angstroms))
    en   = st.getPotentialEnergy().value_in_unit(unit.kilojoules_per_mole)
    fo   = np.array(st.getForces().value_in_unit(unit.kilojoule_per_mole/unit.nanometer))
    mf   = float(np.max(np.linalg.norm(fo, axis=-1)))
    diff = cp[ligand_indices] - init_pos_arr[ligand_indices]
    rmsd = float(np.sqrt(np.mean(np.sum(diff**2, axis=-1))))
    trace.append({"iteration": max_iters, "ligand_rmsd_A": rmsd,
                  "potential_energy_kJ_mol": en, "max_force_kJ_mol_nm": mf})

    pd.DataFrame(trace).to_csv(os.path.join(outdir,"relaxation_trace.csv"), index=False)
    relaxed_pdb = os.path.join(outdir, "relaxed_complex.pdb")
    with open(relaxed_pdb, "w") as f:
        app.PDBFile.writeFile(pdb.topology, st.getPositions(), f)

    final = trace[-1]
    summary = {
        "success":                   True,
        "platform":                  pname,
        "initial_energy_kJ_mol":     e0,
        "final_energy_kJ_mol":       final["potential_energy_kJ_mol"],
        "energy_change_kJ_mol":      final["potential_energy_kJ_mol"] - e0,
        "final_ligand_rmsd_A":       final["ligand_rmsd_A"],
        "final_max_force_kJ_mol_nm": final["max_force_kJ_mol_nm"],
        "restraint_k":               restraint_k,
        "relaxed_pdb_path":          relaxed_pdb,
    }
    with open(os.path.join(outdir,"relaxation_summary.json"),"w") as f:
        json.dump(summary, f, indent=2)
    return summary


# ════════════════════════════════════════════════════════════════
#  STEP D — GNINA deep neural-network rescoring
# ════════════════════════════════════════════════════════════════
def run_gnina_rescoring(receptor_pdb: str, ligand_sdf: str,
                        center: list, box_size: list,
                        outdir: str) -> dict:
    """
    Run GNINA deep rescoring on a relaxed pose.

    GNINA uses a CNN-based scoring function (default: gnina) trained on PDBbind.
    Outputs:  CNNscore (binding probability 0-1), CNNaffinity (pKd estimate),
              Vina score (for comparison).

    If GNINA binary is not found, returns a stub result with score=None.

    See: https://github.com/gnina/gnina
    Install on Linux:  wget https://github.com/gnina/gnina/releases/download/v1.3/gnina
                       chmod +x gnina && mv gnina /usr/local/bin/
    Windows: use WSL2 and set the binary path in PATH.
    """
    os.makedirs(outdir, exist_ok=True)
    result_json = os.path.join(outdir, "gnina_scores.json")

    # Fast path: in-process GNINA CNN rescoring (avoids Windows subprocess spawn overhead)
    try:
        from bin.gnina_rescore import compute_cnn_scores
        cnn_score, cnn_affinity, vina_score = compute_cnn_scores(receptor_pdb, ligand_sdf)
        res = {
            "success":      True,
            "gnina_found":  True,
            "CNNscore":     round(float(cnn_score), 4),
            "CNNaffinity":  round(float(cnn_affinity), 3),
            "vina_score":   round(float(vina_score), 2),
        }
        with open(result_json, "w") as f:
            json.dump(res, f, indent=2)
        return res
    except Exception:
        pass

    if GNINA_BIN is None:
        stub = {
            "success":      False,
            "gnina_found":  False,
            "message":      (
                "GNINA binary not found. Install from https://github.com/gnina/gnina "
                "and ensure it is on PATH. On Windows use WSL2."
            ),
            "CNNscore":     None,
            "CNNaffinity":  None,
            "vina_score":   None,
        }
        with open(result_json, "w") as f:
            json.dump(stub, f, indent=2)
        return stub

    out_sdf = os.path.join(outdir, "gnina_out.sdf")
    cmd = [
        GNINA_BIN,
        "--receptor",   receptor_pdb,
        "--ligand",     ligand_sdf,
        "--center_x",   str(center[0]),
        "--center_y",   str(center[1]),
        "--center_z",   str(center[2]),
        "--size_x",     str(box_size[0]),
        "--size_y",     str(box_size[1]),
        "--size_z",     str(box_size[2]),
        "--out",        out_sdf,
        "--cnn_scoring","rescore",   # rescore existing pose (no new docking search)
        "--num_modes",  "1",
        "--cpu",        "1",
    ]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        raw_out = p.stdout + p.stderr
    except subprocess.TimeoutExpired:
        return {"success": False, "message": "GNINA timed out.", "CNNscore": None, "CNNaffinity": None}
    except FileNotFoundError:
        return {"success": False, "message": "GNINA binary not executable.", "CNNscore": None, "CNNaffinity": None}

    # Parse GNINA output — look for lines like:
    #   "CNNscore  0.843"  or  "CNNaffinity  7.21"  or  "   1    -7.4    0.00  0.00"
    cnn_score    = None
    cnn_affinity = None
    vina_score   = None
    for line in raw_out.splitlines():
        line = line.strip()
        if line.lower().startswith("cnnscore"):
            parts = line.split()
            if len(parts) >= 2:
                try: cnn_score = float(parts[1])
                except ValueError: pass
        elif line.lower().startswith("cnnaffinity"):
            parts = line.split()
            if len(parts) >= 2:
                try: cnn_affinity = float(parts[1])
                except ValueError: pass
        # Vina score table line:  "   1    -7.4    0.00   0.00"
        elif line and line[0].isdigit():
            parts = line.split()
            if len(parts) >= 2:
                try: vina_score = float(parts[1])
                except ValueError: pass

    scores = {
        "success":      p.returncode == 0,
        "gnina_found":  True,
        "CNNscore":     cnn_score,
        "CNNaffinity":  cnn_affinity,
        "vina_score":   vina_score,
        "gnina_out_sdf": out_sdf if os.path.exists(out_sdf) else None,
        "returncode":   p.returncode,
        "stdout":       raw_out[:1000],
    }
    with open(result_json, "w") as f:
        json.dump(scores, f, indent=2)
    return scores


# ════════════════════════════════════════════════════════════════
#  QC GATE
# ════════════════════════════════════════════════════════════════
def _qc_verdict(row: dict, rmsd_cutoff: float = 2.5) -> str:
    """
    QC gate from Stage4.ipynb Cell 11.
    Returns PASS_QC | FLAG_UNSTABLE_ENERGY | FLAG_HIGH_DISPLACEMENT | REJECT_<status>
    """
    if row.get("status") != "SUCCESS":
        return f"REJECT_{row.get('status','ERROR')}"
    if row.get("energy_change_kJ_mol") is not None and row["energy_change_kJ_mol"] > 0:
        return "FLAG_UNSTABLE_ENERGY"
    if row.get("final_ligand_rmsd_A") is not None and row["final_ligand_rmsd_A"] > rmsd_cutoff:
        return "FLAG_HIGH_DISPLACEMENT"
    return "PASS_QC"


# ════════════════════════════════════════════════════════════════
#  PROTEIN PREPARATION (PDBFixer)
# ════════════════════════════════════════════════════════════════
def prepare_receptor(raw_pdb: str, out_dir: str, ph: float = 7.4):
    """
    Clean protein with PDBFixer and generate receptor PDBQT.
    Verbatim from Stage4.ipynb Cell 8.
    Returns (clean_pdb_path, receptor_pdbqt_path, pocket_center).
    """
    os.makedirs(out_dir, exist_ok=True)
    clean_pdb  = os.path.join(out_dir, "receptor_clean.pdb")
    pdbqt_path = os.path.join(out_dir, "receptor_clean.pdbqt")

    if _PDBFIXER:
        from pdbfixer import PDBFixer
        from openmm import app as _app
        fixer = PDBFixer(filename=raw_pdb)
        fixer.findMissingResidues()
        fixer.findNonstandardResidues()
        fixer.replaceNonstandardResidues()
        fixer.removeHeterogens(keepWater=False)
        fixer.findMissingAtoms()
        fixer.addMissingAtoms()
        fixer.addMissingHydrogens(ph)
        with open(clean_pdb, "w") as f:
            _app.PDBFile.writeFile(fixer.topology, fixer.positions, f)
    else:
        # Fallback: strip HETATM lines
        with open(raw_pdb) as rf, open(clean_pdb, "w") as wf:
            for line in rf:
                if line.startswith("ATOM"):
                    wf.write(line)
        warnings.warn("pdbfixer not installed — using simple HETATM strip. Install pdbfixer for proper protonation.")

    # Detect pocket centre from co-crystallised ligand in the ORIGINAL raw PDB
    lig_coords = []
    with open(raw_pdb) as f:
        for line in f:
            if line.startswith("HETATM") and "HOH" not in line:
                try:
                    lig_coords.append([float(line[30:38]), float(line[38:46]), float(line[46:54])])
                except ValueError:
                    pass
    pocket_center = np.mean(lig_coords, axis=0).round(2).tolist() if lig_coords else None

    # Generate receptor PDBQT
    receptor_lines = []
    with open(clean_pdb) as f:
        for line in f:
            if line.startswith("ATOM"):
                elem = line[76:78].strip().upper()
                if not elem:
                    name_clean = line[12:16].strip().lstrip("0123456789")
                    elem = name_clean[0].upper() if name_clean else "C"
                if   elem == "H":  ad_type = "HD"
                elif elem == "C":  ad_type = "C"
                elif elem == "N":  ad_type = "NA" if "HIS" in line else "N"
                elif elem == "O":  ad_type = "OA"
                elif elem == "S":  ad_type = "SA"
                elif elem == "P":  ad_type = "P"
                elif elem in ("ZN","FE","MG","CA","MN"): ad_type = elem.capitalize()
                else:              ad_type = elem
                base = line[:66].ljust(70)
                receptor_lines.append(f"{base} 0.000 {ad_type:>2}\n")

    with open(pdbqt_path, "w") as f:
        f.writelines(receptor_lines)

    return clean_pdb, pdbqt_path, pocket_center


# ════════════════════════════════════════════════════════════════
#  MASTER ENTRY POINT
# ════════════════════════════════════════════════════════════════
def run_stage4_full(
    sdf_paths:        list,          # List of .sdf file paths from Stage 3
    candidate_ids:    list,          # Parallel list of candidate IDs
    receptor_pdb:     str,           # Path to raw/prepared receptor PDB
    output_dir:       str,
    pocket_center:    list = None,   # [x, y, z] — auto-detected if None
    box_size:         list = None,   # [sx, sy, sz] in Å, default 20×20×20
    exhaustiveness:   int  = 8,
    num_modes:        int  = 3,
    max_mm_iters:     int  = 500,
    restraint_k:      float = 1000.0,
    run_gnina:        bool  = True,
    rmsd_cutoff:      float = 2.5,
    smiles_list:      list = None,   # Optional parallel list of SMILES strings
):
    """
    Full Stage 4: Vina docking → OpenMM relaxation → GNINA rescoring → QC manifest.

    Returns summary dict with per-candidate records + stage5_manifest path.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    receptor_dir = out / "receptor"
    receptor_dir.mkdir(exist_ok=True)

    if box_size is None:
        box_size = [20.0, 20.0, 20.0]

    # ── Prepare receptor ──────────────────────────────────────
    clean_pdb, receptor_pdbqt, auto_center = prepare_receptor(str(receptor_pdb), str(receptor_dir))
    if pocket_center is None:
        pocket_center = auto_center

    if pocket_center is None:
        # Fallback 1: Derive pocket center from Stage 1 dynamic pocket conformer tensor
        stem_parts = Path(receptor_pdb).stem.split('_')
        run_id_guess = stem_parts[0] if stem_parts else None
        if run_id_guess:
            s1_npz = Path(receptor_pdb).parent.parent / "outputs" / "stage1" / run_id_guess / "pocket_tensor.npz"
            if s1_npz.exists():
                try:
                    d = np.load(s1_npz)
                    t = d["tensor"]
                    m = d["mask"]
                    active = t[0, m[0].astype(bool), :3]
                    if len(active) > 0:
                        pocket_center = [round(float(v), 2) for v in active.mean(axis=0)]
                except Exception:
                    pass

    if pocket_center is None:
        # Fallback 2: Compute geometric center of receptor CA atoms
        try:
            coords = []
            with open(clean_pdb) as f:
                for line in f:
                    if line.startswith("ATOM") and line[12:16].strip() == "CA":
                        coords.append([float(line[30:38]), float(line[38:46]), float(line[46:54])])
            if coords:
                pocket_center = [round(float(v), 2) for v in np.mean(coords, axis=0)]
        except Exception:
            pass

    if pocket_center is None:
        return {"success": False, "message": "Cannot detect pocket center. No receptor coordinates available."}

    # ── Pre-build base OpenMM protein system once for all candidates ──
    base_protein_system_xml = None
    n_prot_atoms = None
    if _OPENMM and os.path.exists(clean_pdb):
        try:
            prot_pdb = app.PDBFile(clean_pdb)
            forcefield = app.ForceField('amber14-all.xml')
            base_sys = forcefield.createSystem(
                prot_pdb.topology,
                nonbondedMethod=app.CutoffNonPeriodic,
                nonbondedCutoff=1.2 * unit.nanometers,
                constraints=app.HBonds
            )
            base_protein_system_xml = mm.XmlSerializer.serialize(base_sys)
            n_prot_atoms = prot_pdb.topology.getNumAtoms()
        except Exception:
            base_protein_system_xml = None

    dep_status = {
        "vina":     _VINA,
        "openmm":   _OPENMM,
        "pdbfixer": _PDBFIXER,
        "meeko":    _MEEKO,
        "gnina":    GNINA_BIN is not None,
        "gnina_path": GNINA_BIN,
    }

    from concurrent.futures import ThreadPoolExecutor, as_completed
    n_workers = min(3, max(1, os.cpu_count() or 2))
    cpu_per_worker = max(1, (os.cpu_count() or 4) // n_workers)

    def _process_candidate(item):
        idx, (lig_sdf, cand_id) = item
        pair_id    = f"{cand_id}__P1"
        pair_dir   = out / pair_id
        dock_dir   = pair_dir / "docking"
        pair_dir.mkdir(parents=True, exist_ok=True)
        smi = smiles_list[idx] if (smiles_list and idx < len(smiles_list)) else ""
        record = {
            "candidate_id": cand_id,
            "record_id": cand_id,
            "smiles": smi,
            "conformer_id": "P1",
            "pair_id": pair_id,
            "vina_top_score": None,
            "vina_score_kcal_mol": None,
            "final_ligand_rmsd_A": None,
            "rmsd": None,
            "rmsd_A": None,
            "gnina_CNNscore": None,
            "gnina_CNNaffinity": None,
        }

        try:
            # Step A — Vina docking
            if (_VINA or _VINA_BIN_OK) and _MEEKO:
                dock_res = run_vina_docking(
                    receptor_pdbqt, lig_sdf, pocket_center, box_size,
                    str(dock_dir), exhaustiveness, num_modes,
                    cpu_count=cpu_per_worker
                )
                v_score = dock_res.get("top_score_kcal_mol")
                record["vina_top_score"] = v_score
                record["vina_score_kcal_mol"] = v_score
                record["docked_sdf"]     = dock_res.get("docked_sdf")
                if not dock_res.get("success"):
                    record["status"] = "FAILED_DOCKING"
                    record["error"]  = dock_res.get("message", "Vina failed")
                    return record
            else:
                # No Vina — use Stage 3 SDF directly as "docked" pose
                dock_sdf = str(pair_dir / "docked_pose.sdf")
                shutil.copy(lig_sdf, dock_sdf)
                record["docked_sdf"]     = dock_sdf
                record["vina_top_score"] = None
                record["status_note"]    = "Vina not installed — using Stage 3 SDF directly"

            docked_sdf = record["docked_sdf"]

            # Step B — Complex assembly
            if _OPENMM:
                build_res = build_complex_system(
                    clean_pdb, docked_sdf, str(pair_dir),
                    base_system_xml=base_protein_system_xml,
                    n_prot_atoms=n_prot_atoms
                )
                if not build_res.get("success"):
                    record["status"] = "FAILED_ASSEMBLY"
                    record["error"]  = build_res.get("message","")
                    return record

                # Step C — Fast in-memory OpenMM relaxation
                # Keep iterations optimal (30-50 iterations converges nicely on CPU)
                eff_max_iters = min(int(max_mm_iters or 40), 100)
                relax_res = run_openmm_relaxation(
                    build_res["complex_pdb"],
                    system_xml=build_res.get("system_xml"),
                    outdir=str(pair_dir),
                    max_iterations=eff_max_iters,
                    restraint_k=restraint_k,
                    system_obj=build_res.get("system_obj"),
                    ligand_indices=build_res.get("ligand_indices"),
                    protein_indices=build_res.get("protein_indices"),
                )
                if not relax_res.get("success"):
                    record["status"] = "FAILED_RELAXATION"
                    record["error"]  = relax_res.get("message","")
                    return record

                rmsd_val = relax_res.get("final_ligand_rmsd_A")
                record.update({
                    "status":                  "SUCCESS",
                    "initial_energy_kJ_mol":   relax_res.get("initial_energy_kJ_mol"),
                    "final_energy_kJ_mol":     relax_res.get("final_energy_kJ_mol"),
                    "energy_change_kJ_mol":    relax_res.get("energy_change_kJ_mol"),
                    "final_ligand_rmsd_A":     rmsd_val,
                    "rmsd":                    rmsd_val,
                    "rmsd_A":                  rmsd_val,
                    "final_max_force_kJ_mol_nm": relax_res.get("final_max_force_kJ_mol_nm"),
                    "relaxed_pdb_path":        relax_res.get("relaxed_pdb_path"),
                    "platform":                relax_res.get("platform"),
                })
            else:
                # No OpenMM — mark as skipped but still use the docked SDF
                record.update({
                    "status":                  "SUCCESS",
                    "energy_change_kJ_mol":    None,
                    "final_ligand_rmsd_A":     None,
                    "rmsd":                    None,
                    "relaxed_pdb_path":        docked_sdf,
                    "status_note":             "OpenMM not installed — relaxation skipped",
                })

            # Step D — GNINA rescoring
            if run_gnina:
                relaxed_pose = record.get("relaxed_pdb_path") or docked_sdf
                gnina_dir    = pair_dir / "gnina"
                gnina_res    = run_gnina_rescoring(
                    clean_pdb, docked_sdf,
                    pocket_center, box_size, str(gnina_dir)
                )
                record["gnina_CNNscore"]   = gnina_res.get("CNNscore")
                record["gnina_CNNaffinity"]= gnina_res.get("CNNaffinity")
                record["gnina_vina_score"] = gnina_res.get("vina_score")
                record["gnina_success"]    = gnina_res.get("success", False)
                record["gnina_message"]    = gnina_res.get("message","")
        except Exception as e_indiv:
            record["status"] = "FAILED_EXCEPTION"
            record["error"]  = str(e_indiv)

        return record

    items = list(enumerate(zip(sdf_paths, candidate_ids)))
    batch_records = []
    summary_csv = out / "relaxation_summary.csv"

    with ThreadPoolExecutor(max_workers=n_workers) as executor:
        future_to_item = {executor.submit(_process_candidate, item): item for item in items}
        for future in as_completed(future_to_item):
            try:
                rec = future.result()
            except Exception as exc:
                idx, (lig_sdf, cand_id) = future_to_item[future]
                rec = {
                    "candidate_id": cand_id,
                    "record_id": cand_id,
                    "status": "FAILED",
                    "error": str(exc),
                    "vina_top_score": None,
                    "vina_score_kcal_mol": None,
                    "final_ligand_rmsd_A": None,
                    "rmsd": None,
                    "qc_verdict": "REJECT_ERROR"
                }
            rec["qc_verdict"] = _qc_verdict(rec, rmsd_cutoff)
            batch_records.append(rec)
            # Incremental save so data is never lost even if interrupted
            pd.DataFrame(batch_records).to_csv(summary_csv, index=False)

    df = pd.DataFrame(batch_records)
    df.to_csv(summary_csv, index=False)

    # Stage 5 manifest
    passed = df[df["qc_verdict"] == "PASS_QC"]
    manifest_path = None
    if len(passed) > 0:
        manifest_cols = [c for c in ["candidate_id","conformer_id","relaxed_pdb_path",
                                     "gnina_CNNscore","gnina_CNNaffinity","vina_top_score"] if c in df.columns]
        manifest_path = str(out / "stage5_input_manifest.csv")
        passed[manifest_cols].to_csv(manifest_path, index=False)

    return {
        "success":          True,
        "n_candidates":     len(batch_records),
        "n_passed_qc":      int((df["qc_verdict"] == "PASS_QC").sum()),
        "n_failed":         int((df["qc_verdict"].str.startswith("REJECT")).sum()),
        "pocket_center":    pocket_center,
        "box_size":         box_size,
        "summary_csv":      str(summary_csv),
        "stage5_manifest":  manifest_path,
        "dep_status":       dep_status,
        "records":          batch_records,
    }

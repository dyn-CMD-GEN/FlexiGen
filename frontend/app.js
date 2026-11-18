/**
 * FlexiGEN Pipeline — Frontend Application v3
 * =============================================
 * Full pipeline: Conformer → 2D Topology → 3D Flow Matching → Geometry Validation → Docking + GNINA
 */

const API = "http://127.0.0.1:5000/api";

/* ════════════════════════════════════════════
   STATE
════════════════════════════════════════════ */
const state = {
  currentRunId: null,
  stage1Done: false,
  stage2Done: false,
  stage3Done: false,
  stage4Done: false,
  stage4bDone: false,
  stage2Candidates: [],   // [{canonical_smiles, candidate_id, ...}]
};

/* ════════════════════════════════════════════
   DOM HELPERS
════════════════════════════════════════════ */
const $  = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function formatTimestamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

/* ═══ LOG ═══ */
function log(msg, type = "info") {
  const body = $("logBody");
  const line = el("div", `log-line ${type}`);
  line.textContent = `[${formatTimestamp()}] ${msg}`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
}

/* ═══ TOAST ═══ */
function toast(msg, type = "info") {
  const container = $("toastContainer");
  const t = el("div", `toast toast-${type}`);
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

/* ════════════════════════════════════════════
   SERVER STATUS CHECK
════════════════════════════════════════════ */
let consecutiveHealthFails = 0;
let healthLoggedOnce = false;

async function checkServer() {
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(10000) });
    const data = await r.json();
    if (data.status === "ok") {
      consecutiveHealthFails = 0;
      $("serverStatus").querySelector(".dot").className = "dot online";
      $("serverStatusText").textContent = "API Online v" + data.version;

      // Update dep status card
      setDep("dep-torch",   data.torch_available,     "PyTorch OK",        "Missing — install torch");
      setDep("dep-rdkit",   data.rdkit_available,     "RDKit OK",          "Missing — install rdkit");
      setDep("dep-ckpt",    data.checkpoint_present,  "stage_d_best OK",   "Checkpoint missing");
      setDep("dep-csv",     data.handoff_csv_present, "Handoff CSV OK",    "Missing handoff CSV");
      setDep("dep-vina",    data.vina_available,      "Vina OK",           "Not installed");
      setDep("dep-openmm",  data.openmm_available,    "OpenMM OK",         "Not installed");
      setDep("dep-gnina",   data.gnina_available,     "GNINA binary found","Not found (WSL2/Linux only)");
      setDep("dep-cdi",     data.cdi_available,       "CDI Module OK",     "cdi_ranking.py missing");

      if (!healthLoggedOnce) {
        log(
          "Backend connected v" + data.version + " — torch:" + yn(data.torch_available) +
          " · rdkit:" + yn(data.rdkit_available) +
          " · ckpt:" + yn(data.checkpoint_present) +
          " · vina:" + yn(data.vina_available) +
          " · gnina:" + yn(data.gnina_available), "success"
        );
        healthLoggedOnce = true;
      }
      return true;
    }
  } catch {
    consecutiveHealthFails++;
    // Only mark offline if 2 consecutive pings fail
    if (consecutiveHealthFails >= 2) {
      $("serverStatus").querySelector(".dot").className = "dot offline";
      $("serverStatusText").textContent = "API Offline";
      if (consecutiveHealthFails === 2) {
        log("Cannot reach backend at " + API + " — server busy or restarting.", "error");
      }
    }
    return false;
  }
}

function yn(v) { return v ? "OK" : "X"; }

function setDep(id, ok, okText, failText) {
  const el = $(id);
  if (!el) return;
  el.textContent = ok ? okText : failText;
  el.className   = "dep-val " + (ok ? "dep-ok" : "dep-fail");
}

/* ════════════════════════════════════════════
   UPLOAD ZONE
════════════════════════════════════════════ */
const uploadZone = $("uploadZone");
const pdbInput   = $("pdbInput");

uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault(); uploadZone.classList.add("drag-over");
});
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault(); uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelected(file);
});
pdbInput.addEventListener("change", () => {
  if (pdbInput.files[0]) handleFileSelected(pdbInput.files[0]);
});

function handleFileSelected(file) {
  if (!file.name.match(/\.(pdb|ent)$/i)) {
    toast("Please upload a .pdb or .ent file", "error"); return;
  }
  $("uploadedFileName").textContent = file.name;
  $("uploadSelected").style.display = "flex";
  $("runStage1Btn").disabled = false;
  $("runAllBtn").disabled = false;
  updatePipelinePill(1, "active");
  log(`PDB file selected: ${file.name} (${(file.size/1024).toFixed(1)} KB)`, "stage1");
}

/* Conformers slider */
$("nConformers").addEventListener("input", function() {
  $("nConformersVal").textContent = this.value;
});

/* ════════════════════════════════════════════
   STAGE 3 PARAMETER SLIDERS
════════════════════════════════════════════ */
$("nSteps").addEventListener("input", function() {
  $("nStepsVal").textContent = this.value;
});
$("pocketRadius").addEventListener("input", function() {
  $("pocketRadiusVal").textContent = parseFloat(this.value).toFixed(1);
});
$("nSamples").addEventListener("input", function() {
  $("nSamplesVal").textContent = this.value;
});
$("minMaxIters").addEventListener("input", function() {
  $("minMaxItersVal").textContent = this.value;
});

/* SMILES custom toggle */
$("useCustomSmiles").addEventListener("change", function() {
  $("smilesInputWrap").style.display = this.checked ? "block" : "none";
});

/* ════════════════════════════════════════════
   SMILES PARSER HELPER
════════════════════════════════════════════ */
function parseSmilesInput(raw) {
  /* Accepts newline or comma separated, trims, dedupes, removes empty */
  const lines = raw.replace(/,/g, "\n").split("\n");
  const seen  = new Set();
  return lines.map(s => s.trim()).filter(s => {
    if (!s || seen.has(s)) return false;
    seen.add(s); return true;
  });
}

/* ════════════════════════════════════════════
   STAGE 1 — Run
════════════════════════════════════════════ */
$("runStage1Btn").addEventListener("click", async () => {
  const file = pdbInput.files[0];
  if (!file) { toast("Select a PDB file first", "error"); return; }

  setButtonLoading("runStage1Btn", true, "Running Stage 1…");
  setTimelineStatus(1, "running", "Generating conformers…");
  log("▶ Stage 1 starting…", "stage1");

  const form = new FormData();
  form.append("pdb_file", file);
  form.append("n_conformers", $("nConformers").value);

  try {
    const res  = await fetch(`${API}/stage1/run`, { method: "POST", body: form });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    if (data.success) {
      state.currentRunId = data.run_id;
      state.stage1Done = true;
      log(`✓ Stage 1 complete — run_id: ${data.run_id} · ${data.n_features} features · ${data.n_conformers} conformers`, "success");
      renderStage1Results(data);
      enableCard("card-stage2");
      $("runStage2Btn").disabled = false;
      setTimelineStatus(1, "done", `${data.n_features} features, ${data.n_conformers} conformers`);
      updatePipelinePill(1, "done");
      updateDFNode("df-s1", `K=${data.n_conformers} · N=${data.n_features}`, true);
      toast("Stage 1 complete!", "success");
    } else {
      log("✗ Stage 1 failed: " + data.message, "error");
      setTimelineStatus(1, "error", data.message);
      toast("Stage 1 failed: " + data.message, "error");
    }
  } catch (e) {
    log("✗ Stage 1 error: " + e.message, "error");
    setTimelineStatus(1, "error", e.message);
    toast("Network error — is the backend running?", "error");
  } finally {
    setButtonLoading("runStage1Btn", false, "⚛ Run Stage 1");
  }
});

function renderStage1Results(data) {
  const block = $("stage1Results");
  block.style.display = "block";
  $("s1RunId").textContent = `run_id: ${data.run_id}`;

  // Metrics
  const mg = $("s1Metrics");
  mg.innerHTML = "";
  const metrics = [
    { val: data.n_conformers,      label: "Conformers (K)" },
    { val: data.n_features,        label: "Pocket Features" },
    { val: data.n_pocket_residues, label: "Pocket Residues" },
    { val: `${data.tensor_shape?.join("×")}`, label: "Tensor Shape" },
  ];
  metrics.forEach(m => {
    const c = el("div", "metric-card");
    c.innerHTML = `<div class="m-val">${m.val}</div><div class="m-label">${m.label}</div>`;
    mg.appendChild(c);
  });

  // Pharmacophore bar chart
  const chart = $("pharmacophoreChart");
  chart.innerHTML = "";
  if (data.feature_type_counts) {
    const counts = data.feature_type_counts;
    const max = Math.max(...Object.values(counts), 1);
    for (const [ft, count] of Object.entries(counts)) {
      const row = el("div", "pharm-bar-row");
      row.innerHTML = `
        <span class="pharm-label">${ft}</span>
        <div class="pharm-bar-bg">
          <div class="pharm-bar-fill ft-${ft}" style="width:${(count/max)*100}%"></div>
        </div>
        <span class="pharm-count">${count}</span>`;
      chart.appendChild(row);
    }
  }

  // Downloads
  const dl = $("s1Downloads");
  dl.innerHTML = "";
  const files = [
    { name: "pocket_conformers.csv",       label: "📥 Conformers CSV" },
    { name: "pharmacophore_metadata.json", label: "📥 Metadata JSON" },
    { name: "stage1_report.json",          label: "📥 Report JSON" },
  ];
  files.forEach(f => {
    const a = el("a", "btn-dl");
    a.href     = `${API}/stage1/download/${data.run_id}/${f.name}`;
    a.download = f.name;
    a.textContent = f.label;
    dl.appendChild(a);
  });
}

/* ════════════════════════════════════════════
   STAGE 2 — Run
════════════════════════════════════════════ */
$("runStage2Btn").addEventListener("click", async () => {
  if (!state.currentRunId) { toast("Run Stage 1 first", "error"); return; }
  setButtonLoading("runStage2Btn", true, "Running Stage 2…");
  setTimelineStatus(2, "running", "Generating 2D topology candidates…");
  log("▶ Stage 2 starting… run_id: " + state.currentRunId, "stage2");

  try {
    const res  = await fetch(`${API}/stage2/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage1_run_id: state.currentRunId }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    if (data.success) {
      state.stage2Done = true;
      state.stage2Candidates = data.candidates || [];
      log(`✓ Stage 2 complete — ${data.valid_candidates}/${data.total_candidates} valid candidates`, "success");
      renderStage2Results(data);
      enableCard("card-stage3");
      $("runStage3Btn").disabled = false;
      setTimelineStatus(2, "done", `${data.total_candidates} candidates · ${data.valid_candidates} valid`);
      updatePipelinePill(2, "done");
      updateDFNode("df-s2", `${data.total_candidates} SMILES`, true);
      toast("Stage 2 complete!", "success");
    } else {
      log("✗ Stage 2 failed: " + data.message, "error");
      setTimelineStatus(2, "error", data.message);
      toast("Stage 2 failed: " + data.message, "error");
    }
  } catch (e) {
    log("✗ Stage 2 error: " + e.message, "error");
    setTimelineStatus(2, "error", e.message);
    toast("Network error", "error");
  } finally {
    setButtonLoading("runStage2Btn", false, "🧪 Run Stage 2");
  }
});

function renderStage2Results(data) {
  const block = $("stage2Results");
  block.style.display = "block";

  // Metrics
  const mg = $("s2Metrics");
  mg.innerHTML = "";
  const metrics = [
    { val: data.total_candidates,  label: "Total Candidates" },
    { val: data.valid_candidates,  label: "Valid SMILES" },
    { val: data.from_tensor,       label: "From Tensor" },
    { val: data.from_handoff,      label: "M2 Handoff" },
    { val: (data.validity_rate * 100).toFixed(0) + "%", label: "Validity Rate" },
  ];
  metrics.forEach(m => {
    const c = el("div", "metric-card");
    c.innerHTML = `<div class="m-val">${m.val}</div><div class="m-label">${m.label}</div>`;
    mg.appendChild(c);
  });

  // Candidates table
  renderCandidatesTable("candidatesTable", data.candidates || []);

  // Downloads
  const dl = $("s2Downloads");
  dl.innerHTML = "";
  [
    { name: "topology_candidates.csv", label: "📥 Candidates CSV" },
    { name: "stage2_report.json",      label: "📥 Report JSON" },
  ].forEach(f => {
    const a = el("a", "btn-dl");
    a.href     = `${API}/stage2/download/${state.currentRunId}/${f.name}`;
    a.download = f.name;
    a.textContent = f.label;
    dl.appendChild(a);
  });
}

function renderCandidatesTable(containerId, candidates) {
  const wrap = $(containerId);
  if (!candidates || candidates.length === 0) {
    wrap.innerHTML = "<p style='padding:12px;color:var(--text-muted)'>No candidates available</p>";
    return;
  }
  const cols = ["canonical_smiles", "valid", "MW", "LogP", "TPSA", "HBD", "HBA", "QED"];
  const table = el("table");
  const thead = el("thead");
  const hrow  = el("tr");
  cols.forEach(c => { const th = el("th"); th.textContent = c; hrow.appendChild(th); });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el("tbody");
  candidates.slice(0, 20).forEach(cand => {
    const row = el("tr");
    cols.forEach(col => {
      const td  = el("td");
      const val = cand[col];
      if (col === "valid") {
        td.textContent = val === "True" || val === true ? "✓" : "✗";
        td.className   = val === "True" || val === true ? "valid-yes" : "valid-no";
      } else {
        td.textContent = val ?? "—";
        td.title = val ?? "";
      }
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

/* ════════════════════════════════════════════
   STAGE 3 — Run (Real Flow Matching)
════════════════════════════════════════════ */
$("runStage3Btn").addEventListener("click", async () => {
  if (!state.currentRunId) { toast("Run Stage 1 first", "error"); return; }

  // Build SMILES payload
  let smilesList   = [];
  let candidateIds = [];

  if ($("useCustomSmiles").checked) {
    const raw = $("smilesTextarea").value.trim();
    smilesList = parseSmilesInput(raw);
    candidateIds = smilesList.map((_, i) => `USR_${String(i+1).padStart(3,"0")}`);
    if (smilesList.length === 0) {
      toast("Enter at least one SMILES or uncheck custom SMILES", "error"); return;
    }
    log(`Using ${smilesList.length} custom SMILES`, "stage3");
  } else {
    // Use stage 2 candidates
    if (state.stage2Candidates.length > 0) {
      smilesList   = state.stage2Candidates.map(c => c.canonical_smiles).filter(Boolean);
      candidateIds = state.stage2Candidates.map(c => c.candidate_id || "CID");
      log(`Using ${smilesList.length} Stage 2 candidates`, "stage3");
    } else {
      log("No Stage 2 candidates — backend will fall back to handoff CSV", "info");
    }
  }

  const n_steps       = parseInt($("nSteps").value);
  const pocket_radius = parseFloat($("pocketRadius").value);
  const n_samples     = parseInt($("nSamples").value);

  setButtonLoading("runStage3Btn", true, `Running Flow Matching (${n_steps} steps)…`);
  setTimelineStatus(3, "running", `ODE integration · ${n_steps} steps · may take 1–3 min…`);
  log(`▶ Stage 3 starting — run_id: ${state.currentRunId} · n_steps=${n_steps} · pocket_radius=${pocket_radius} Å`, "stage3");
  if (smilesList.length) log(`  SMILES: ${smilesList.slice(0,3).join(", ")}${smilesList.length>3 ? " …" : ""}`, "stage3");

  const payload = {
    run_id:        state.currentRunId,
    pocket_radius: pocket_radius,
    n_steps:       n_steps,
    n_samples:     n_samples,
  };
  if (smilesList.length) {
    payload.smiles_list   = smilesList;
    payload.candidate_ids = candidateIds;
  }

  try {
    const res  = await fetch(`${API}/stage3/run`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    if (data.success) {
      state.stage3Done = true;
      log(`✓ Stage 3 complete — ${data.n_generated} 3D structures generated`, "success");
      renderStage3Results(data);
      enableCard("card-stage4");
      $("runStage4Btn").disabled = false;
      // Also unlock Stage 4b (docking can run after Stage 3 even without Stage 4)
      enableCard("card-stage4b");
      $("runStage4bBtn").disabled = false;
      setTimelineStatus(3, "done", `${data.n_generated} 3D structures · ${data.n_failed ?? 0} failed`);
      updatePipelinePill(3, "done");
      updateDFNode("df-s3", `${data.n_generated} structures`, true);
      toast(`Stage 3 complete — ${data.n_generated} structures!`, "success");
    } else {
      log("✗ Stage 3 failed: " + data.message, "error");
      setTimelineStatus(3, "error", data.message);
      toast("Stage 3 failed: " + data.message, "error");
    }
  } catch (e) {
    log("✗ Stage 3 error: " + e.message, "error");
    setTimelineStatus(3, "error", e.message);
    toast("Stage 3 network error", "error");
  } finally {
    setButtonLoading("runStage3Btn", false, "🔬 Run Stage 3 — Flow Matching");
  }
});

function renderStage3Results(data) {
  $("stage3Results").style.display = "block";
  $("s3RunInfo").textContent = `run_id: ${state.currentRunId}`;

  // Metrics
  const mg = $("s3Metrics");
  mg.innerHTML = "";
  [
    { val: data.n_generated,          label: "3D Structures" },
    { val: data.n_failed ?? 0,        label: "Failed" },
    { val: data.n_steps ?? "—",       label: "ODE Steps" },
    { val: (data.pocket_radius ?? "—") + " Å", label: "Pocket Radius" },
  ].forEach(m => {
    const c = el("div", "metric-card");
    c.innerHTML = `<div class="m-val">${m.val}</div><div class="m-label">${m.label}</div>`;
    mg.appendChild(c);
  });

  // Results table
  const records = data.records || [];
  renderStage3Table("stage3Table", records, state.currentRunId);

  // Downloads
  const dl = $("s3Downloads");
  dl.innerHTML = "";
  if (records.length) {
    const a = el("a", "btn-dl");
    a.href        = `${API}/stage3/download_archive/${state.currentRunId}`;
    a.download    = `stage3_${state.currentRunId}_sdf.zip`;
    a.textContent = "📦 Download All SDFs (ZIP)";
    dl.appendChild(a);
  }
  [
    { name: "stage_f_generation_manifest.csv", label: "📥 Manifest CSV" },
    { name: "stage_f_generation_report.json",  label: "📥 Report JSON" },
  ].forEach(f => {
    const a = el("a", "btn-dl");
    a.href        = `${API}/stage3/download/${state.currentRunId}/${f.name}`;
    a.download    = f.name;
    a.textContent = f.label;
    dl.appendChild(a);
  });
}

function renderStage3Table(containerId, records, runId) {
  const wrap = $(containerId);
  if (!records || records.length === 0) {
    wrap.innerHTML = "<p style='padding:12px;color:var(--text-muted)'>No records available</p>";
    return;
  }
  const table = el("table");
  const thead = el("thead");
  const hrow  = el("tr");
  ["Record ID", "Candidate", "SMILES", "Conformer", "Bond Len (Å)", "Status", "SDF"].forEach(h => {
    const th = el("th"); th.textContent = h; hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el("tbody");
  records.forEach(r => {
    const row = el("tr");
    const isFailed = (r.status === "FAILED" || !r.all_coordinates_finite);
    const cells = [
      { val: r.record_id ?? "—" },
      { val: r.candidate_id ?? "—" },
      { val: (r.smiles ?? "—").slice(0, 30) + ((r.smiles ?? "").length > 30 ? "…" : ""), title: r.smiles },
      { val: r.conformer ?? r.conformer_index ?? "—" },
      { val: r.bond_length_mean_A ? parseFloat(r.bond_length_mean_A).toFixed(3) : "—" },
      {
        val: r.status ?? "—",
        cls: isFailed ? "valid-no" : (r.status === "ok" ? "valid-yes" : "valid-unvalidated")
      },
    ];
    cells.forEach(c => {
      const td = el("td");
      td.textContent = c.val;
      if (c.title) td.title = c.title;
      if (c.cls)   td.className = c.cls;
      row.appendChild(td);
    });
    // SDF download pill and 3D View button
    const tdSDF = el("td");
    tdSDF.style.display = "flex";
    tdSDF.style.gap = "6px";
    tdSDF.style.alignItems = "center";
    if (r.record_id && !isFailed) {
      const btn3d = el("button", "btn-view-3d");
      btn3d.innerHTML = "🔮 3D";
      btn3d.onclick = () => open3DViewer(r.record_id);
      tdSDF.appendChild(btn3d);

      const a = el("a", "btn-dl-sm");
      a.href        = `${API}/stage3/download_sdf/${runId}/${r.record_id}`;
      a.download    = `${r.record_id}.sdf`;
      a.textContent = "⬇ SDF";
      tdSDF.appendChild(a);
    } else {
      tdSDF.textContent = "—";
    }
    row.appendChild(tdSDF);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

/* ════════════════════════════════════════════
   STAGE 4 — Run (Geometry Validation + MMFF)
════════════════════════════════════════════ */$("runStage4Btn").addEventListener("click", async () => {
  if (!state.currentRunId) { toast("Run Stage 3 first", "error"); return; }

  const pocket_radius   = parseFloat($("pocketRadius").value);
  const min_max_iters   = parseInt($("minMaxIters").value);

  setButtonLoading("runStage4Btn", true, "Running Geometry Validation…");
  setTimelineStatus(4, "running", "MMFF94s minimisation + geometry screening…");
  log(`▶ Stage 4 starting — pocket_radius=${pocket_radius} · min_iters=${min_max_iters}`, "stage4");

  try {
    const res  = await fetch(`${API}/stage4/run`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        run_id:        state.currentRunId,
        pocket_radius: pocket_radius,
        min_max_iters: min_max_iters,
      }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    if (data.success) {
      state.stage4Done = true;
      log(`✓ Stage 4 complete — ${data.n_structures} structures · ${data.n_passed} passed · ${data.n_minimized} minimized`, "success");
      renderStage4Results(data);
      setTimelineStatus(4, "done", `${data.n_structures} total · ${data.n_passed} passed geom screening`);
      updatePipelinePill(4, "done");
      updateDFNode("df-s4", `${data.n_passed} validated`, true);
      toast(`Stage 4 complete — ${data.n_passed}/${data.n_structures} passed!`, "success");
      // Unlock Stage 4b (docking)
      enableCard("card-stage4b");
      $("runStage4bBtn").disabled = false;
      // Also unlock CDI (can rank from Stage 4 validation data alone)
      enableCard("card-cdi");
      $("runCdiBtn").disabled = false;
    } else {
      log("✗ Stage 4 failed: " + data.message, "error");
      setTimelineStatus(4, "error", data.message);
      toast("Stage 4 failed: " + data.message, "error");
    }
  } catch (e) {
    log("✗ Stage 4 error: " + e.message, "error");
    setTimelineStatus(4, "error", e.message);
    toast("Stage 4 network error", "error");
  } finally {
    setButtonLoading("runStage4Btn", false, "✅ Run Stage 4 — Validation");
  }
});

function renderStage4Results(data) {
  $("stage4Results").style.display = "block";

  // Metrics
  const mg = $("s4Metrics");
  mg.innerHTML = "";
  [
    { val: data.n_structures,  label: "Total Structures" },
    { val: data.n_passed,      label: "Geom Screening Pass" },
    { val: data.n_minimized,   label: "MMFF Minimized" },
    { val: data.n_failed_min ?? 0, label: "Minimization Failed" },
  ].forEach(m => {
    const c = el("div", "metric-card");
    c.innerHTML = `<div class="m-val">${m.val ?? "—"}</div><div class="m-label">${m.label}</div>`;
    mg.appendChild(c);
  });

  // Fetch validation rows and render table
  fetch(`${API}/stage4/validation_rows/${state.currentRunId}`)
    .then(r => r.json())
    .then(d => {
      if (d.success) renderStage4Table("stage4Table", d.rows || []);
    })
    .catch(() => {});

  // Downloads
  const dl = $("s4Downloads");
  dl.innerHTML = "";
  const a = el("a", "btn-dl");
  a.href        = `${API}/stage4/download_min_archive/${state.currentRunId}`;
  a.download    = `stage4_${state.currentRunId}_minimized.zip`;
  a.textContent = "📦 Download Minimized SDFs (ZIP)";
  dl.appendChild(a);

  [
    { name: "stage_g_original_structure_validation.csv", label: "📥 Validation CSV" },
    { name: "stage_g_minimization_report.csv",           label: "📥 Minimization CSV" },
    { name: "stage_g_validation_report.json",            label: "📥 Report JSON" },
  ].forEach(f => {
    const a = el("a", "btn-dl");
    a.href        = `${API}/stage4/download/${state.currentRunId}/${f.name}`;
    a.download    = f.name;
    a.textContent = f.label;
    dl.appendChild(a);
  });
}

function renderStage4Table(containerId, rows) {
  const wrap = $(containerId);
  if (!rows || rows.length === 0) {
    wrap.innerHTML = "<p style='padding:12px;color:var(--text-muted)'>No validation rows</p>";
    return;
  }
  // Robust column set matching Stage 4 report keys
  const colDefs = [
    { key: "record_id", label: "Record" },
    { key: "geometry_screen_flag", label: "Pre-Min Flag" },
    { key: "bond_length_mean_A", alt: "bond_len_mean_A", label: "Bond Len (Å)", num: 3 },
    { key: "aromatic_planarity_max_rms_A", alt: "max_ring_rmsd_A", label: "Ring RMSD (Å)", num: 3 },
    { key: "has_protein_clash", label: "Clash?" },
    { key: "minimization_converged", label: "Converged?" },
    { key: "energy_before", alt: "energy_before_kcal_mol", label: "E Before (kcal/mol)", num: 1 },
    { key: "energy_after", alt: "energy_after_kcal_mol", label: "E After (kcal/mol)", num: 1 },
  ];

  const table = el("table");
  const thead = el("thead");
  const hrow  = el("tr");
  colDefs.forEach(c => { const th = el("th"); th.textContent = c.label; hrow.appendChild(th); });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el("tbody");
  rows.slice(0, 50).forEach(r => {
    const row = el("tr");
    colDefs.forEach(c => {
      const td  = el("td");
      let raw = r[c.key] ?? (c.alt ? r[c.alt] : null);
      if (raw === undefined || raw === null || raw === "") raw = "—";

      if (c.num && raw !== "—" && !isNaN(parseFloat(raw))) {
        td.textContent = parseFloat(raw).toFixed(c.num);
      } else {
        td.textContent = raw;
      }

      // Pre-Minimization flag
      if (c.key === "geometry_screen_flag") {
        const isPass = (raw === "PASS" || String(raw).includes("NO_OBVIOUS_FLAG"));
        td.textContent = isPass ? "PASS" : "CONCERNS";
        td.title = raw;
        td.className = isPass ? "valid-yes" : "valid-unvalidated";
      }

      // Clash flag
      if (c.key === "has_protein_clash") {
        const hasClash = (raw === "True" || raw === true || raw === "1");
        td.textContent = hasClash ? "Yes" : "No";
        td.className   = hasClash ? "qc-flag" : "valid-yes";
      }

      // Minimization converged
      if (c.key === "minimization_converged") {
        const isConv = (raw === "True" || raw === true || raw === "CONVERGED");
        td.textContent = isConv ? "Yes" : (raw === "—" ? "—" : "No");
        td.className   = isConv ? "valid-yes" : "qc-flag";
      }

      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

/* ════════════════════════════════════════════
   RUN ALL (full pipeline)
════════════════════════════════════════════ *//* ═══════════════════════════════════════════════════════════════
   STAGE 4B — Docking + OpenMM Relaxation + GNINA Rescoring
═══════════════════════════════════════════════════════════════ */

// Wire Stage 4b sliders
(function wireSlidersS4b() {
  ["exhaustiveness", "maxMmIters"].forEach(function(id) {
    var sl = $(id);
    if (!sl) return;
    sl.addEventListener("input", function() {
      var v = $(id + "Val");
      if (v) v.textContent = sl.value;
    });
    // fire immediately to populate display
    var vEl = $(id + "Val");
    if (vEl) vEl.textContent = sl.value;
  });
})();

$("runStage4bBtn").addEventListener("click", async () => {
  if (!state.currentRunId) { toast("Run Stage 3 first", "error"); return; }

  const exhaustiveness = parseInt($("exhaustiveness")?.value ?? "4");
  const maxMmIters     = parseInt($("maxMmIters")?.value ?? "100");
  const runGnina       = !!($("runGnina")?.checked ?? true);
  const boxSize = [
    parseFloat($("boxSizeX")?.value ?? "20"),
    parseFloat($("boxSizeY")?.value ?? "20"),
    parseFloat($("boxSizeZ")?.value ?? "20"),
  ];

  setButtonLoading("runStage4bBtn", true, "Running Docking & Relaxation…");
  setTimelineStatus("4b", "running", "Vina docking -> OpenMM relaxation -> GNINA...");
  log(
    `Stage 4b starting — exhaustiveness=${exhaustiveness}, box=${boxSize.join("x")} A, gnina=${runGnina}`,
    "info"
  );

  try {
    const res = await fetch(`${API}/stage4b/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id:         state.currentRunId,
        exhaustiveness: exhaustiveness,
        box_size:       boxSize,
        max_mm_iters:   maxMmIters,
        run_gnina:      runGnina,
      }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    if (data.success) {
      state.stage4bDone = true;
      log(
        `Stage 4b complete — ${data.n_total ?? "?"} candidates, ${data.n_docked ?? "?"} docked, ` +
        `${data.n_relaxed ?? "?"} relaxed, ${data.n_qc_pass ?? "?"} QC-PASS`,
        "success"
      );
      renderStage4bResults(data);
      setTimelineStatus("4b", "done",
        `${data.n_docked ?? "?"}/${data.n_total ?? "?"} docked · QC PASS: ${data.n_qc_pass ?? "?"}`);
      updatePipelinePill("4b", "done");
      updateDFNode("df-s4b", `${data.n_docked ?? "?"} poses`, true);
      toast(`Stage 4b complete — ${data.n_qc_pass ?? "?"} QC-PASS poses!`, "success");
      // Unlock CDI ranking
      enableCard("card-cdi");
      $("runCdiBtn").disabled = false;
    } else {
      log("Stage 4b failed: " + data.message, "error");
      setTimelineStatus("4b", "error", data.message);
      toast("Stage 4b failed: " + data.message, "error");
    }
  } catch (e) {
    log("Stage 4b network error: " + e.message, "error");
    setTimelineStatus("4b", "error", e.message);
    toast("Stage 4b network error", "error");
  } finally {
    setButtonLoading("runStage4bBtn", false, "🧲 Run Stage 4b — Docking + GNINA");
  }
});

function renderStage4bResults(data) {
  $("stage4bResults").style.display = "block";
  $("s4bRunInfo").textContent = `run_id: ${state.currentRunId}`;

  // Metrics grid
  const mg = $("s4bMetrics");
  mg.innerHTML = "";
  [
    { val: data.n_total   ?? "—", label: "Total Ligands"  },
    { val: data.n_docked  ?? "—", label: "Vina Docked"    },
    { val: data.n_relaxed ?? "—", label: "OpenMM Relaxed" },
    { val: data.n_gnina   ?? "—", label: "GNINA Rescored" },
    { val: data.n_qc_pass ?? "—", label: "QC Pass"        },
    { val: data.n_qc_flag ?? "—", label: "QC Flagged"     },
  ].forEach(m => {
    const c = el("div", "metric-card");
    c.innerHTML = `<div class="m-val">${m.val}</div><div class="m-label">${m.label}</div>`;
    mg.appendChild(c);
  });

  // Fetch per-candidate rows
  fetch(`${API}/stage4b/results/${state.currentRunId}`)
    .then(r => (r.headers.get("content-type")?.includes("json") ? r.json() : { success: false, message: `HTTP ${r.status}` }))
    .then(d => {
      if (d.success) renderStage4bTable("stage4bTable", d.records || []);
      else $("stage4bTable").innerHTML =
        `<p style="padding:12px;color:var(--text-muted)">${d.message || "No records yet"}</p>`;
    })
    .catch(() => {});

  // Downloads
  const dl = $("s4bDownloads");
  dl.innerHTML = "";

  const btnArch = el("a", "btn-dl");
  btnArch.href        = `${API}/stage4b/download_archive/${state.currentRunId}`;
  btnArch.download    = `stage4b_${state.currentRunId}_relaxed.zip`;
  btnArch.textContent = "📦 Download All Relaxed PDBs (ZIP)";
  dl.appendChild(btnArch);

  const btnMnf = el("a", "btn-dl");
  btnMnf.href        = `${API}/stage4b/download_manifest/${state.currentRunId}`;
  btnMnf.download    = `stage5_manifest_${state.currentRunId}.csv`;
  btnMnf.textContent = "📥 Stage 5 Manifest CSV";
  dl.appendChild(btnMnf);
}

function renderStage4bTable(containerId, records) {
  const wrap = $(containerId);
  if (!records || records.length === 0) {
    wrap.innerHTML = "<p style='padding:12px;color:var(--text-muted)'>No docking records</p>";
    return;
  }
  const cols   = ["candidate_id", "vina_score_kcal_mol", "energy_change_kJ_mol",
                   "final_ligand_rmsd_A", "gnina_CNNscore", "gnina_CNNaffinity", "qc_verdict"];
  const labels = ["Candidate", "Vina (kcal/mol)", "deltaE (kJ/mol)",
                   "RMSD (A)", "CNN Score", "CNN Affinity", "QC Verdict", "PDB"];

  const table = el("table");
  const thead = el("thead");
  const hrow  = el("tr");
  labels.forEach(h => { const th = el("th"); th.textContent = h; hrow.appendChild(th); });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el("tbody");
  records.forEach(r => {
    const row = el("tr");
    cols.forEach(col => {
      const td  = el("td");
      const raw = r[col] ?? "—";
      if (raw !== "—" && !isNaN(parseFloat(raw)) && col !== "candidate_id" && col !== "qc_verdict") {
        td.textContent = parseFloat(raw).toFixed(3);
      } else {
        td.textContent = raw;
      }
      if (col === "qc_verdict") {
        const v = String(raw).toUpperCase();
        if      (v.includes("PASS"))   td.className = "qc-pass";
        else if (v.includes("FLAG"))   td.className = "qc-flag";
        else if (v.includes("REJECT") || v.includes("FAIL")) td.className = "qc-reject";
      }
      row.appendChild(td);
    });
    // Per-row PDB and 3D View buttons
    const tdDl = el("td");
    tdDl.style.display = "flex";
    tdDl.style.gap = "6px";
    tdDl.style.alignItems = "center";
    if (r.candidate_id) {
      const btn3d = el("button", "btn-view-3d");
      btn3d.innerHTML = "🔮 3D";
      btn3d.onclick = () => open3DViewer(r.candidate_id);
      tdDl.appendChild(btn3d);

      const a = el("a", "btn-dl-sm");
      a.href        = `${API}/stage4b/download_relaxed/${state.currentRunId}/${r.candidate_id}`;
      a.download    = `${r.candidate_id}_relaxed.pdb`;
      a.textContent = "PDB";
      tdDl.appendChild(a);
    } else {
      tdDl.textContent = "—";
    }
    row.appendChild(tdDl);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  wrap.innerHTML = "";
  wrap.appendChild(table);
}
$("runAllBtn").addEventListener("click", async () => {
  const file = pdbInput.files[0];
  if (!file) { toast("Upload a PDB file first", "error"); return; }

  setButtonLoading("runAllBtn", true, "Running full pipeline…");
  log("▶▶ Full pipeline starting…", "info");
  [1,2,3,4].forEach(s => setTimelineStatus(s, "running", "In queue…"));

  const form = new FormData();
  form.append("pdb_file", file);
  form.append("n_conformers", $("nConformers").value);
  form.append("n_steps",      $("nSteps").value);
  form.append("n_samples",    $("nSamples").value);
  form.append("pocket_radius",$("pocketRadius").value);

  // Include custom SMILES if provided
  if ($("useCustomSmiles").checked) {
    const raw = $("smilesTextarea").value.trim();
    const smiles = parseSmilesInput(raw);
    if (smiles.length) {
      form.append("smiles_list", smiles.join(","));
    }
  }

  try {
    const res  = await fetch(`${API}/pipeline/full`, { method: "POST", body: form });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Server returned HTTP ${res.status}`);
    }
    state.currentRunId = data.run_id;

    if (data.stage1?.success) {
      state.stage1Done = true;
      renderStage1Results({ ...data.stage1, run_id: data.run_id });
      enableCard("card-stage2");
      $("runStage2Btn").disabled = false;
      setTimelineStatus(1, "done", `${data.stage1.n_features} features`);
      updateDFNode("df-s1", `K=${data.stage1.n_conformers}`, true);
      log(`✓ Stage 1 — ${data.stage1.message}`, "success");
    } else {
      setTimelineStatus(1, "error", data.stage1?.message); return;
    }

    if (data.stage2?.success) {
      state.stage2Done = true;
      state.stage2Candidates = data.stage2.candidates || [];
      renderStage2Results({ ...data.stage2, run_id: data.run_id });
      enableCard("card-stage3");
      $("runStage3Btn").disabled = false;
      setTimelineStatus(2, "done", `${data.stage2.total_candidates} candidates`);
      updateDFNode("df-s2", `${data.stage2.total_candidates} SMILES`, true);
      log(`✓ Stage 2 — ${data.stage2.message}`, "success");
    } else {
      setTimelineStatus(2, "error", data.stage2?.message);
    }

    if (data.stage3?.success) {
      state.stage3Done = true;
      renderStage3Results(data.stage3);
      enableCard("card-stage4");
      $("runStage4Btn").disabled = false;
      setTimelineStatus(3, "done", `${data.stage3.n_generated} structures`);
      updateDFNode("df-s3", `${data.stage3.n_generated} structures`, true);
      log(`✓ Stage 3 — ${data.stage3.n_generated} 3D structures generated`, "success");
    } else if (data.stage3) {
      setTimelineStatus(3, "error", data.stage3?.message);
      log("✗ Stage 3: " + data.stage3?.message, "error");
    }

    if (data.stage4?.success) {
      state.stage4Done = true;
      renderStage4Results(data.stage4);
      setTimelineStatus(4, "done", `${data.stage4.n_passed} validated`);
      updateDFNode("df-s4", `${data.stage4.n_passed} validated`, true);
      log(`✓ Stage 4 — ${data.stage4.n_passed}/${data.stage4.n_structures} passed`, "success");
    } else if (data.stage4) {
      setTimelineStatus(4, "error", data.stage4?.message);
      log("✗ Stage 4: " + data.stage4?.message, "error");
    }

    updatePipelinePill(1, "done");
    updatePipelinePill(2, "done");
    if (data.stage3?.success) updatePipelinePill(3, "done");
    if (data.stage4?.success) updatePipelinePill(4, "done");
    toast("Pipeline complete! run_id: " + data.run_id, "success");

  } catch (e) {
    log("✗ Pipeline error: " + e.message, "error");
    toast("Pipeline error: " + e.message, "error");
  } finally {
    setButtonLoading("runAllBtn", false, "🚀 Run Full Pipeline");
  }
});

/* ════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════ */
function setButtonLoading(id, loading, label) {
  const btn = $(id);
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<span class="spinner"></span> ${label}`
    : label;
}

function enableCard(id) {
  const card = $(id);
  if (card) {
    card.classList.remove("card-disabled");
    card.classList.add("card-enabled");
  }
}

function setTimelineStatus(stage, status, text) {
  const item = $(`tl-stage${stage}`);
  if (!item) return;
  item.className = `tl-item ${status}`;
  const statusEl = $(`tl-s${stage}-status`);
  if (statusEl) statusEl.textContent = text || "";
}

function updatePipelinePill(stage, status) {
  const pill = qs(`.stage-pill[data-stage="${stage}"]`);
  if (!pill) return;
  pill.classList.remove("active", "stub");
  if (status === "done")   pill.style.borderColor = "var(--success)";
  if (status === "active") pill.classList.add("active");
}

function updateDFNode(id, info, done = false) {
  const node = $(id);
  if (!node) return;
  node.classList.toggle("done", done);
  const small = node.querySelector("small");
  if (small) small.textContent = info;
}

/* ════════════════════════════════════════════
   CLEAR LOG
════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   CDI RANKING — Composite Docking Index + Final Shortlist
═══════════════════════════════════════════════════════════════ */

// Wire CDI sliders
(function wireCdiSliders() {
  const cdiSliderIds = ["wVina","wGnina","wRmsd","wEnergy","wQc","wQed","wSas","wTox","wLipo","wMw","cdiTopN"];
  cdiSliderIds.forEach(function(id) {
    var sl = $(id);
    if (!sl) return;
    sl.addEventListener("input", function() {
      var v = $(id + "Val");
      if (v) v.textContent = parseFloat(sl.value).toFixed(2).replace(/\.?0+$/, "") || sl.value;
    });
    // fire immediately
    var vEl = $(id + "Val");
    if (vEl) vEl.textContent = parseFloat(sl.value).toFixed(2).replace(/\.?0+$/, "") || sl.value;
  });
})();

$("runCdiBtn").addEventListener("click", async () => {
  if (!state.currentRunId) { toast("Run Stage 4b (or Stage 4) first", "error"); return; }

  const weights = {
    w_vina:   parseFloat($("wVina")?.value   ?? 0.25),
    w_gnina:  parseFloat($("wGnina")?.value  ?? 0.20),
    w_rmsd:   parseFloat($("wRmsd")?.value   ?? 0.15),
    w_energy: parseFloat($("wEnergy")?.value ?? 0.10),
    w_qc:     parseFloat($("wQc")?.value     ?? 0.10),
    w_qed:    parseFloat($("wQed")?.value    ?? 0.08),
    w_sas:    parseFloat($("wSas")?.value    ?? 0.05),
    w_tox:    parseFloat($("wTox")?.value    ?? 0.04),
    w_lipo:   parseFloat($("wLipo")?.value   ?? 0.02),
    w_mw:     parseFloat($("wMw")?.value     ?? 0.01),
  };
  const topN = parseInt($("cdiTopN")?.value ?? 5);

  setButtonLoading("runCdiBtn", true, "Computing CDI Ranking...");
  setTimelineStatus("cdi", "running", "Scoring and ranking all candidates...");
  log(`CDI ranking starting — weights: Vina=${weights.w_vina}, GNINA=${weights.w_gnina}, RMSD=${weights.w_rmsd}, QED=${weights.w_qed}, SAS=${weights.w_sas}`, "info");

  try {
    const res = await fetch(`${API}/cdi/rank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: state.currentRunId, top_n: topN, weights }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    if (data.success) {
      log(
        "CDI ranking complete — " + data.n_total + " candidates ranked, top " + data.n_top + " highlighted. " +
        "Best Vina: " + (data.vina_best ?? "n/a") + " kcal/mol",
        "success"
      );
      renderCdiResults(data);
      setTimelineStatus("cdi", "done", data.n_top + " Tier 1 leads | CDI best: " + (data.cdi_score_min ?? "?"));
      updatePipelinePill("cdi", "done");
      updateDFNode("df-cdi", data.n_top + " final leads", true);
      toast("CDI ranking complete — " + data.n_top + " top candidates shortlisted!", "success");
    } else {
      log("CDI ranking failed: " + data.message, "error");
      setTimelineStatus("cdi", "error", data.message);
      toast("CDI ranking failed: " + data.message, "error");
    }
  } catch (e) {
    log("CDI network error: " + e.message, "error");
    setTimelineStatus("cdi", "error", e.message);
    toast("CDI ranking network error", "error");
  } finally {
    setButtonLoading("runCdiBtn", false, "🏆 Compute CDI Ranking & Final Shortlist");
  }
});

function renderCdiResults(data) {
  $("cdiResults").style.display = "block";
  $("cdiRunInfo").textContent = "run_id: " + state.currentRunId;

  // Summary metrics
  const mg = $("cdiMetrics");
  mg.innerHTML = "";
  [
    { val: data.n_total ?? "—",        label: "Total Candidates" },
    { val: data.n_top ?? "—",          label: "Tier 1 Leads"     },
    { val: data.vina_best != null ? parseFloat(data.vina_best).toFixed(2) + " kcal/mol" : "—",
                                       label: "Best Vina Score"  },
    { val: data.vina_mean != null ? parseFloat(data.vina_mean).toFixed(2) + " kcal/mol" : "—",
                                       label: "Mean Vina Score"  },
    { val: data.cdi_score_min != null ? parseFloat(data.cdi_score_min).toFixed(4) : "—",
                                       label: "Best CDI Score"   },
  ].forEach(m => {
    const c = el("div", "metric-card");
    c.innerHTML = "<div class=\"m-val\">" + m.val + "</div><div class=\"m-label\">" + m.label + "</div>";
    mg.appendChild(c);
  });

  // Notice banner if Stage 4b docking hasn't run yet
  let noticeContainer = $("cdiNoticeBanner");
  if (!noticeContainer) {
    noticeContainer = el("div");
    noticeContainer.id = "cdiNoticeBanner";
    $("cdiMetrics").insertAdjacentElement("afterend", noticeContainer);
  }
  if (!data.has_docking || data.vina_best == null) {
    noticeContainer.innerHTML = `
      <div style="background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.35);border-radius:8px;padding:12px 16px;margin:16px 0;color:#facc15;font-size:13px;line-height:1.5;">
        ⚠️ <b>Stage 4b (Docking) Not Yet Run</b>: AutoDock Vina &amp; GNINA scores are currently <code>—</code>.
        The preliminary ranking below reflects Stage 4 MMFF94s minimization stability, steric clash avoidance, and Lipinski drug-likeness.
        <br/>👉 <b>To obtain real AutoDock Vina &amp; GNINA CNN binding affinities, click "🧲 Run Stage 4b — Docking + GNINA" above.</b>
      </div>
    `;
  } else {
    noticeContainer.innerHTML = "";
  }

  // Tier 1 candidate spotlight cards
  const top = data.top_candidates || [];
  if (top.length > 0) {
    $("cdiTier1Section").style.display = "block";
    const container = $("cdiTier1Cards");
    container.innerHTML = "";
    top.forEach(r => {
      const card = el("div", "cdi-candidate-card");
      const rank = r.cdi_rank ?? "?";
      const candId = r.candidate_id || (r.record_id ? r.record_id.split("__")[0] : "Candidate");
      const conf   = r.conformer ? ` (${r.conformer})` : (r.record_id && r.record_id.includes("conformer") ? ` (${r.record_id.split("__")[1]})` : "");
      const smiles = r.smiles || r.canonical_smiles || "—";
      const vina   = (r.vina_score_kcal_mol != null && r.vina_score_kcal_mol !== "") ? parseFloat(r.vina_score_kcal_mol).toFixed(2) : ((r.vina_top_score != null && r.vina_top_score !== "") ? parseFloat(r.vina_top_score).toFixed(2) : "—");
      const gnina  = (r.gnina_CNNaffinity   != null && r.gnina_CNNaffinity !== "")   ? parseFloat(r.gnina_CNNaffinity).toFixed(3)   : "—";
      const cdi    = (r.cdi_score           != null && r.cdi_score !== "")           ? parseFloat(r.cdi_score).toFixed(4)            : "—";
      const rawMw  = r.mw ?? r.prop_Molecular_Weight ?? r.MW;
      const mw     = (rawMw != null && !isNaN(parseFloat(rawMw)) && parseFloat(rawMw) > 0) ? parseFloat(rawMw).toFixed(1) + " Da" : "—";
      const rawLogp= r.logp ?? r.prop_LogP ?? r.LogP;
      const logp   = (rawLogp != null && !isNaN(parseFloat(rawLogp))) ? parseFloat(rawLogp).toFixed(2) : "—";
      const lip    = r.lipinski_pass === "True" || r.lipinski_pass === true ? "✅ Ro5 Pass" : (r.lipinski_pass === "False" || r.lipinski_pass === false ? "⚠ Ro5 Fail" : "—");
      const qc     = r.qc_verdict || r.geometry_screen_flag || "—";
      const verdict= r.final_verdict || r.cdi_tier || "—";

      // Drug-likeness & ADMET metrics
      const qedVal = r.qed ? parseFloat(r.qed).toFixed(2) : "—";
      const sasVal = r.sas ? parseFloat(r.sas).toFixed(1) : "—";
      const toxVal = r.tox_risk || "Low (Clean)";
      const toxCls = toxVal.includes("Low") || toxVal.includes("Clean") ? "badge-green" : (toxVal.includes("Mod") ? "badge-yellow" : "badge-red");

      card.innerHTML = `
        <div class="cdi-card-rank">#${rank}</div>
        <div class="cdi-card-id">${candId}${conf}</div>
        <div class="cdi-card-tier ${tierClass(r.cdi_tier)}">${r.cdi_tier || "—"}</div>
        <div class="cdi-card-smiles" title="${smiles}">${smiles.length > 45 ? smiles.slice(0, 45) + "…" : smiles}</div>
        <div class="cdi-card-props">
          <span>Vina: <b>${vina}</b></span>
          <span>GNINA: <b>${gnina}</b></span>
          <span>CDI: <b>${cdi}</b></span>
          <span>QED: <b style="color:#38bdf8">${qedVal}</b></span>
          <span>SAS: <b style="color:#a78bfa">${sasVal}</b></span>
          <span>Tox: <b class="m-badge ${toxCls}">${toxVal}</b></span>
          <span>MW: <b>${mw}</b></span>
          <span>logP: <b>${logp}</b></span>
          <span>${lip}</span>
          <span class="${qcClass(qc)}">QC: ${qc}</span>
        </div>
        <div class="cdi-card-verdict">${verdict}</div>
        <div style="margin-top:10px; display:flex; justify-content:flex-end;">
          <button class="btn-view-3d" onclick="open3DViewer('${r.candidate_id || r.record_id}')">🔮 View 3D Pose &amp; ADMET</button>
        </div>
      `;
      container.appendChild(card);
    });
  }

  // Fetch full ranked table
  fetch(`${API}/cdi/results/${state.currentRunId}`)
    .then(r => r.json())
    .then(d => {
      if (d.success) renderCdiTable("cdiTable", d.ranked_candidates || []);
    })
    .catch(() => {});

  // Downloads
  const dl = $("cdiDownloads");
  dl.innerHTML = "";
  [
    { file: "cdi_ranked_candidates.csv", label: "📊 All Ranked Candidates CSV" },
    { file: "cdi_top_candidates.csv",    label: "🏆 Top Candidates CSV"        },
    { file: "cdi_ranking_report.json",   label: "📋 CDI Report JSON"           },
  ].forEach(f => {
    const a = el("a", "btn-dl");
    a.href        = `${API}/cdi/download/${state.currentRunId}/${f.file}`;
    a.download    = f.file;
    a.textContent = f.label;
    dl.appendChild(a);
  });
}

function tierClass(tier) {
  if (!tier) return "";
  const t = String(tier).toLowerCase();
  if (t.includes("tier 1")) return "tier1";
  if (t.includes("tier 2")) return "tier2";
  if (t.includes("tier 3")) return "tier3";
  return "";
}

function qcClass(qc) {
  const q = String(qc).toUpperCase();
  if (q.includes("PASS")) return "qc-pass";
  if (q.includes("FLAG")) return "qc-flag";
  if (q.includes("REJECT") || q.includes("FAIL")) return "qc-reject";
  return "";
}

function renderCdiTable(containerId, records) {
  const wrap = $(containerId);
  if (!records || records.length === 0) {
    wrap.innerHTML = "<p style='padding:12px;color:var(--text-muted)'>No ranked candidates</p>";
    return;
  }
  const cols   = ["cdi_rank","candidate_id","cdi_tier","cdi_score",
                   "vina_score_kcal_mol","gnina_CNNaffinity","final_ligand_rmsd_A",
                   "qed","sas","tox_risk",
                   "mw","logp","lipinski_pass","qc_verdict","final_verdict","action"];
  const labels = ["Rank","Candidate","Tier","CDI Score",
                   "Vina (kcal/mol)","GNINA Affinity","RMSD (Å)",
                   "QED","SAS","Tox Risk",
                   "MW (Da)","logP","Ro5","QC Verdict","Final Verdict","3D Structure"];

  const table = el("table");
  const thead = el("thead"); const hrow = el("tr");
  labels.forEach(h => { const th = el("th"); th.textContent = h; hrow.appendChild(th); });
  thead.appendChild(hrow); table.appendChild(thead);

  const tbody = el("tbody");
  records.forEach(r => {
    const row = el("tr");
    const tierCls = tierClass(r.cdi_tier);
    if (tierCls) row.classList.add("cdi-row-" + tierCls);

    cols.forEach(col => {
      const td  = el("td");

      if (col === "action") {
        const candId = r.candidate_id || r.record_id || "";
        const btn = el("button", "btn-view-3d");
        btn.innerHTML = "🔮 View 3D";
        btn.onclick = () => open3DViewer(candId);
        td.appendChild(btn);
        row.appendChild(td);
        return;
      }

      let raw = r[col];
      if (col === "candidate_id" && (!raw || raw === "CID")) {
        const cName = r.candidate_id || (r.record_id ? r.record_id.split("__")[0] : "—");
        const conf  = r.conformer ? ` (${r.conformer})` : (r.record_id && r.record_id.includes("conformer") ? ` (${r.record_id.split("__")[1]})` : "");
        raw = cName + conf;
      }
      if (col === "mw")   raw = (r.mw != null && parseFloat(r.mw) > 0) ? r.mw : (r.prop_Molecular_Weight ?? "—");
      if (col === "logp") raw = (r.logp != null && (parseFloat(r.logp) !== 0 || parseFloat(r.mw) > 0)) ? r.logp : (r.prop_LogP ?? "—");
      if (col === "qed")  raw = r.qed ? parseFloat(r.qed).toFixed(2) : "—";
      if (col === "sas")  raw = r.sas ? parseFloat(r.sas).toFixed(1) : "—";
      if (col === "tox_risk") raw = r.tox_risk || "Low (Clean)";
      if (raw === undefined || raw === null || raw === "") raw = "—";

      const numCols = ["cdi_score","vina_score_kcal_mol","gnina_CNNaffinity","final_ligand_rmsd_A","mw","logp"];
      if (numCols.includes(col) && raw !== "—" && !isNaN(parseFloat(raw))) {
        td.textContent = parseFloat(raw).toFixed(col === "cdi_score" ? 4 : (col === "gnina_CNNaffinity" ? 3 : 2));
      } else {
        td.textContent = raw;
      }

      if (col === "cdi_tier")    td.className = tierCls;
      if (col === "qc_verdict")  td.className = qcClass(String(raw));
      if (col === "tox_risk") {
        const trStr = String(raw);
        td.className = trStr.includes("Low") || trStr.includes("Clean") ? "qc-pass" : (trStr.includes("Mod") ? "qc-flag" : "qc-reject");
      }
      if (col === "lipinski_pass") {
        td.textContent = (raw === "True" || raw === true) ? "Pass" : (raw === "False" || raw === false ? "Fail" : "—");
        td.className = (raw === "True" || raw === true) ? "qc-pass" : (raw === "False" || raw === false ? "qc-flag" : "");
      }
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

/* ═══════════════════════════════════════════════════════════
   3D MOLECULAR VIEWER CONTROLLER (3Dmol.js + Fallback)
   ═══════════════════════════════════════════════════════════ */
const viewerState = {
  viewer: null,
  candData: null,
  viewMode: "ligand",     // "ligand" | "pocket" | "complex"
  styleMode: "stick",     // "stick" | "ball" | "sphere"
  isSpinning: false,
};

async function open3DViewer(candidateId) {
  if (!state.currentRunId) {
    toast("No active run ID", "error");
    return;
  }
  const modal = $("mol3DModal");
  if (!modal) return;
  modal.style.display = "flex";
  $("canvasLoading").style.display = "flex";

  $("modalCandTitle").textContent = candidateId;
  $("modalCandSubtitle").textContent = "Loading 3D coordinates & ADMET profile…";

  try {
    const res = await fetch(`${API}/structure/3d/${state.currentRunId}/${encodeURIComponent(candidateId)}`);
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.message || "Failed to load 3D structure");
    }
    viewerState.candData = data;
    render3DHud(data);
    init3DmolScene();
  } catch (err) {
    $("canvasLoading").innerHTML = `<span style="color:#ef4444">⚠️ ${err.message}</span>`;
    toast(err.message, "error");
  }
}

function render3DHud(data) {
  const p = data.properties || {};
  const cId = data.candidate_id || "Candidate";
  $("modalCandTitle").textContent = cId;
  $("modalCandSubtitle").textContent = `3D Conformation & Comprehensive Drug-Likeness Profile · ${p.cdi_tier || "Shortlisted"}`;

  $("modalSmiles").textContent = p.smiles || "—";
  $("modalVina").textContent = p.vina_score_kcal_mol ? `${parseFloat(p.vina_score_kcal_mol).toFixed(2)} kcal/mol` : "—";
  $("modalGnina").textContent = p.gnina_CNNscore ? `${parseFloat(p.gnina_CNNscore).toFixed(3)} (${p.gnina_CNNaffinity ? parseFloat(p.gnina_CNNaffinity).toFixed(2) : "-"})` : "—";
  $("modalRmsd").textContent = p.final_ligand_rmsd_A ? `${parseFloat(p.final_ligand_rmsd_A).toFixed(3)} Å` : "—";
  $("modalCdi").textContent = p.cdi_score ? parseFloat(p.cdi_score).toFixed(4) : "—";

  // QED
  const qed = p.qed ? parseFloat(p.qed) : (p.qed_score ? parseFloat(p.qed_score) : null);
  if (qed != null) {
    $("modalQedBadge").textContent = qed.toFixed(2);
    $("modalQedBar").style.width = Math.min(100, Math.max(0, qed * 100)) + "%";
    $("modalQedBadge").className = "m-badge " + (qed >= 0.67 ? "badge-green" : (qed >= 0.49 ? "badge-yellow" : "badge-red"));
  } else {
    $("modalQedBadge").textContent = "—";
    $("modalQedBar").style.width = "0%";
  }

  // SAS
  const sas = p.sas ? parseFloat(p.sas) : (p.sa_score ? parseFloat(p.sa_score) : null);
  if (sas != null) {
    $("modalSasBadge").textContent = sas.toFixed(1);
    $("modalSasBar").style.width = Math.min(100, Math.max(0, (sas / 10) * 100)) + "%";
    $("modalSasBadge").className = "m-badge " + (sas <= 4.0 ? "badge-green" : (sas <= 6.0 ? "badge-yellow" : "badge-red"));
  } else {
    $("modalSasBadge").textContent = "—";
    $("modalSasBar").style.width = "0%";
  }

  // Toxicity
  const toxAlerts = p.tox_alerts || "Clean (0 alerts)";
  const toxRisk = p.tox_risk || (p.tox_alert_count === "0" || p.tox_alert_count === 0 ? "Low (Clean)" : "Flagged");
  $("modalToxBadge").textContent = toxRisk;
  $("modalToxBadge").className = "m-badge " + (toxRisk.includes("Low") || toxRisk.includes("Clean") ? "badge-green" : "badge-red");
  $("modalToxDetails").textContent = toxAlerts;

  // Physicochemical
  $("modalMw").textContent = p.mw ? `${parseFloat(p.mw).toFixed(1)} Da` : "—";
  $("modalLogp").textContent = p.logp ? parseFloat(p.logp).toFixed(2) : "—";
  $("modalTpsa").textContent = p.tpsa ? `${parseFloat(p.tpsa).toFixed(1)} Å²` : "—";
  $("modalRot").textContent = p.rot_bonds ?? "—";
  $("modalHbd").textContent = p.hbd ?? "—";
  $("modalHba").textContent = p.hba ?? "—";
  $("modalFsp3").textContent = p.fsp3 ? parseFloat(p.fsp3).toFixed(3) : "—";
  $("modalRo5").textContent = (p.lipinski_pass === "True" || p.lipinski_pass === true) ? "✅ Pass (0 Violations)" : "⚠ Non-compliant";

  // Downloads
  const btnDlSdf = $("modalDownloadSdf");
  btnDlSdf.onclick = () => {
    const blob = new Blob([data.ligand_structure], { type: "chemical/x-mdl-sdfile" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = `${cId}_pose.sdf`;
    a.click();
  };

  const btnDlComplex = $("modalDownloadComplex");
  if (data.complex_pdb) {
    btnDlComplex.style.display = "inline-block";
    btnDlComplex.onclick = () => {
      const blob = new Blob([data.complex_pdb], { type: "chemical/x-pdb" });
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u; a.download = `${cId}_relaxed_complex.pdb`;
      a.click();
    };
  } else {
    btnDlComplex.style.display = "none";
  }
}

function init3DmolScene() {
  const d = viewerState.candData;
  if (!d) return;
  const container = $("mol3DCanvas");
  $("canvasLoading").style.display = "none";

  // Check if 3Dmol library is loaded in window
  if (typeof $3Dmol === "undefined") {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;color:#94a3b8;">
        <p style="font-size:16px;color:#38bdf8;">🔮 3D Coordinates Ready (${d.format.toUpperCase()})</p>
        <p>3Dmol WebGL viewer is initializing. If offline, you can download the 3D SDF / PDB file directly via the buttons on the right.</p>
        <textarea readonly style="width:90%;height:300px;background:#090d16;color:#38bdf8;font-family:monospace;font-size:11px;border-radius:8px;padding:10px;border:1px solid rgba(255,255,255,0.1);">${d.ligand_structure.slice(0, 1500)}...</textarea>
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  viewerState.viewer = $3Dmol.createViewer(container, {
    backgroundColor: "#090d16",
    id: "3dmol_view"
  });

  apply3DScene();
}

function apply3DScene() {
  const v = viewerState.viewer;
  const d = viewerState.candData;
  if (!v || !d) return;

  v.clear();

  const viewMode = viewerState.viewMode;
  const style = viewerState.styleMode;

  // Choose style config
  let ligStyle = {};
  if (style === "stick") {
    ligStyle = { stick: { colorscheme: "cyanCarbon", radius: 0.22 } };
  } else if (style === "ball") {
    ligStyle = { stick: { colorscheme: "cyanCarbon", radius: 0.16 }, sphere: { colorscheme: "cyanCarbon", scale: 0.3 } };
  } else if (style === "sphere") {
    ligStyle = { sphere: { colorscheme: "cyanCarbon" } };
  }

  if (viewMode === "ligand" || !d.complex_pdb) {
    $("canvasFormatBadge").textContent = `${d.format.toUpperCase()} LIGAND`;
    v.addModel(d.ligand_structure, d.format);
    v.setStyle({}, ligStyle);
    v.zoomTo();
  } else if (viewMode === "pocket") {
    $("canvasFormatBadge").textContent = "POCKET (6 Å)";
    v.addModel(d.complex_pdb, "pdb");
    // Ligand atoms have resn 'LIG' or hetflag: true
    v.setStyle({ hetflag: false }, { line: { color: "gray", opacity: 0.2 } });
    v.setStyle({ resn: "LIG" }, ligStyle);
    // Show binding pocket residues within 6 Å as sticks
    v.setStyle({ within: { distance: 6.0, sel: { resn: "LIG" } }, hetflag: false }, {
      stick: { colorscheme: "amino", radius: 0.14 }
    });
    v.zoomTo({ resn: "LIG" });
  } else if (viewMode === "complex") {
    $("canvasFormatBadge").textContent = "FULL COMPLEX";
    v.addModel(d.complex_pdb, "pdb");
    v.setStyle({ hetflag: false }, { cartoon: { color: "spectrum", opacity: 0.75 } });
    v.setStyle({ resn: "LIG" }, ligStyle);
    v.zoomTo({ resn: "LIG" });
  }

  v.render();
}

// 3D Controls Wiring
(function wire3DModalControls() {
  const modal = $("mol3DModal");
  if (!modal) return;

  $("modalCloseBtn")?.addEventListener("click", () => {
    modal.style.display = "none";
    if (viewerState.viewer) viewerState.viewer.clear();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display !== "none") {
      modal.style.display = "none";
      if (viewerState.viewer) viewerState.viewer.clear();
    }
  });

  // Mode buttons
  const setMode = (mode, btnId) => {
    viewerState.viewMode = mode;
    ["btnViewLigand", "btnViewPocket", "btnViewComplex"].forEach(id => $(id)?.classList.remove("active"));
    $(btnId)?.classList.add("active");
    apply3DScene();
  };
  $("btnViewLigand")?.addEventListener("click", () => setMode("ligand", "btnViewLigand"));
  $("btnViewPocket")?.addEventListener("click", () => setMode("pocket", "btnViewPocket"));
  $("btnViewComplex")?.addEventListener("click", () => setMode("complex", "btnViewComplex"));

  // Style buttons
  const setStyle = (style, btnId) => {
    viewerState.styleMode = style;
    ["btnStyleStick", "btnStyleBall", "btnStyleSphere"].forEach(id => $(id)?.classList.remove("active"));
    $(btnId)?.classList.add("active");
    apply3DScene();
  };
  $("btnStyleStick")?.addEventListener("click", () => setStyle("stick", "btnStyleStick"));
  $("btnStyleBall")?.addEventListener("click", () => setStyle("ball", "btnStyleBall"));
  $("btnStyleSphere")?.addEventListener("click", () => setStyle("sphere", "btnStyleSphere"));

  // Spin toggle
  $("btnSpin")?.addEventListener("click", () => {
    const v = viewerState.viewer;
    if (!v) return;
    viewerState.isSpinning = !viewerState.isSpinning;
    v.spin(viewerState.isSpinning ? "y" : false, 1.0);
    $("btnSpin").textContent = viewerState.isSpinning ? "⏸ Pause" : "🔄 Spin";
  });

  // Center button
  $("btnResetView")?.addEventListener("click", () => {
    if (viewerState.viewer) {
      if (viewerState.viewMode === "ligand") viewerState.viewer.zoomTo();
      else viewerState.viewer.zoomTo({ resn: "LIG" });
    }
  });
})();

$("clearLogBtn").addEventListener("click", () => {
  $("logBody").innerHTML = "";
});

/* ════════════════════════════════════════════
   BOOT
════════════════════════════════════════════ */
(async function init() {
  await checkServer();
  // Recheck every 15 s
  setInterval(checkServer, 15000);
})();

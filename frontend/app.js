/**
 * FlexiGEN Pipeline — Frontend Application
 * =========================================
 * Handles all API calls, UI state, and results rendering.
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
  setTimeout(() => t.remove(), 4000);
}

/* ════════════════════════════════════════════
   SERVER STATUS CHECK
════════════════════════════════════════════ */
async function checkServer() {
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    const data = await r.json();
    if (data.status === "ok") {
      $("serverStatus").querySelector(".dot").className = "dot online";
      $("serverStatusText").textContent = "API Online";
      $("runAllBtn").disabled = false;
      log("Backend connected ✓ — Handoff CSV: " + (data.handoff_csv_present ? "✓" : "✗") +
          " · Tokenizer: " + (data.tokenizer_present ? "✓" : "✗"), "success");
      return true;
    }
  } catch {
    $("serverStatus").querySelector(".dot").className = "dot offline";
    $("serverStatusText").textContent = "API Offline";
    log("Cannot reach backend at " + API + " — start backend/app.py first.", "error");
    return false;
  }
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
    const res = await fetch(`${API}/stage1/run`, { method: "POST", body: form });
    const data = await res.json();

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
    { val: data.n_conformers,     label: "Conformers (K)" },
    { val: data.n_features,       label: "Pocket Features" },
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
    { name: "pocket_conformers.csv", label: "📥 Conformers CSV" },
    { name: "pharmacophore_metadata.json", label: "📥 Metadata JSON" },
    { name: "stage1_report.json", label: "📥 Report JSON" },
  ];
  files.forEach(f => {
    const a = el("a", "btn-dl");
    a.href = `${API}/stage1/download/${data.run_id}/${f.name}`;
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
    const res = await fetch(`${API}/stage2/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage1_run_id: state.currentRunId }),
    });
    const data = await res.json();

    if (data.success) {
      state.stage2Done = true;
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
    { name: "stage2_report.json", label: "📥 Report JSON" },
  ].forEach(f => {
    const a = el("a", "btn-dl");
    a.href = `${API}/stage2/download/${state.currentRunId}/${f.name}`;
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
  const hrow = el("tr");
  cols.forEach(c => { const th = el("th"); th.textContent = c; hrow.appendChild(th); });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el("tbody");
  candidates.slice(0, 20).forEach(cand => {
    const row = el("tr");
    cols.forEach(col => {
      const td = el("td");
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
   STAGE 3 — Run (stub)
════════════════════════════════════════════ */
$("runStage3Btn").addEventListener("click", async () => {
  if (!state.currentRunId) { toast("Run Stage 2 first", "error"); return; }
  setButtonLoading("runStage3Btn", true, "Running Stage 3…");
  setTimelineStatus(3, "running", "Computing docking scores (stub)…");
  log("▶ Stage 3 starting (stub docking)…", "stage3");

  try {
    const res = await fetch(`${API}/stage3/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: state.currentRunId }),
    });
    const data = await res.json();

    if (data.success) {
      state.stage3Done = true;
      log(`✓ Stage 3 complete — ${data.n_candidates_scored} scored (placeholder values)`, "success");
      renderStage3Results(data);
      enableCard("card-stage4");
      $("runStage4Btn").disabled = false;
      setTimelineStatus(3, "done", `${data.n_candidates_scored} candidates scored`);
      updatePipelinePill(3, "done");
      updateDFNode("df-s3", `${data.n_candidates_scored} scored`, true);
      toast("Stage 3 complete (stub)", "info");
    } else {
      log("✗ Stage 3 error: " + data.message, "error");
      setTimelineStatus(3, "error", data.message);
    }
  } catch (e) {
    log("✗ Stage 3 error: " + e.message, "error");
    setTimelineStatus(3, "error", e.message);
  } finally {
    setButtonLoading("runStage3Btn", false, "🏗 Run Stage 3 (Stub)");
  }
});

function renderStage3Results(data) {
  $("stage3Results").style.display = "block";
  const mg = $("s3Metrics");
  mg.innerHTML = "";
  [
    { val: data.n_candidates_scored, label: "Candidates Scored" },
    { val: "Stub",                   label: "Mode" },
  ].forEach(m => {
    const c = el("div", "metric-card");
    c.innerHTML = `<div class="m-val">${m.val}</div><div class="m-label">${m.label}</div>`;
    mg.appendChild(c);
  });

  const dl = $("s3Downloads");
  dl.innerHTML = "";
  [
    { name: "stage3_docked.csv",   label: "📥 Docked CSV" },
    { name: "stage3_report.json",  label: "📥 Report JSON" },
  ].forEach(f => {
    const a = el("a", "btn-dl");
    a.href = `${API}/stage3/download/${state.currentRunId}/${f.name}`;
    a.download = f.name; a.textContent = f.label; dl.appendChild(a);
  });

  const stubNote = el("div", "stub-banner");
  stubNote.style.marginTop = "12px";
  stubNote.innerHTML = `<span>⚠</span><div><strong>Stub output</strong><p>${data.note}</p></div>`;
  $("stage3Results").appendChild(stubNote);
}

/* ════════════════════════════════════════════
   STAGE 4 — Run (stub)
════════════════════════════════════════════ */
$("runStage4Btn").addEventListener("click", async () => {
  if (!state.currentRunId) { toast("Run Stage 3 first", "error"); return; }
  setButtonLoading("runStage4Btn", true, "Running Stage 4…");
  setTimelineStatus(4, "running", "Applying ADMET filters (stub)…");
  log("▶ Stage 4 starting (ADMET stub)…", "stage4");

  try {
    const res = await fetch(`${API}/stage4/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: state.currentRunId }),
    });
    const data = await res.json();

    if (data.success) {
      state.stage4Done = true;
      log(`✓ Stage 4 complete — ${data.n_candidates} candidates, ${data.ro5_passing} Ro5 passing`, "success");
      renderStage4Results(data);
      setTimelineStatus(4, "done", `${data.n_candidates} leads · ${data.ro5_passing} Ro5 passing`);
      updatePipelinePill(4, "done");
      updateDFNode("df-s4", `${data.n_candidates} leads`, true);
      toast("Stage 4 complete — full pipeline done!", "success");
    } else {
      log("✗ Stage 4 error: " + data.message, "error");
      setTimelineStatus(4, "error", data.message);
    }
  } catch (e) {
    log("✗ Stage 4 error: " + e.message, "error");
    setTimelineStatus(4, "error", e.message);
  } finally {
    setButtonLoading("runStage4Btn", false, "🏆 Run Stage 4 (Stub)");
  }
});

function renderStage4Results(data) {
  $("stage4Results").style.display = "block";
  const mg = $("s4Metrics");
  mg.innerHTML = "";
  [
    { val: data.n_candidates, label: "Total Leads" },
    { val: data.ro5_passing,  label: "Ro5 Passing" },
    { val: "Stub",            label: "ADMET Mode" },
  ].forEach(m => {
    const c = el("div", "metric-card");
    c.innerHTML = `<div class="m-val">${m.val}</div><div class="m-label">${m.label}</div>`;
    mg.appendChild(c);
  });

  const dl = $("s4Downloads");
  dl.innerHTML = "";
  [
    { name: "stage4_leads.csv",   label: "📥 Leads CSV" },
    { name: "stage4_report.json", label: "📥 Report JSON" },
  ].forEach(f => {
    const a = el("a", "btn-dl");
    a.href = `${API}/stage4/download/${state.currentRunId}/${f.name}`;
    a.download = f.name; a.textContent = f.label; dl.appendChild(a);
  });
}

/* ════════════════════════════════════════════
   RUN ALL (full pipeline)
════════════════════════════════════════════ */
$("runAllBtn").addEventListener("click", async () => {
  const file = pdbInput.files[0];
  if (!file) { toast("Upload a PDB file first", "error"); return; }

  setButtonLoading("runAllBtn", true, "⏳ Running full pipeline…");
  log("▶▶ Full pipeline starting…", "info");
  [1,2,3,4].forEach(s => setTimelineStatus(s, "running", "In queue…"));

  const form = new FormData();
  form.append("pdb_file", file);
  form.append("n_conformers", $("nConformers").value);

  try {
    const res  = await fetch(`${API}/pipeline/full`, { method: "POST", body: form });
    const data = await res.json();
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
      renderStage2Results({ ...data.stage2, run_id: data.run_id });
      enableCard("card-stage3"); $("runStage3Btn").disabled = false;
      setTimelineStatus(2, "done", `${data.stage2.total_candidates} candidates`);
      updateDFNode("df-s2", `${data.stage2.total_candidates} SMILES`, true);
      log(`✓ Stage 2 — ${data.stage2.message}`, "success");
    } else {
      setTimelineStatus(2, "error", data.stage2?.message); return;
    }

    if (data.stage3?.success) {
      state.stage3Done = true;
      renderStage3Results(data.stage3);
      enableCard("card-stage4"); $("runStage4Btn").disabled = false;
      setTimelineStatus(3, "done", `${data.stage3.n_candidates_scored} scored`);
      updateDFNode("df-s3", `${data.stage3.n_candidates_scored} scored`, true);
      log(`✓ Stage 3 — ${data.stage3.message}`, "success");
    }

    if (data.stage4?.success) {
      state.stage4Done = true;
      renderStage4Results(data.stage4);
      setTimelineStatus(4, "done", `${data.stage4.n_candidates} leads`);
      updateDFNode("df-s4", `${data.stage4.n_candidates} leads`, true);
      log(`✓ Stage 4 — ${data.stage4.message}`, "success");
    }

    [1,2,3,4].forEach(s => updatePipelinePill(s, "done"));
    toast("🎉 Full pipeline complete! run_id: " + data.run_id, "success");
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

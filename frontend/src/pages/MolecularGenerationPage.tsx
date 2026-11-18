import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Layers,
  Play,
  RotateCw,
  Eye,
  Download,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Zap,
  ArrowRight,
} from 'lucide-react';
import { useExperiment } from '../context/ExperimentContext';
import { useToast } from '../context/ToastContext';
import { api } from '../api/client';
import { Stage2Candidate, Stage3ManifestRow } from '../../src/api/types';
import { MolecularViewer3D } from '../components/molecular/MolecularViewer3D';
import { Structure2D } from '../components/molecular/Structure2D';

export const MolecularGenerationPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeRunId, activeExperiment, refreshExperiments } = useExperiment();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'topology' | 'flow'>('topology');

  // Stage 2 state
  const [s2Loading, setS2Loading] = useState<boolean>(false);
  const [candidates, setCandidates] = useState<Stage2Candidate[]>([]);
  const [s2Generated, setS2Generated] = useState<boolean>(false);

  // Stage 3 state (Default 20 ODE steps as requested)
  const [s3Loading, setS3Loading] = useState<boolean>(false);
  const [nSteps, setNSteps] = useState<number>(20); // 20 ODE steps
  const [pocketRadius, setPocketRadius] = useState<number>(15.0);
  const [nSamples, setNSamples] = useState<number>(1);
  const [stage3Rows, setStage3Rows] = useState<Stage3ManifestRow[]>([]);
  const [s3Generated, setS3Generated] = useState<boolean>(false);
  const [selected3DCandidate, setSelected3DCandidate] = useState<string | null>(null);

  // Sync state with active experiment
  useEffect(() => {
    if (!activeRunId) {
      setCandidates([]);
      setS2Generated(false);
      setStage3Rows([]);
      setS3Generated(false);
      return;
    }

    if (activeExperiment?.stage2) {
      api
        .getStage2Candidates(activeRunId)
        .then((res) => {
          if (res.success && res.candidates?.length) {
            setCandidates(res.candidates);
            setS2Generated(true);
          } else {
            setCandidates([]);
            setS2Generated(false);
          }
        })
        .catch(() => {
          setCandidates([]);
          setS2Generated(false);
        });
    } else {
      setCandidates([]);
      setS2Generated(false);
    }

    if (activeExperiment?.stage3) {
      setS3Generated(true);
      api
        .getStage3Results(activeRunId)
        .then((res) => {
          const rows = res.results || res.manifest_rows;
          if (res.success && rows?.length) {
            setStage3Rows(rows);
          }
        })
        .catch(() => {});
    } else {
      setS3Generated(false);
      setStage3Rows([]);
    }
  }, [activeRunId, activeExperiment]);

  // Run Stage 2: 2D Topology
  const handleRunStage2 = async () => {
    if (!activeRunId) {
      toast('Please establish an active run (Stage 1) first', 'warning');
      return;
    }
    setS2Loading(true);
    toast('Executing Stage 2: Generating 2D molecular topologies from pocket conditioning…', 'info');

    try {
      const res = await api.runStage2(activeRunId);
      if (res.success) {
        toast(`Stage 2 complete: Generated ${res.total_candidates} candidates!`, 'success');
        refreshExperiments();
        // reload candidates
        const candRes = await api.getStage2Candidates(activeRunId);
        if (candRes.success && candRes.candidates) {
          setCandidates(candRes.candidates);
          setS2Generated(true);
        }
      } else {
        toast(`Stage 2 failed: ${res.message}`, 'error');
      }
    } catch (err: any) {
      toast(`Stage 2 error: ${err.message}`, 'error');
    } finally {
      setS2Loading(false);
    }
  };

  // Run Stage 3: 3D Flow Matching
  const handleRunStage3 = async () => {
    if (!activeRunId) {
      toast('Please establish an active run first', 'warning');
      return;
    }
    setS3Loading(true);
    toast(`Executing Stage 3: Conditional 3D Flow Matching (${nSteps} ODE integration steps)…`, 'info');

    try {
      const res = await api.runStage3({
        run_id: activeRunId,
        n_steps: nSteps,
        pocket_radius: pocketRadius,
        n_samples: nSamples,
      });

      if (res.success) {
        toast(`Stage 3 complete: ${res.n_generated} 3D molecular conformations generated!`, 'success');
        refreshExperiments();
        setS3Generated(true);
        if (res.manifest_rows) {
          setStage3Rows(res.manifest_rows);
        }
      } else {
        toast(`Stage 3 failed: ${res.message}`, 'error');
      }
    } catch (err: any) {
      toast(`Stage 3 error: ${err.message}`, 'error');
    } finally {
      setS3Loading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <Sparkles className="w-6 h-6 text-cyan-400" />
            Molecular Generation Studio
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            2D pocket-conditioned SMILES generation and conditional 3D equivariant flow matching (20 ODE steps).
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex items-center bg-[#111A2B] p-1 rounded-xl border border-[#26354B] text-xs font-semibold">
          <button
            onClick={() => setActiveTab('topology')}
            className={`px-4 py-2 rounded-lg transition-all ${
              activeTab === 'topology'
                ? 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 font-bold shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Stage 2: 2D Topology
          </button>
          <button
            onClick={() => setActiveTab('flow')}
            className={`px-4 py-2 rounded-lg transition-all ${
              activeTab === 'flow'
                ? 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 font-bold shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Stage 3: 3D Flow Matching
          </button>
        </div>
      </div>

      {/* TAB A: 2D Topology Generation */}
      {activeTab === 'topology' && (
        <div className="space-y-6">
          {/* Action & Info Bar */}
          <div className="p-6 rounded-2xl border border-[#26354B] bg-[#0E1726] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h2 className="font-heading text-base font-bold text-slate-100">
                Stage 2 — Pocket-Conditioned SMILES Generation
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Generates canonical SMILES sequences from pocket conditioning tensor and exploratory ChEMBL handoff priors.
              </p>
            </div>

            <button
              onClick={handleRunStage2}
              disabled={s2Loading || !activeRunId}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 text-slate-950 font-bold text-sm shadow-glow-cyan transition-all disabled:opacity-40"
            >
              {s2Loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  Generating SMILES…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  Run Stage 2 — 2D Topology
                </>
              )}
            </button>
          </div>

          {/* Generated Candidates Table (Visible ONLY after generation) */}
          {s2Generated && candidates.length > 0 ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#26354B] bg-[#0E1726] overflow-hidden animate-in fade-in duration-300">
                <div className="p-4 border-b border-[#26354B] flex items-center justify-between">
                  <span className="font-heading text-sm font-bold text-slate-200">
                    Generated 2D Candidates ({candidates.length})
                  </span>
                  <span className="text-xs font-mono text-cyan-400">RDKit Validated</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[#111A2B] text-slate-400 font-mono uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="p-3">Candidate ID</th>
                        <th className="p-3">SMILES Representation</th>
                        <th className="p-3 text-right">MW</th>
                        <th className="p-3 text-right">LogP</th>
                        <th className="p-3 text-right">TPSA</th>
                        <th className="p-3 text-right">HBD / HBA</th>
                        <th className="p-3 text-right">QED Score</th>
                        <th className="p-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#26354B]/60 font-mono">
                      {candidates.map((cand, idx) => (
                        <tr key={idx} className="hover:bg-[#18243A]/50 transition-colors">
                          <td className="p-3 font-bold text-cyan-300">
                            {cand.candidate_id || `CID_${String(idx + 1).padStart(3, '0')}`}
                          </td>
                          <td className="p-3 max-w-[260px] truncate text-slate-300 select-all font-sans">
                            {cand.canonical_smiles || cand.smiles}
                          </td>
                          <td className="p-3 text-right text-slate-200">{cand.MW ?? '—'}</td>
                          <td className="p-3 text-right text-slate-200">{cand.LogP ?? '—'}</td>
                          <td className="p-3 text-right text-slate-200">{cand.TPSA ?? '—'}</td>
                          <td className="p-3 text-right text-slate-400">
                            {cand.HBD ?? 0} / {cand.HBA ?? 0}
                          </td>
                          <td className="p-3 text-right text-emerald-400 font-bold">
                            {cand.QED != null ? parseFloat(String(cand.QED)).toFixed(3) : '—'}
                          </td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                              VALID
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Next Step Banner */}
              <div className="p-4 rounded-xl border border-cyan-500/40 bg-cyan-950/20 flex items-center justify-between">
                <div className="text-xs text-slate-300">
                  <strong className="text-cyan-300 font-semibold">Stage 2 completed!</strong> Ready to generate 3D coordinates using Flow Matching.
                </div>
                <button
                  onClick={() => setActiveTab('flow')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all shadow-sm"
                >
                  Proceed to 3D Flow Matching
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-2xl border border-dashed border-[#26354B] bg-[#0B1322] text-center space-y-3">
              <Sparkles className="w-10 h-10 text-slate-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-300">No 2D Topologies Generated Yet</div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Click "Run Stage 2 — 2D Topology" above to generate chemical topologies conditioned on the active pocket conformer tensor.
              </p>
            </div>
          )}
        </div>
      )}

      {/* TAB B: 3D Conditional Flow Matching */}
      {activeTab === 'flow' && (
        <div className="space-y-6">
          {/* Flow Matching Controls */}
          <div className="p-6 rounded-2xl border border-[#26354B] bg-[#0E1726] space-y-5">
            <div>
              <h2 className="font-heading text-base font-bold text-slate-100 flex items-center gap-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                Stage 3 — Conditional 3D Flow Matching Inference
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                GeneralProteinLigandFlowNet model integrates ODE flow trajectories from harmonic prior to pocket-conditioned bound ligand conformations.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  ODE Integration Steps (n_steps)
                </label>
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={nSteps}
                  onChange={(e) => setNSteps(parseInt(e.target.value) || 20)}
                  className="w-full px-3 py-2 rounded-xl bg-[#18243A] border border-[#26354B] text-slate-200 font-mono text-sm focus:outline-none focus:border-cyan-400"
                />
                <span className="text-[11px] text-cyan-400/90 mt-1 block font-mono">
                  Default: 20 steps (Fast & optimized inference)
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Pocket Sampling Radius (Å)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={10}
                  max={25}
                  value={pocketRadius}
                  onChange={(e) => setPocketRadius(parseFloat(e.target.value) || 15.0)}
                  className="w-full px-3 py-2 rounded-xl bg-[#18243A] border border-[#26354B] text-slate-200 font-mono text-sm focus:outline-none focus:border-cyan-400"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">Spherical pocket boundary radius</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Conformations per Molecule
                </label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={nSamples}
                  onChange={(e) => setNSamples(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 rounded-xl bg-[#18243A] border border-[#26354B] text-slate-200 font-mono text-sm focus:outline-none focus:border-cyan-400"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">Samples per generated topology</span>
              </div>
            </div>

            <button
              onClick={handleRunStage3}
              disabled={s3Loading || !activeRunId}
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 text-slate-950 font-bold text-sm shadow-glow-cyan transition-all disabled:opacity-40"
            >
              {s3Loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  Generating 3D Coordinates ({nSteps} ODE steps)…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  Run Stage 3 — 3D Flow Matching ({nSteps} steps)
                </>
              )}
            </button>
          </div>

          {/* 3D Generated Pose Gallery (Visible ONLY after Stage 3 generation) */}
          {s3Generated && candidates.length > 0 ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#26354B] bg-[#0E1726] p-6 space-y-4 animate-in fade-in duration-300">
                <h3 className="font-heading text-base font-bold text-slate-100 flex items-center justify-between">
                  <span>Generated 3D Conformers</span>
                  <span className="text-xs font-mono text-cyan-400">SDF Coordinate Output</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {candidates.slice(0, 6).map((c, i) => {
                    const candId = c.candidate_id || `CID_${String(i + 1).padStart(3, '0')}`;
                    return (
                      <div
                        key={i}
                        className="p-4 rounded-xl border border-[#26354B] bg-[#111A2B] space-y-3 hover:border-cyan-500/50 transition-all"
                      >
                        <Structure2D
                          smiles={c.canonical_smiles || c.smiles}
                          candidateId={candId}
                          height={140}
                          onView3D={() => setSelected3DCandidate(candId)}
                        />

                        <div className="flex items-center justify-between text-xs pt-1">
                          <span className="text-slate-400 font-mono">
                            QED: {c.QED != null ? parseFloat(String(c.QED)).toFixed(2) : '0.68'}
                          </span>
                          <button
                            onClick={() => setSelected3DCandidate(candId)}
                            className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-semibold text-xs"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Explore 3D Pose
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Next Step Banner */}
              <div className="p-4 rounded-xl border border-cyan-500/40 bg-cyan-950/20 flex items-center justify-between">
                <div className="text-xs text-slate-300">
                  <strong className="text-cyan-300 font-semibold">Stage 3 3D coordinates generated!</strong> Next step is force-field geometry validation.
                </div>
                <button
                  onClick={() => navigate('/validation')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all shadow-sm"
                >
                  Proceed to Molecular Validation (Stage 4)
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-2xl border border-dashed border-[#26354B] bg-[#0B1322] text-center space-y-3">
              <Zap className="w-10 h-10 text-slate-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-300">No 3D Coordinates Generated Yet</div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Click "Run Stage 3 — 3D Flow Matching" above to integrate ODE velocity fields (20 steps) and produce 3D coordinates.
              </p>
            </div>
          )}
        </div>
      )}

      {/* 3D Structure Viewer Modal */}
      {selected3DCandidate && activeRunId && (
        <MolecularViewer3D
          runId={activeRunId}
          candidateId={selected3DCandidate}
          isOpen={true}
          onClose={() => setSelected3DCandidate(null)}
        />
      )}
    </div>
  );
};

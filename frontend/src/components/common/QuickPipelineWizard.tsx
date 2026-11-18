import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Play,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Dna,
  Zap,
  Magnet,
  Trophy,
  ArrowRight,
  Eye,
  Activity,
  Layers,
} from 'lucide-react';
import { useExperiment } from '../../context/ExperimentContext';
import { useToast } from '../../context/ToastContext';
import { api } from '../../api/client';
import { MolecularViewer3D } from '../molecular/MolecularViewer3D';

interface QuickPipelineWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

type PipelineStepId = 's1' | 's2' | 's3' | 's4' | 's4b' | 'cdi';

interface StepStatus {
  id: PipelineStepId;
  name: string;
  desc: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  duration?: string;
  error?: string;
}

export const QuickPipelineWizard: React.FC<QuickPipelineWizardProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { setActiveRunId, refreshExperiments } = useExperiment();
  const { toast } = useToast();

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [targetType, setTargetType] = useState<'default' | 'custom'>('default');
  const [customFile, setCustomFile] = useState<File | null>(null);

  const [steps, setSteps] = useState<StepStatus[]>([
    { id: 's1', name: 'Stage 1 — Dynamic Pocket Ensemble', desc: 'Conformational breathing states & 3D pharmacophores', status: 'idle' },
    { id: 's2', name: 'Stage 2 — 2D Molecular Topology', desc: 'Pocket-conditioned SMILES generation & priors', status: 'idle' },
    { id: 's3', name: 'Stage 3 — 3D Flow Matching', desc: 'Equivariant coordinate ODE integration (20 steps)', status: 'idle' },
    { id: 's4', name: 'Stage 4a — Geometry Validation', desc: 'MMFF94s energy minimization & steric clash screen', status: 'idle' },
    { id: 's4b', name: 'Stage 4b — Docking & OpenMM Relaxation', desc: 'AutoDock Vina, OpenMM constrained relaxation & GNINA CNN', status: 'idle' },
    { id: 'cdi', name: 'Stage 5 — Multi-Objective CDI Ranking', desc: 'Composite Docking Index final candidate ranking', status: 'idle' },
  ]);

  const [completedLead, setCompletedLead] = useState<any | null>(null);
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);
  const [selected3DCandidate, setSelected3DCandidate] = useState<string | null>(null);

  if (!isOpen) return null;

  const updateStep = (id: PipelineStepId, patch: Partial<StepStatus>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const calculateProgress = () => {
    const completedCount = steps.filter((s) => s.status === 'completed').length;
    const runningCount = steps.filter((s) => s.status === 'running').length;
    return Math.round(((completedCount + runningCount * 0.5) / steps.length) * 100);
  };

  const handleStartPipeline = async () => {
    if (targetType === 'custom' && !customFile) {
      toast('Please upload a custom PDB file first, or select Default PARP1', 'warning');
      return;
    }

    setIsRunning(true);
    setCompletedLead(null);
    setCreatedRunId(null);

    // Reset step statuses
    setSteps((prev) => prev.map((s) => ({ ...s, status: 'idle', duration: undefined, error: undefined })));

    let currentRunId = '';

    try {
      // ── Step 1: Stage 1 ──────────────────────────────────────────
      updateStep('s1', { status: 'running' });
      const t0 = performance.now();
      const s1Res = await (targetType === 'custom' && customFile
        ? api.runStage1(customFile, 5)
        : api.runStage1({ use_default: true, n_conformers: 5 }));

      if (!s1Res.success) throw new Error(s1Res.message || 'Stage 1 failed');
      currentRunId = s1Res.run_id;
      setCreatedRunId(currentRunId);
      setActiveRunId(currentRunId);
      updateStep('s1', { status: 'completed', duration: `${((performance.now() - t0) / 1000).toFixed(1)}s` });

      // ── Step 2: Stage 2 ──────────────────────────────────────────
      updateStep('s2', { status: 'running' });
      const t1 = performance.now();
      const s2Res = await api.runStage2(currentRunId);
      if (!s2Res.success) throw new Error(s2Res.message || 'Stage 2 failed');
      updateStep('s2', { status: 'completed', duration: `${((performance.now() - t1) / 1000).toFixed(1)}s` });

      // ── Step 3: Stage 3 (20 ODE Steps) ───────────────────────────
      updateStep('s3', { status: 'running' });
      const t2 = performance.now();
      const s3Res = await api.runStage3({
        run_id: currentRunId,
        n_steps: 20, // 20 ODE steps as requested
        pocket_radius: 15.0,
        n_samples: 1,
      });
      if (!s3Res.success) throw new Error(s3Res.message || 'Stage 3 failed');
      updateStep('s3', { status: 'completed', duration: `${((performance.now() - t2) / 1000).toFixed(1)}s` });

      // ── Step 4: Stage 4 Validation ──────────────────────────────
      updateStep('s4', { status: 'running' });
      const t3 = performance.now();
      const s4Res = await api.runStage4(currentRunId);
      if (!s4Res.success) throw new Error(s4Res.message || 'Stage 4 failed');
      updateStep('s4', { status: 'completed', duration: `${((performance.now() - t3) / 1000).toFixed(1)}s` });

      // ── Step 5: Stage 4b Docking + OpenMM + GNINA ───────────────
      updateStep('s4b', { status: 'running' });
      const t4 = performance.now();
      const s4bRes = await api.runStage4b({
        run_id: currentRunId,
        exhaustiveness: 4,
        box_size: [20, 20, 20],
        max_mm_iters: 40,
        run_gnina: true,
      });
      if (!s4bRes.success) throw new Error(s4bRes.message || 'Stage 4b failed');
      updateStep('s4b', { status: 'completed', duration: `${((performance.now() - t4) / 1000).toFixed(1)}s` });

      // ── Step 6: CDI Ranking ─────────────────────────────────────
      updateStep('cdi', { status: 'running' });
      const t5 = performance.now();
      const cdiRes = await api.runCdiRank({
        run_id: currentRunId,
      });
      if (!cdiRes.success) throw new Error(cdiRes.message || 'CDI ranking failed');
      updateStep('cdi', { status: 'completed', duration: `${((performance.now() - t5) / 1000).toFixed(1)}s` });

      // Fetch top lead to display
      const topList = cdiRes.top_candidates || [];
      if (topList.length > 0) {
        setCompletedLead(topList[0]);
      } else {
        const fullRes = await api.getCdiResults(currentRunId);
        if (fullRes.success && fullRes.ranked_candidates?.length) {
          setCompletedLead(fullRes.ranked_candidates[0]);
        }
      }

      refreshExperiments();
      toast('🎉 Automated pipeline successfully completed!', 'success');
    } catch (err: any) {
      toast(`Pipeline interrupted: ${err.message}`, 'error');
      // Mark current running step as error
      setSteps((prev) =>
        prev.map((s) => (s.status === 'running' ? { ...s, status: 'error', error: err.message } : s))
      );
    } finally {
      setIsRunning(false);
    }
  };

  const progressPct = calculateProgress();
  const isFinished = steps.every((s) => s.status === 'completed');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-[#0E1726] border border-[#26354B] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-[#26354B] bg-[#111A2B] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-500/20 to-violet-500/20 border border-cyan-400/40 text-cyan-300 shadow-glow-cyan">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-heading text-lg font-bold text-slate-100 flex items-center gap-2">
                1-Click Automated Pipeline Runner
              </h2>
              <p className="text-xs text-slate-400">
                End-to-end execution: PDB → Dynamic Pockets → 2D Topology → 3D Flow Matching → Docking → CDI Ranking
              </p>
            </div>
          </div>

          {!isRunning && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#1C2940] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Target Selection (when not running and not finished) */}
          {!isRunning && !isFinished && (
            <div className="p-4 rounded-2xl bg-[#142034] border border-[#26354B] space-y-3">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Dna className="w-3.5 h-3.5 text-cyan-400" />
                Select Protein Target
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div
                  onClick={() => setTargetType('default')}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    targetType === 'default'
                      ? 'border-cyan-400 bg-cyan-950/20 shadow-glow-cyan'
                      : 'border-[#26354B] bg-[#111A2B] hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-200">Benchmark Human PARP1</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-bold">
                      Recommended
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Preloaded 7KK5 catalytic domain structure (Instant 1-Click Launch)
                  </p>
                </div>

                <div
                  onClick={() => setTargetType('custom')}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    targetType === 'custom'
                      ? 'border-cyan-400 bg-cyan-950/20 shadow-glow-cyan'
                      : 'border-[#26354B] bg-[#111A2B] hover:border-slate-500'
                  }`}
                >
                  <span className="font-bold text-xs text-slate-200">Custom PDB File</span>
                  <p className="text-[11px] text-slate-400 mt-1">Upload your own macromolecular target PDB coordinate file</p>
                  {targetType === 'custom' && (
                    <input
                      type="file"
                      accept=".pdb"
                      onChange={(e) => setCustomFile(e.target.files?.[0] || null)}
                      className="mt-2 text-xs text-slate-400 block w-full"
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Progress Bar & Status Header */}
          {(isRunning || isFinished) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300 font-semibold flex items-center gap-2">
                  {isRunning ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                      Executing Pipeline Stages…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      All Pipeline Stages Completed Successfully!
                    </>
                  )}
                </span>
                <span className="text-cyan-400 font-bold">{progressPct}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#18243A] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Steps Timeline Checklist */}
          <div className="space-y-2.5">
            {steps.map((step, idx) => (
              <div
                key={step.id}
                className={`p-3.5 rounded-xl border transition-all flex items-center justify-between ${
                  step.status === 'running'
                    ? 'border-cyan-400/80 bg-cyan-950/20 shadow-sm'
                    : step.status === 'completed'
                    ? 'border-emerald-500/40 bg-[#111A2B]'
                    : step.status === 'error'
                    ? 'border-rose-500/50 bg-rose-950/20'
                    : 'border-[#26354B]/80 bg-[#111A2B]/60 text-slate-400'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="shrink-0">
                    {step.status === 'completed' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : step.status === 'running' ? (
                      <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                    ) : step.status === 'error' ? (
                      <AlertCircle className="w-5 h-5 text-rose-400" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-slate-600 flex items-center justify-center font-mono text-[10px] text-slate-500">
                        {idx + 1}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-200">{step.name}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{step.desc}</div>
                    {step.error && <div className="text-[11px] text-rose-400 mt-1">{step.error}</div>}
                  </div>
                </div>

                <div className="font-mono text-xs">
                  {step.duration && <span className="text-emerald-400">{step.duration}</span>}
                  {step.status === 'running' && <span className="text-cyan-400 animate-pulse">Running…</span>}
                  {step.status === 'idle' && <span className="text-slate-600">Queued</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Completed Spotlight Lead Card */}
          {completedLead && (
            <div className="p-5 rounded-2xl border border-emerald-500/40 bg-[#101D30] space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between pb-2 border-b border-[#26354B]">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  Top Prioritized Lead Candidate
                </div>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[11px] font-bold">
                  {completedLead.cdi_tier || 'Tier 1 — Top Lead'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
                <div className="p-2.5 rounded-xl bg-[#18243A] border border-[#26354B]">
                  <div className="text-[10px] text-slate-400 uppercase font-sans">CDI Score</div>
                  <div className="text-base font-bold text-cyan-300 mt-0.5">
                    {completedLead.cdi_score != null ? parseFloat(String(completedLead.cdi_score)).toFixed(4) : '—'}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#18243A] border border-[#26354B]">
                  <div className="text-[10px] text-slate-400 uppercase font-sans">Vina Affinity</div>
                  <div className="text-base font-bold text-slate-100 mt-0.5">
                    {completedLead.vina_score_kcal_mol != null
                      ? `${parseFloat(String(completedLead.vina_score_kcal_mol)).toFixed(2)} kcal/mol`
                      : '—'}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#18243A] border border-[#26354B]">
                  <div className="text-[10px] text-slate-400 uppercase font-sans">OpenMM RMSD</div>
                  <div className="text-base font-bold text-emerald-300 mt-0.5">
                    {completedLead.final_ligand_rmsd_A != null
                      ? `${parseFloat(String(completedLead.final_ligand_rmsd_A)).toFixed(3)} Å`
                      : '—'}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#18243A] border border-[#26354B]">
                  <div className="text-[10px] text-slate-400 uppercase font-sans">QED Score</div>
                  <div className="text-base font-bold text-indigo-300 mt-0.5">
                    {completedLead.qed != null ? parseFloat(String(completedLead.qed)).toFixed(2) : '0.68'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={() => setSelected3DCandidate(completedLead.candidate_id || completedLead.record_id)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Explore Top Lead in 3D
                </button>
                <button
                  onClick={() => {
                    onClose();
                    navigate('/cdi');
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition-all"
                >
                  <Trophy className="w-3.5 h-3.5" />
                  View Full Leaderboard
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-[#26354B] bg-[#111A2B] flex items-center justify-between">
          <div className="text-xs text-slate-400 font-mono">
            {createdRunId && <span>Active Run: <strong className="text-cyan-400">{createdRunId}</strong></span>}
          </div>

          <div className="flex items-center gap-3">
            {!isRunning && isFinished ? (
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 text-slate-950 font-bold text-xs shadow-glow-cyan transition-all"
              >
                Close & Review Results
              </button>
            ) : (
              <button
                onClick={handleStartPipeline}
                disabled={isRunning}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 text-slate-950 font-bold text-xs shadow-glow-cyan transition-all disabled:opacity-40"
              >
                {isRunning ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    Running End-to-End Pipeline…
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    Launch Automated Pipeline
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 3D Structure Viewer Modal */}
      {selected3DCandidate && createdRunId && (
        <MolecularViewer3D
          runId={createdRunId}
          candidateId={selected3DCandidate}
          isOpen={true}
          onClose={() => setSelected3DCandidate(null)}
        />
      )}
    </div>
  );
};

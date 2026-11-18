import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Magnet,
  Play,
  RotateCw,
  Eye,
  Download,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Activity,
  Layers,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { useExperiment } from '../context/ExperimentContext';
import { useToast } from '../context/ToastContext';
import { api } from '../api/client';
import { Stage4bRecord } from '../../src/api/types';
import { MolecularViewer3D } from '../components/molecular/MolecularViewer3D';

export const DockingRescoringPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeRunId, refreshExperiments } = useExperiment();
  const { toast } = useToast();

  const [loading, setLoading] = useState<boolean>(false);
  const [records, setRecords] = useState<Stage4bRecord[]>([]);

  // Config parameters
  const [exhaustiveness, setExhaustiveness] = useState<number>(4);
  const [boxSize, setBoxSize] = useState<[number, number, number]>([20, 20, 20]);
  const [maxMmIters, setMaxMmIters] = useState<number>(40);
  const [runGnina, setRunGnina] = useState<boolean>(true);

  const [selected3DCandidate, setSelected3DCandidate] = useState<string | null>(null);

  // Load existing Stage 4b records if available
  useEffect(() => {
    if (!activeRunId) return;
    api
      .getStage4bResults(activeRunId)
      .then((res) => {
        if (res.success && res.records) {
          setRecords(res.records);
        }
      })
      .catch(() => {});
  }, [activeRunId]);

  const handleRunDocking = async () => {
    if (!activeRunId) {
      toast('Please select or create an active experiment run first', 'warning');
      return;
    }

    setLoading(true);
    toast(
      'Executing Stage 4b: AutoDock Vina Docking → OpenMM Relaxation → GNINA Rescoring…',
      'info'
    );

    try {
      const res = await api.runStage4b({
        run_id: activeRunId,
        exhaustiveness,
        box_size: boxSize,
        max_mm_iters: maxMmIters,
        run_gnina: runGnina,
      });

      if (res.success) {
        toast(
          `Stage 4b complete! ${res.n_docked ?? res.n_candidates} poses docked · ${res.n_qc_pass ?? 0} QC-PASS`,
          'success'
        );
        refreshExperiments();
        // Reload per-candidate table
        const recRes = await api.getStage4bResults(activeRunId);
        if (recRes.success) setRecords(recRes.records || []);
      } else {
        toast(`Stage 4b failed: ${res.message}`, 'error');
      }
    } catch (err: any) {
      toast(`Stage 4b error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const qcPassedCount = records.filter((r) => r.qc_verdict === 'PASS_QC').length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <Magnet className="w-6 h-6 text-cyan-400" />
            Physics-Based Docking, OpenMM Relaxation & GNINA Rescoring
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Simulates dynamic pocket binding poses using AutoDock Vina, relaxes complexes in OpenMM (ff14SB + OpenFF), and scores CNN affinities with GNINA.
          </p>
        </div>

        {activeRunId && (
          <div className="text-xs font-mono px-3 py-1.5 rounded-xl bg-[#111A2B] border border-[#26354B] text-slate-300">
            Active Run: <span className="text-cyan-400 font-bold">{activeRunId}</span>
          </div>
        )}
      </div>

      {/* Docking Configuration Card */}
      <div className="p-6 rounded-2xl border border-[#26354B] bg-[#0E1726] space-y-5">
        <h2 className="font-heading text-base font-bold text-slate-100 flex items-center gap-2">
          <Zap className="w-4 h-4 text-cyan-400" />
          Execution Parameters & Optimization
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Vina Exhaustiveness
            </label>
            <input
              type="number"
              min={1}
              max={16}
              value={exhaustiveness}
              onChange={(e) => setExhaustiveness(parseInt(e.target.value) || 4)}
              className="w-full px-3 py-2 rounded-xl bg-[#18243A] border border-[#26354B] text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-400"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">
              Default 4 (Balanced screening speed & accuracy)
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Box Size X × Y × Z (Å)
            </label>
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <input
                type="number"
                value={boxSize[0]}
                onChange={(e) => setBoxSize([parseFloat(e.target.value) || 20, boxSize[1], boxSize[2]])}
                className="w-full px-2 py-2 rounded-lg bg-[#18243A] border border-[#26354B] text-slate-200 text-center"
              />
              <span className="text-slate-500">×</span>
              <input
                type="number"
                value={boxSize[1]}
                onChange={(e) => setBoxSize([boxSize[0], parseFloat(e.target.value) || 20, boxSize[2]])}
                className="w-full px-2 py-2 rounded-lg bg-[#18243A] border border-[#26354B] text-slate-200 text-center"
              />
              <span className="text-slate-500">×</span>
              <input
                type="number"
                value={boxSize[2]}
                onChange={(e) => setBoxSize([boxSize[0], boxSize[1], parseFloat(e.target.value) || 20])}
                className="w-full px-2 py-2 rounded-lg bg-[#18243A] border border-[#26354B] text-slate-200 text-center"
              />
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">Catalytic site grid volume</span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              OpenMM Max Iterations
            </label>
            <input
              type="number"
              min={10}
              max={150}
              value={maxMmIters}
              onChange={(e) => setMaxMmIters(parseInt(e.target.value) || 40)}
              className="w-full px-3 py-2 rounded-xl bg-[#18243A] border border-[#26354B] text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-400"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">
              Optimized 40 iters (Local L-BFGS force convergence)
            </span>
          </div>

          <div className="flex flex-col justify-center">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-300">
              <input
                type="checkbox"
                checked={runGnina}
                onChange={(e) => setRunGnina(e.target.checked)}
                className="rounded bg-[#18243A] border-[#26354B] text-cyan-500 focus:ring-0"
              />
              <span>Enable GNINA Deep CNN Scoring</span>
            </label>
            <span className="text-[11px] text-slate-500 mt-1">In-process CNN affinity evaluation</span>
          </div>
        </div>

        <button
          onClick={handleRunDocking}
          disabled={loading || !activeRunId}
          className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 text-slate-950 font-bold text-sm shadow-glow-cyan transition-all disabled:opacity-40"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              Executing Docking & Relaxation (Parallelized)…
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              Run Stage 4b — Docking, OpenMM & GNINA
            </>
          )}
        </button>
      </div>

      {/* Docking Summary Banner & Table (Visible ONLY after Stage 4b generation) */}
      {records.length > 0 ? (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-[#26354B] bg-[#0E1726]">
              <div className="text-xs text-slate-400 font-mono">Docked Poses</div>
              <div className="font-mono text-xl font-bold text-cyan-300 mt-1">{records.length}</div>
            </div>
            <div className="p-4 rounded-xl border border-[#26354B] bg-[#0E1726]">
              <div className="text-xs text-slate-400 font-mono">QC Passed Poses</div>
              <div className="font-mono text-xl font-bold text-emerald-400 mt-1">{qcPassedCount}</div>
            </div>
            <div className="p-4 rounded-xl border border-[#26354B] bg-[#0E1726]">
              <div className="text-xs text-slate-400 font-mono">Mean Vina Score</div>
              <div className="font-mono text-xl font-bold text-violet-300 mt-1">
                {records[0].vina_score_kcal_mol != null
                  ? `${parseFloat(String(records[0].vina_score_kcal_mol)).toFixed(2)} kcal/mol`
                  : '—'}
              </div>
            </div>
            <div className="p-4 rounded-xl border border-[#26354B] bg-[#0E1726]">
              <div className="text-xs text-slate-400 font-mono">Mean Ligand RMSD</div>
              <div className="font-mono text-xl font-bold text-slate-100 mt-1">
                {records[0].final_ligand_rmsd_A != null
                  ? `${parseFloat(String(records[0].final_ligand_rmsd_A)).toFixed(3)} Å`
                  : '—'}
              </div>
            </div>
          </div>

          {/* Records Table */}
          <div className="rounded-2xl border border-[#26354B] bg-[#0E1726] overflow-hidden">
            <div className="p-4 border-b border-[#26354B] flex items-center justify-between">
              <span className="font-heading text-sm font-bold text-slate-200">
                Per-Candidate Docking & Relaxation Audit ({records.length})
              </span>
              <span className="text-xs font-mono text-cyan-400">OpenMM + Vina + GNINA</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#111A2B] text-slate-400 font-mono uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="p-3">Candidate ID</th>
                    <th className="p-3 text-right">Vina (kcal/mol)</th>
                    <th className="p-3 text-right">OpenMM ΔE (kJ/mol)</th>
                    <th className="p-3 text-right">RMSD (Å)</th>
                    <th className="p-3 text-right">CNN Score</th>
                    <th className="p-3 text-right">CNN Affinity</th>
                    <th className="p-3 text-center">QC Verdict</th>
                    <th className="p-3 text-center">Explore Complex</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#26354B]/60 font-mono">
                  {records.map((r, i) => (
                    <tr key={i} className="hover:bg-[#18243A]/50 transition-colors">
                      <td className="p-3 font-bold text-cyan-300 truncate max-w-[200px]">{r.candidate_id}</td>
                      <td className="p-3 text-right text-cyan-400 font-bold">
                        {r.vina_score_kcal_mol != null ? parseFloat(String(r.vina_score_kcal_mol)).toFixed(2) : '—'}
                      </td>
                      <td className="p-3 text-right text-slate-300">
                        {r.energy_change_kJ_mol != null ? parseFloat(String(r.energy_change_kJ_mol)).toFixed(1) : '—'}
                      </td>
                      <td className="p-3 text-right text-emerald-400 font-bold">
                        {r.final_ligand_rmsd_A != null
                          ? parseFloat(String(r.final_ligand_rmsd_A)).toFixed(3)
                          : (r.rmsd != null ? parseFloat(String(r.rmsd)).toFixed(3) : '—')}
                      </td>
                      <td className="p-3 text-right text-violet-300">
                        {r.gnina_CNNscore != null ? parseFloat(String(r.gnina_CNNscore)).toFixed(3) : '—'}
                      </td>
                      <td className="p-3 text-right text-violet-400 font-bold">
                        {r.gnina_CNNaffinity != null ? parseFloat(String(r.gnina_CNNaffinity)).toFixed(2) : '—'}
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            r.qc_verdict === 'PASS_QC'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                          }`}
                        >
                          {r.qc_verdict || 'PENDING'}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => setSelected3DCandidate(r.candidate_id)}
                          className="flex items-center gap-1 mx-auto px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View 3D
                        </button>
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
              <strong className="text-cyan-300 font-semibold">Stage 4b physics evaluation complete!</strong> Ready to rank candidates using the multi-objective Composite Docking Index (CDI).
            </div>
            <button
              onClick={() => navigate('/cdi')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all shadow-sm"
            >
              Proceed to CDI Ranking (Stage 5)
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="p-12 rounded-2xl border border-dashed border-[#26354B] bg-[#0B1322] text-center space-y-3">
          <Magnet className="w-10 h-10 text-slate-600 mx-auto" />
          <div className="text-sm font-semibold text-slate-300">No Docking & Relaxation Records Found</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Click "Run Stage 4b — Docking, OpenMM & GNINA" above to dock candidates into the dynamic pocket and calculate relaxation RMSD.
          </p>
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

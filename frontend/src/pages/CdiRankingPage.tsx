import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy,
  Sliders,
  Play,
  Download,
  Eye,
  Sparkles,
  ShieldCheck,
  Activity,
  AlertTriangle,
  Info,
  CheckCircle2,
  Zap,
  ArrowRight,
} from 'lucide-react';
import { useExperiment } from '../context/ExperimentContext';
import { useToast } from '../context/ToastContext';
import { api } from '../api/client';
import { CdiRankedCandidate, CdiRankingWeights } from '../../src/api/types';
import { MolecularViewer3D } from '../components/molecular/MolecularViewer3D';

export const CdiRankingPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeRunId, refreshExperiments } = useExperiment();
  const { toast } = useToast();

  const [loading, setLoading] = useState<boolean>(false);
  const [rankedList, setRankedList] = useState<CdiRankedCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);

  // Weights state
  const [weights, setWeights] = useState<CdiRankingWeights>({
    w_vina: 0.25,
    w_gnina: 0.20,
    w_rmsd: 0.15,
    w_energy: 0.10,
    w_qc: 0.10,
    w_qed: 0.08,
    w_sas: 0.05,
    w_tox: 0.04,
    w_lipo: 0.02,
    w_mw: 0.01,
  });

  // Load CDI results
  const loadCdiResults = () => {
    if (!activeRunId) return;
    api
      .getCdiResults(activeRunId)
      .then((res) => {
        if (res.success && res.ranked_candidates) {
          setRankedList(res.ranked_candidates);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadCdiResults();
  }, [activeRunId]);

  const handleRunRanking = async () => {
    if (!activeRunId) {
      toast('Please establish an active experiment run first', 'warning');
      return;
    }

    setLoading(true);
    toast('Recalculating Multi-Objective CDI Ensemble Ranking…', 'info');

    try {
      const res = await api.runCdiRanking({
        run_id: activeRunId,
        weights,
      });

      if (res.success) {
        toast(`CDI Ranking computed! Top candidates: ${res.top_candidates?.length ?? 0}`, 'success');
        refreshExperiments();
        loadCdiResults();
      } else {
        toast(`CDI Ranking failed: ${res.message}`, 'error');
      }
    } catch (err: any) {
      toast(`CDI Ranking error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const hasDocking = rankedList.length > 0 && rankedList.some((r) => r.docking_evaluated);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <Trophy className="w-6 h-6 text-amber-400" />
            Composite Docking Index (CDI) Ensemble Ranking
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Multi-objective ranking across dynamic pocket affinity, OpenMM stability, deep GNINA rescoring, QED drug-likeness, SAS, and toxicity filters.
          </p>
        </div>

        {activeRunId && (
          <div className="text-xs font-mono px-3 py-1.5 rounded-xl bg-[#111A2B] border border-[#26354B] text-slate-300">
            Active Run: <span className="text-cyan-400 font-bold">{activeRunId}</span>
          </div>
        )}
      </div>

      {/* Pre-docking Alert if Stage 4b hasn't been run */}
      {!hasDocking && rankedList.length > 0 && (
        <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 flex items-start gap-3 text-xs text-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-300">Stage 4b Docking Not Yet Run for this Experiment</div>
            <p className="text-amber-200/90 leading-relaxed">
              Vina scores, GNINA affinities, and OpenMM RMSD values are displayed as "—" because Stage 4b has not completed. Current leaderboard uses pre-docking geometry & ADMET metrics. Run Stage 4b to compute exact binding affinities and relaxation RMSDs!
            </p>
          </div>
        </div>
      )}

      {/* Interactive Weight Sliders Panel */}
      <div className="p-6 rounded-2xl border border-[#26354B] bg-[#0E1726] space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#26354B]">
          <h2 className="font-heading text-base font-bold text-slate-100 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            CDI Objective Weights & Tuning
          </h2>
          <span className="text-xs font-mono text-slate-400">Sum of weights: 1.00</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-xs font-mono">
          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>Vina Affinity</span>
              <span className="text-cyan-400 font-bold">{weights.w_vina}</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.5"
              step="0.05"
              value={weights.w_vina}
              onChange={(e) => setWeights({ ...weights, w_vina: parseFloat(e.target.value) })}
              className="w-full accent-cyan-400"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>GNINA Rescore</span>
              <span className="text-violet-400 font-bold">{weights.w_gnina}</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.5"
              step="0.05"
              value={weights.w_gnina}
              onChange={(e) => setWeights({ ...weights, w_gnina: parseFloat(e.target.value) })}
              className="w-full accent-violet-400"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>OpenMM RMSD</span>
              <span className="text-emerald-400 font-bold">{weights.w_rmsd}</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.4"
              step="0.05"
              value={weights.w_rmsd}
              onChange={(e) => setWeights({ ...weights, w_rmsd: parseFloat(e.target.value) })}
              className="w-full accent-emerald-400"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>OpenMM ΔE</span>
              <span className="text-indigo-400 font-bold">{weights.w_energy}</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.3"
              step="0.05"
              value={weights.w_energy}
              onChange={(e) => setWeights({ ...weights, w_energy: parseFloat(e.target.value) })}
              className="w-full accent-indigo-400"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>QED Drug-Likeness</span>
              <span className="text-cyan-400 font-bold">{weights.w_qed}</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.3"
              step="0.02"
              value={weights.w_qed}
              onChange={(e) => setWeights({ ...weights, w_qed: parseFloat(e.target.value) })}
              className="w-full accent-cyan-400"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>SAS Score</span>
              <span className="text-slate-300 font-bold">{weights.w_sas}</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.2"
              step="0.01"
              value={weights.w_sas}
              onChange={(e) => setWeights({ ...weights, w_sas: parseFloat(e.target.value) })}
              className="w-full accent-slate-400"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>Toxicity Risk</span>
              <span className="text-rose-400 font-bold">{weights.w_tox}</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.2"
              step="0.01"
              value={weights.w_tox}
              onChange={(e) => setWeights({ ...weights, w_tox: parseFloat(e.target.value) })}
              className="w-full accent-rose-400"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>QC Gate</span>
              <span className="text-emerald-400 font-bold">{weights.w_qc}</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.3"
              step="0.05"
              value={weights.w_qc}
              onChange={(e) => setWeights({ ...weights, w_qc: parseFloat(e.target.value) })}
              className="w-full accent-emerald-400"
            />
          </div>
        </div>

        <button
          onClick={handleRunRanking}
          disabled={loading || !activeRunId}
          className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 text-slate-950 font-bold text-sm shadow-glow-cyan transition-all disabled:opacity-40"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              Computing Rankings…
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              Recalculate CDI Ranking
            </>
          )}
        </button>
      </div>

      {/* CDI Ranked Leaderboard Table */}
      <div className="rounded-2xl border border-[#26354B] bg-[#0E1726] overflow-hidden">
        <div className="p-4 border-b border-[#26354B] flex items-center justify-between">
          <span className="font-heading text-sm font-bold text-slate-200">
            CDI Inhibitor Candidate Leaderboard ({rankedList.length})
          </span>
          <span className="text-xs font-mono text-cyan-400">Ranked by Composite Docking Index</span>
        </div>

        {rankedList.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#111A2B] text-slate-400 font-mono uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="p-3 text-center">Rank</th>
                  <th className="p-3">Candidate ID</th>
                  <th className="p-3 text-center">Tier</th>
                  <th className="p-3 text-right">CDI Score</th>
                  <th className="p-3 text-right">Vina (kcal/mol)</th>
                  <th className="p-3 text-right">GNINA (pKd)</th>
                  <th className="p-3 text-right">RMSD (Å)</th>
                  <th className="p-3 text-right">QED</th>
                  <th className="p-3 text-right">SAS</th>
                  <th className="p-3 text-center">Tox Risk</th>
                  <th className="p-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#26354B]/60 font-mono">
                {rankedList.map((cand) => {
                  const vina = cand.vina_score_kcal_mol != null ? parseFloat(String(cand.vina_score_kcal_mol)).toFixed(2) : (cand.vina_top_score != null ? parseFloat(String(cand.vina_top_score)).toFixed(2) : '—');
                  const gnina = cand.gnina_CNNaffinity != null ? parseFloat(String(cand.gnina_CNNaffinity)).toFixed(2) : '—';
                  const rmsd = cand.final_ligand_rmsd_A != null ? parseFloat(String(cand.final_ligand_rmsd_A)).toFixed(3) : (cand.rmsd != null ? parseFloat(String(cand.rmsd)).toFixed(3) : '—');
                  const qed = cand.qed != null ? parseFloat(String(cand.qed)).toFixed(2) : (cand.prop_QED != null ? parseFloat(String(cand.prop_QED)).toFixed(2) : '—');
                  const sas = cand.sas != null ? parseFloat(String(cand.sas)).toFixed(2) : (cand.prop_SA_Score != null ? parseFloat(String(cand.prop_SA_Score)).toFixed(2) : '—');
                  const tox = cand.tox_risk || 'Low (Clean)';

                  return (
                    <tr key={cand.cdi_rank} className="hover:bg-[#18243A]/50 transition-colors">
                      <td className="p-3 text-center font-bold text-slate-100">
                        {cand.cdi_rank === 1 ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">
                            1
                          </span>
                        ) : (
                          cand.cdi_rank
                        )}
                      </td>
                      <td className="p-3 font-bold text-cyan-300 truncate max-w-[200px]">
                        {cand.candidate_id || cand.record_id}
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            cand.cdi_tier.includes('Tier 1')
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : cand.cdi_tier.includes('Tier 2')
                              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                              : 'bg-slate-500/15 text-slate-400 border border-slate-500/30'
                          }`}
                        >
                          {cand.cdi_tier}
                        </span>
                      </td>
                      <td className="p-3 text-right font-bold text-cyan-400">
                        {parseFloat(String(cand.cdi_score)).toFixed(4)}
                      </td>
                      <td className="p-3 text-right text-slate-200">{vina}</td>
                      <td className="p-3 text-right text-violet-300 font-bold">{gnina}</td>
                      <td className="p-3 text-right text-emerald-400">{rmsd}</td>
                      <td className="p-3 text-right text-slate-200">{qed}</td>
                      <td className="p-3 text-right text-indigo-300">{sas}</td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                            tox.toLowerCase().includes('clean') || tox.toLowerCase().includes('low')
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {tox}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => setSelectedCandidate(cand.candidate_id || cand.record_id || null)}
                          className="flex items-center gap-1 mx-auto px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View 3D
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-xs text-slate-500 space-y-2">
            <Trophy className="w-8 h-8 text-slate-600 mx-auto" />
            <p>No CDI ranking results found for the active experiment.</p>
            <p>Click "Recalculate CDI Ranking" above to compute lead candidate prioritization.</p>
          </div>
        )}
      </div>

      {/* Next Step Banner */}
      {rankedList.length > 0 && (
        <div className="p-4 rounded-xl border border-cyan-500/40 bg-cyan-950/20 flex items-center justify-between">
          <div className="text-xs text-slate-300">
            <strong className="text-cyan-300 font-semibold">CDI Ranking complete!</strong> You can now export full ranking tables, PDBs, and SDF coordinate archives.
          </div>
          <button
            onClick={() => navigate('/results')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all shadow-sm"
          >
            View Results & Export Reports
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3D Structure Viewer Modal */}
      {selectedCandidate && activeRunId && (
        <MolecularViewer3D
          runId={activeRunId}
          candidateId={selectedCandidate}
          isOpen={true}
          onClose={() => setSelectedCandidate(null)}
        />
      )}
    </div>
  );
};

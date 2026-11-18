import React from 'react';
import {
  History,
  CheckCircle2,
  Clock,
  Sparkles,
  Trophy,
  ArrowRight,
  Layers,
} from 'lucide-react';
import { useExperiment } from '../context/ExperimentContext';

export const ExperimentsPage: React.FC = () => {
  const { experiments, activeRunId, setActiveRunId, refreshExperiments } = useExperiment();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <History className="w-6 h-6 text-cyan-400" />
            Experiment Runs & Artifact History
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage computational runs, review stage completion statuses, and switch active workspace sessions.
          </p>
        </div>
        <button
          onClick={refreshExperiments}
          className="px-3.5 py-1.5 rounded-xl border border-[#26354B] bg-[#111A2B] hover:bg-[#18243A] text-xs font-semibold text-slate-300 transition-colors"
        >
          Refresh Runs
        </button>
      </div>

      {/* Experiments Table */}
      <div className="rounded-2xl border border-[#26354B] bg-[#0E1726] overflow-hidden">
        <div className="p-4 border-b border-[#26354B] flex items-center justify-between">
          <span className="font-heading text-sm font-bold text-slate-200">
            Recorded Pipeline Experiments ({experiments.length})
          </span>
          <span className="text-xs font-mono text-cyan-400">Disk Outputs</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#111A2B] text-slate-400 font-mono uppercase text-[10px] tracking-wider">
              <tr>
                <th className="p-3">Run Identifier</th>
                <th className="p-3">Created Date</th>
                <th className="p-3">Stages Completed</th>
                <th className="p-3 text-right">Candidates</th>
                <th className="p-3 text-right">Docked Poses</th>
                <th className="p-3 text-right">Top CDI</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-center">Select</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#26354B]/60 font-mono">
              {experiments.map((exp) => {
                const isActive = exp.run_id === activeRunId;
                return (
                  <tr
                    key={exp.run_id}
                    className={`transition-colors ${
                      isActive ? 'bg-cyan-950/20' : 'hover:bg-[#18243A]/50'
                    }`}
                  >
                    <td className="p-3 font-bold text-cyan-300">{exp.run_id}</td>
                    <td className="p-3 text-slate-400 font-sans">{exp.created_at || 'Saved Run'}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-1 text-[10px]">
                        <span className={`px-1.5 py-0.5 rounded ${exp.stage1 ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-600'}`}>S1</span>
                        <span className={`px-1.5 py-0.5 rounded ${exp.stage2 ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-600'}`}>S2</span>
                        <span className={`px-1.5 py-0.5 rounded ${exp.stage3 ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-600'}`}>S3</span>
                        <span className={`px-1.5 py-0.5 rounded ${exp.stage4 ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-600'}`}>S4</span>
                        <span className={`px-1.5 py-0.5 rounded ${exp.stage4b ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'bg-slate-800 text-slate-600'}`}>S4b</span>
                        <span className={`px-1.5 py-0.5 rounded ${exp.cdi ? 'bg-amber-500/20 text-amber-300 font-bold' : 'bg-slate-800 text-slate-600'}`}>CDI</span>
                      </div>
                    </td>
                    <td className="p-3 text-right text-slate-200">{exp.n_candidates}</td>
                    <td className="p-3 text-right text-cyan-400 font-bold">{exp.n_docked}</td>
                    <td className="p-3 text-right text-emerald-400 font-bold">
                      {exp.top_cdi_score != null ? exp.top_cdi_score.toFixed(4) : '—'}
                    </td>
                    <td className="p-3 text-center">
                      {isActive ? (
                        <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[10px] font-bold">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[10px]">Available</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => setActiveRunId(exp.run_id)}
                        disabled={isActive}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                          isActive
                            ? 'bg-cyan-500 text-slate-950 opacity-90 cursor-default'
                            : 'bg-[#18243A] hover:bg-cyan-500/20 text-slate-200 hover:text-cyan-300 border border-[#26354B]'
                        }`}
                      >
                        {isActive ? 'Active' : 'Switch'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

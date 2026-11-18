import React from 'react';
import {
  FileSpreadsheet,
  Download,
  FileText,
  Package,
  Layers,
  Sparkles,
  Trophy,
  ExternalLink,
} from 'lucide-react';
import { useExperiment } from '../context/ExperimentContext';

export const ResultsReportsPage: React.FC = () => {
  const { activeRunId } = useExperiment();

  const downloadLinks = [
    {
      title: 'Full CDI Ranked Candidates CSV',
      desc: 'Complete table of all generated candidates sorted by Composite Docking Index with all ADMET properties.',
      url: `/api/cdi/download/${activeRunId}/cdi_ranked_candidates.csv`,
      filename: `cdi_ranked_${activeRunId}.csv`,
      icon: FileSpreadsheet,
      color: 'cyan',
    },
    {
      title: 'Top-Lead Candidates CSV (Tier 1)',
      desc: 'Filtered subset containing top-priority inhibitor leads meeting QC stability & drug-likeness gates.',
      url: `/api/cdi/download/${activeRunId}/cdi_top_candidates.csv`,
      filename: `cdi_top_${activeRunId}.csv`,
      icon: Trophy,
      color: 'amber',
    },
    {
      title: 'CDI Ranking JSON Audit Report',
      desc: 'Machine-readable summary report with normalization bounds, objective distributions and weights.',
      url: `/api/cdi/download/${activeRunId}/cdi_ranking_report.json`,
      filename: `cdi_report_${activeRunId}.json`,
      icon: FileText,
      color: 'violet',
    },
    {
      title: 'All OpenMM Relaxed Complexes (ZIP)',
      desc: 'Archive containing all full-atom receptor-ligand complex PDB structures relaxed by OpenMM.',
      url: `/api/stage4b/download_archive/${activeRunId}`,
      filename: `stage4b_${activeRunId}_relaxed.zip`,
      icon: Package,
      color: 'emerald',
    },
    {
      title: 'Stage 3 Flow-Matched SDF Archive (ZIP)',
      desc: 'Archive of all initial generated 3D ligand conformers before physics-based docking.',
      url: `/api/stage3/download_archive/${activeRunId}`,
      filename: `stage3_${activeRunId}_sdf.zip`,
      icon: Layers,
      color: 'blue',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-slate-100 flex items-center gap-2.5">
          <FileSpreadsheet className="w-6 h-6 text-cyan-400" />
          Results & Export Reports
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Download pipeline datasets, ranked inhibitor candidate CSVs, 3D coordinate archives, and audit reports.
        </p>
      </div>

      {/* Active Run Banner */}
      <div className="p-4 rounded-xl border border-[#26354B] bg-[#0E1726] flex items-center justify-between text-xs">
        <span className="text-slate-300">
          Showing exportable artifacts for active experiment run:{' '}
          <strong className="text-cyan-400 font-mono text-sm">{activeRunId || 'None Selected'}</strong>
        </span>
      </div>

      {/* Download Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {downloadLinks.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              className="p-5 rounded-2xl border border-[#26354B] bg-[#0E1726] flex flex-col justify-between space-y-4 hover:border-cyan-500/50 transition-all shadow-md group"
            >
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-heading text-sm font-bold text-slate-100 group-hover:text-cyan-300 transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{item.desc}</p>
                </div>
              </div>

              <a
                href={activeRunId ? item.url : '#'}
                download={item.filename}
                className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-xs border transition-all ${
                  activeRunId
                    ? 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                    : 'bg-[#18243A] text-slate-500 border-[#26354B] cursor-not-allowed'
                }`}
              >
                <Download className="w-4 h-4" />
                Download Artifact
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
};

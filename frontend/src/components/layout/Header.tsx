import React, { useState } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { useExperiment } from '../../context/ExperimentContext';
import {
  Activity,
  PlusCircle,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  Database,
  Cpu,
  Zap,
} from 'lucide-react';
import { QuickPipelineWizard } from '../common/QuickPipelineWizard';

const routeTitles: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Overview & Research Dashboard', subtitle: 'Dynamic pocket modelling & pocket-conditioned inhibitor design' },
  '/targets': { title: 'Protein Target Management', subtitle: 'Upload and inspect 3D macromolecular structures (General Targets & Benchmark)' },
  '/pockets': { title: 'Dynamic Pocket Analysis', subtitle: 'Explore K pocket conformers & 3D pharmacophore tensors' },
  '/generation': { title: 'Molecular Generation Studio', subtitle: '2D topology generation & conditional 3D flow matching' },
  '/library': { title: 'Molecule Library', subtitle: 'Search, filter, and inspect generated lead candidates' },
  '/validation': { title: 'Molecular Geometry Validation', subtitle: 'Bond geometries, clash checks & MMFF94s minimization' },
  '/docking': { title: 'Docking & Physics Evaluation', subtitle: 'AutoDock Vina, OpenMM relaxation & GNINA CNN rescoring' },
  '/cdi': { title: 'CDI Ensemble Ranking', subtitle: 'Composite Docking Index multi-metric candidate prioritization' },
  '/results': { title: 'Results & Research Insights', subtitle: 'Consolidated candidate gallery, comparison & export' },
  '/experiments': { title: 'Experiment Management', subtitle: 'Audit, browse, and switch between previous pipeline runs' },
  '/settings': { title: 'Platform & Dependency Settings', subtitle: 'Backend health, model checkpoints, and computational settings' },
};

export const Header: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { health, healthLoading, activeRunId, setActiveRunId, experiments } = useExperiment();
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);

  const currentMeta = routeTitles[location.pathname] || {
    title: 'FlexiGEN Platform',
    subtitle: 'AI-Powered Drug Discovery',
  };

  return (
    <>
    <header className="h-16 px-6 border-b border-[#26354B] bg-[#0E1726]/90 backdrop-blur-md flex items-center justify-between z-10 shrink-0">
      {/* Page Title & Breadcrumbs */}
      <div className="flex flex-col">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span>FlexiGEN</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
          <span className="text-cyan-400 font-semibold">{currentMeta.title.split(' ')[0]}</span>
        </div>
        <h1 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          {currentMeta.title}
          <span className="hidden lg:inline text-xs font-normal text-slate-400">
            — {currentMeta.subtitle}
          </span>
        </h1>
      </div>

      {/* Right Controls: Experiment Switcher, Health, New Run */}
      <div className="flex items-center gap-3">
        {/* Quick Automated Run CTA */}
        <button
          onClick={() => setWizardOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-xs transition-all shadow-sm"
          title="Automated 1-Click Pipeline Execution"
        >
          <Zap className="w-3.5 h-3.5 fill-current" />
          <span className="hidden sm:inline">1-Click Run</span>
        </button>

        {/* Active Run Switcher */}
        <div className="flex items-center gap-2 bg-[#142033] border border-[#26354B] rounded-lg px-2.5 py-1.5 text-xs">
          <Database className="w-3.5 h-3.5 text-violet-400 shrink-0" />
          <span className="text-slate-400 font-medium hidden sm:inline">Active Run:</span>
          <select
            value={activeRunId || ''}
            onChange={(e) => setActiveRunId(e.target.value)}
            className="bg-transparent text-cyan-300 font-mono font-semibold focus:outline-none cursor-pointer"
          >
            {experiments.map((exp) => (
              <option key={exp.run_id} value={exp.run_id} className="bg-[#111A2B] text-slate-200">
                {exp.run_id} {exp.target_protein ? `(${exp.target_protein})` : (exp.run_id === 'ffd5e588' ? '(PARP1 Benchmark)' : `(${exp.created_at.slice(5, 10)})`)}
              </option>
            ))}
            {experiments.length === 0 && <option value="">No runs available</option>}
          </select>
        </div>

        {/* Backend Connectivity Status */}
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-medium"
          style={{
            backgroundColor: health?.status === 'ok' ? 'rgba(52, 211, 153, 0.08)' : 'rgba(248, 113, 113, 0.08)',
            borderColor: health?.status === 'ok' ? 'rgba(52, 211, 153, 0.3)' : 'rgba(248, 113, 113, 0.3)',
            color: health?.status === 'ok' ? '#34D399' : '#F87171',
          }}
          title={
            health?.status === 'ok'
              ? `Backend Connected (v${health.version}) · PyTorch: ${health.torch_available ? 'OK' : 'X'} · RDKit: ${
                  health.rdkit_available ? 'OK' : 'X'
                }`
              : 'Backend Offline at http://127.0.0.1:5000'
          }
        >
          <span
            className={`w-2 h-2 rounded-full ${
              healthLoading
                ? 'bg-amber-400 animate-pulse'
                : health?.status === 'ok'
                ? 'bg-emerald-400'
                : 'bg-rose-400'
            }`}
          />
          <span className="hidden md:inline">
            {healthLoading ? 'Connecting…' : health?.status === 'ok' ? 'API Online' : 'API Offline'}
          </span>
        </div>

        {/* New Experiment CTA */}
        <button
          onClick={() => navigate('/targets')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-semibold text-xs transition-all shadow-glow-cyan"
        >
          <PlusCircle className="w-4 h-4 text-slate-950" />
          <span>New Run</span>
        </button>
      </div>
    </header>

    {/* 1-Click Pipeline Wizard Modal */}
    <QuickPipelineWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} />
    </>
  );
};

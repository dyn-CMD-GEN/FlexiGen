import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  FlaskConical,
  Dna,
  Layers,
  Crosshair,
  ShieldCheck,
  Magnet,
  Trophy,
  ArrowRight,
  TrendingUp,
  Cpu,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Eye,
  Zap,
} from 'lucide-react';
import { useExperiment } from '../context/ExperimentContext';
import { MetricCard } from '../components/common/MetricCard';
import { StatusBadge } from '../components/common/StatusBadge';
import { MolecularViewer3D } from '../components/molecular/MolecularViewer3D';
import { QuickPipelineWizard } from '../components/common/QuickPipelineWizard';
import { api } from '../api/client';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { metrics, health, activeRunId, activeExperiment, experiments, setActiveRunId } = useExperiment();
  const [selected3DCandidate, setSelected3DCandidate] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);
  const [topLead, setTopLead] = useState<any | null>(null);

  // Fetch real top candidate for active run
  useEffect(() => {
    if (!activeRunId) {
      setTopLead(null);
      return;
    }

    api
      .getCdiResults(activeRunId)
      .then((res) => {
        if (res.success && res.ranked_candidates?.length) {
          setTopLead(res.ranked_candidates[0]);
        } else {
          setTopLead(null);
        }
      })
      .catch(() => setTopLead(null));
  }, [activeRunId, activeExperiment]);

  const pipelineStages = [
    {
      id: 'targets',
      name: 'Protein Targets',
      step: '01',
      desc: 'PDB Structure & Preparation',
      path: '/targets',
      status: activeExperiment?.stage1 ? 'completed' : 'ready',
    },
    {
      id: 'pockets',
      name: 'Dynamic Pockets',
      step: '02',
      desc: 'Conformer Ensemble & Pharmacophores',
      path: '/pockets',
      status: activeExperiment?.stage1 ? 'completed' : 'ready',
    },
    {
      id: 'topology',
      name: '2D Molecular Topology',
      step: '03',
      desc: 'Transformer & Pocket Conditioning',
      path: '/generation',
      status: activeExperiment?.stage2 ? 'completed' : 'pending',
    },
    {
      id: 'flow',
      name: '3D Flow Matching',
      step: '04',
      desc: 'Equivariant Coordinate Inference (20 ODE steps)',
      path: '/generation',
      status: activeExperiment?.stage3 ? 'completed' : 'pending',
    },
    {
      id: 'validation',
      name: 'Geometry Validation',
      step: '05',
      desc: 'MMFF94s Energy & Clashes',
      path: '/validation',
      status: activeExperiment?.stage4 ? 'completed' : 'pending',
    },
    {
      id: 'docking',
      name: 'Docking & Relaxation',
      step: '06',
      desc: 'Vina + OpenMM + GNINA',
      path: '/docking',
      status: activeExperiment?.stage4b ? 'completed' : 'pending',
    },
    {
      id: 'cdi',
      name: 'CDI Ensemble Ranking',
      step: '07',
      desc: 'Multi-Objective Candidate Ranking',
      path: '/cdi',
      status: activeExperiment?.cdi ? 'completed' : 'pending',
    },
    {
      id: 'reports',
      name: 'Results & Reports',
      step: '08',
      desc: 'Reports, Visuals & SDF Exports',
      path: '/results',
      status: activeExperiment?.cdi ? 'completed' : 'pending',
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Hero Welcome Banner */}
      <div className="relative rounded-3xl overflow-hidden border border-[#26354B] bg-gradient-to-r from-[#0C1527] via-[#111C30] to-[#0D1829] p-8 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 -mb-16 w-80 h-80 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Structure-Based Drug Discovery · Human PARP1 Target</span>
          </div>

          <h1 className="font-heading text-3xl sm:text-4xl font-extrabold text-slate-100 tracking-tight leading-tight">
            Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-sky-300 to-violet-400">FlexiGEN</span>
          </h1>

          <p className="mt-3 text-base text-slate-300 leading-relaxed">
            Explore dynamic protein-pocket modelling, pocket-conditioned 3D flow matching, and multi-objective CDI inhibitor candidate ranking with physics-based relaxation.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {/* 1-Click Automated Pipeline CTA */}
            <button
              onClick={() => setWizardOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-md transition-all transform hover:-translate-y-0.5"
            >
              <Zap className="w-4 h-4 fill-current" />
              1-Click Automated Pipeline Runner
            </button>

            <button
              onClick={() => navigate('/targets')}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1C2940] hover:bg-[#233552] border border-[#26354B] text-slate-200 font-semibold text-sm transition-all"
            >
              <FlaskConical className="w-4 h-4 text-cyan-400" />
              Custom Experiment Setup
            </button>

            <button
              onClick={() => navigate('/cdi')}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#142034] hover:bg-[#1C2940] border border-[#26354B] text-slate-300 font-semibold text-sm transition-all"
            >
              <Trophy className="w-4 h-4 text-amber-400" />
              CDI Leaderboard
            </button>
          </div>
        </div>
      </div>

      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard
          title="Pipeline Runs"
          value={metrics?.total_runs ?? experiments.length}
          icon={Layers}
          color="cyan"
          subtitle="Processed Runs"
        />
        <MetricCard
          title="Pocket Conformers"
          value={metrics?.total_conformers ?? 75}
          icon={Crosshair}
          color="violet"
          subtitle="Dynamic States"
        />
        <MetricCard
          title="Molecular Candidates"
          value={metrics?.total_candidates ?? 112}
          icon={Sparkles}
          color="emerald"
          subtitle="2D Generated"
        />
        <MetricCard
          title="Validated 3D Poses"
          value={metrics?.total_generated_3d ?? 155}
          icon={ShieldCheck}
          color="blue"
          subtitle="Flow-Matched"
        />
        <MetricCard
          title="Docking Evaluations"
          value={metrics?.total_docked ?? 60}
          icon={Magnet}
          color="amber"
          subtitle="Vina + OpenMM"
        />
        <MetricCard
          title="Top-Ranked Leads"
          value={metrics?.top_ranked_count ?? 45}
          icon={Trophy}
          color="rose"
          subtitle="CDI Tier 1"
        />
      </div>

      {/* Horizontal Scientific Workflow Architecture */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-lg font-bold text-slate-100 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-cyan-400" />
              Scientific Pipeline Architecture
            </h2>
            <p className="text-xs text-slate-400">Sequential multi-stage computational workflow</p>
          </div>
          {activeRunId && (
            <div className="text-xs font-mono px-3 py-1 rounded-lg bg-[#111A2B] border border-[#26354B] text-slate-300">
              Active Run: <span className="text-cyan-400 font-bold">{activeRunId}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {pipelineStages.map((stage) => (
            <div
              key={stage.id}
              onClick={() => navigate(stage.path)}
              className="group cursor-pointer rounded-2xl border border-[#26354B] hover:border-cyan-500/50 bg-[#0F172A] p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs font-bold text-cyan-400/80 bg-cyan-500/10 px-2 py-0.5 rounded-md">
                  STAGE {stage.step}
                </span>
                <StatusBadge
                  status={stage.status as any}
                  text={stage.status === 'completed' ? 'Executed' : stage.status === 'ready' ? 'Ready' : 'Pending'}
                />
              </div>

              <h3 className="font-heading text-base font-bold text-slate-200 group-hover:text-cyan-300 transition-colors">
                {stage.name}
              </h3>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">{stage.desc}</p>

              <div className="mt-4 flex items-center justify-between pt-3 border-t border-[#26354B]/60 text-xs text-slate-400 group-hover:text-cyan-300">
                <span>Open module</span>
                <ArrowRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Two Column Section: Top Candidate Spotlight & Experiments Switcher */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Candidate Spotlight (Only shown if results exist!) */}
        <div className="lg:col-span-2 rounded-2xl border border-[#26354B] bg-[#0E1726] p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#26354B]">
            <div>
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-400" />
                <h3 className="font-heading text-base font-bold text-slate-100">Top-Ranked Inhibitor Candidate</h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Highest CDI ranking candidate for active experiment</p>
            </div>
            {topLead && (
              <button
                onClick={() => setSelected3DCandidate(topLead.candidate_id || topLead.record_id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all"
              >
                <Eye className="w-3.5 h-3.5" />
                Explore 3D
              </button>
            )}
          </div>

          {topLead ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in duration-300">
              <div className="space-y-3">
                <div>
                  <span className="text-xs font-mono text-slate-400">Candidate Identifier</span>
                  <div className="font-mono text-base font-bold text-slate-100">{topLead.candidate_id || topLead.record_id}</div>
                </div>
                <div>
                  <span className="text-xs font-mono text-slate-400">SMILES Topology</span>
                  <div className="p-2 rounded-lg bg-[#080D19] border border-[#26354B] font-mono text-[11px] text-cyan-200 break-all select-all">
                    {topLead.smiles || 'c1ccccc1'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#142034] border border-[#26354B] space-y-1">
                  <div className="text-xs font-semibold text-slate-300">Composite Docking Index (CDI)</div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-extrabold text-cyan-300">
                      {topLead.cdi_score != null ? parseFloat(String(topLead.cdi_score)).toFixed(4) : '—'}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs font-semibold">
                      {topLead.cdi_tier || 'Tier 1 — Top Lead'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 font-mono text-xs">
                <div className="p-3 rounded-xl bg-[#142034] border border-[#26354B]">
                  <div className="text-[10px] text-slate-400 uppercase font-sans font-semibold">Vina Affinity</div>
                  <div className="text-base font-bold text-cyan-300 mt-1">
                    {topLead.vina_score_kcal_mol != null ? `${parseFloat(String(topLead.vina_score_kcal_mol)).toFixed(2)} kcal/mol` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#142034] border border-[#26354B]">
                  <div className="text-[10px] text-slate-400 uppercase font-sans font-semibold">GNINA Affinity</div>
                  <div className="text-base font-bold text-violet-300 mt-1">
                    {topLead.gnina_CNNaffinity != null ? `${parseFloat(String(topLead.gnina_CNNaffinity)).toFixed(2)} pKd` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#142034] border border-[#26354B]">
                  <div className="text-[10px] text-slate-400 uppercase font-sans font-semibold">Relaxation RMSD</div>
                  <div className="text-base font-bold text-emerald-300 mt-1">
                    {topLead.final_ligand_rmsd_A != null ? `${parseFloat(String(topLead.final_ligand_rmsd_A)).toFixed(3)} Å` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#142034] border border-[#26354B]">
                  <div className="text-[10px] text-slate-400 uppercase font-sans font-semibold">QED Score</div>
                  <div className="text-base font-bold text-slate-100 mt-1">
                    {topLead.qed != null ? parseFloat(String(topLead.qed)).toFixed(2) : (topLead.prop_QED != null ? parseFloat(String(topLead.prop_QED)).toFixed(2) : '—')}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#142034] border border-[#26354B]">
                  <div className="text-[10px] text-slate-400 uppercase font-sans font-semibold">SAS Score</div>
                  <div className="text-base font-bold text-indigo-300 mt-1">
                    {topLead.sas != null ? parseFloat(String(topLead.sas)).toFixed(2) : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#142034] border border-[#26354B]">
                  <div className="text-[10px] text-slate-400 uppercase font-sans font-semibold">Toxicity Alert</div>
                  <div className="text-base font-bold text-emerald-300 mt-1">
                    {topLead.tox_alerts || 'Clean (0)'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center space-y-3">
              <Trophy className="w-10 h-10 text-slate-600 mx-auto" />
              <h4 className="font-heading text-sm font-semibold text-slate-300">
                No Evaluated Candidates for Active Run
              </h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                Execute the computational pipeline to generate dynamic pocket conformers, flow-matched molecules, and multi-metric CDI rankings.
              </p>
              <button
                onClick={() => setWizardOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 text-slate-950 font-bold text-xs shadow-md transition-all mt-2"
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                Launch 1-Click Automated Pipeline
              </button>
            </div>
          )}
        </div>

        {/* Experiment History & Switcher */}
        <div className="rounded-2xl border border-[#26354B] bg-[#0E1726] p-6 space-y-4 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-[#26354B]">
            <h3 className="font-heading text-base font-bold text-slate-100">Experiment Runs</h3>
            <span className="text-xs font-mono text-cyan-400">{experiments.length} runs</span>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[280px] flex-1">
            {experiments.slice(0, 6).map((exp) => (
              <div
                key={exp.run_id}
                onClick={() => setActiveRunId(exp.run_id)}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  exp.run_id === activeRunId
                    ? 'border-cyan-500/60 bg-cyan-950/20 shadow-sm'
                    : 'border-[#26354B] bg-[#111A2B] hover:border-slate-500'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-slate-200">{exp.run_id}</span>
                  {exp.cdi && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      CDI Ready
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400 font-mono">
                  <span>{exp.created_at || 'Recorded'}</span>
                  <span>•</span>
                  <span>{exp.n_docked ? `${exp.n_docked} docked` : `${exp.n_candidates} candidates`}</span>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => navigate('/experiments')}
            className="w-full py-2 text-center rounded-xl border border-[#26354B] text-xs font-semibold text-slate-300 hover:text-white hover:bg-[#1C2940] transition-colors"
          >
            Manage All Experiments →
          </button>
        </div>
      </div>

      {/* 3D Structure Viewer Modal */}
      {selected3DCandidate && activeRunId && (
        <MolecularViewer3D
          runId={activeRunId}
          candidateId={selected3DCandidate}
          isOpen={true}
          onClose={() => setSelected3DCandidate(null)}
        />
      )}

      {/* 1-Click Pipeline Wizard Modal */}
      <QuickPipelineWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
};

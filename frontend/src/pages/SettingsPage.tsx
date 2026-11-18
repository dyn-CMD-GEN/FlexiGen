import React from 'react';
import {
  Settings,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Info,
  Server,
  Zap,
  Shield,
  Layers,
} from 'lucide-react';
import { useExperiment } from '../context/ExperimentContext';

export const SettingsPage: React.FC = () => {
  const { health } = useExperiment();

  const dependencies = [
    { name: 'PyTorch Flow Engine', status: health?.torch_available, desc: 'PyTorch deep learning neural backend' },
    { name: 'RDKit Cheminformatics', status: health?.rdkit_available, desc: 'Structure sanitization, SMILES, 2D descriptors, QED' },
    { name: 'AutoDock Vina', status: health?.vina_available, desc: 'Empirical protein-ligand pocket docking engine' },
    { name: 'OpenMM & PDBFixer', status: health?.openmm_available, desc: 'Full-atom constrained molecular mechanics relaxation' },
    { name: 'GNINA Deep Rescoring', status: health?.gnina_available, desc: 'Convolutional neural network binding pose affinity rescoring' },
    { name: 'CDI Ensemble Ranking', status: health?.cdi_available, desc: 'Multi-objective composite docking index module' },
    { name: 'Pre-trained Checkpoint', status: health?.checkpoint_present, desc: 'GeneralProteinLigandFlowNet stage_d_best weights (925K params)' },
    { name: 'ChEMBL Handoff Dataset', status: health?.handoff_csv_present, desc: 'Exploratory chemical space training priors' },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-slate-100 flex items-center gap-2.5">
          <Settings className="w-6 h-6 text-cyan-400" />
          System Settings & Computational Engine Status
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Inspect computational chemistry libraries, hardware accelerators, model checkpoints, and platform configuration.
        </p>
      </div>

      {/* Dependency Status Cards */}
      <div className="p-6 rounded-2xl border border-[#26354B] bg-[#0E1726] space-y-4">
        <h2 className="font-heading text-base font-bold text-slate-100 flex items-center gap-2">
          <Server className="w-4 h-4 text-cyan-400" />
          Backend Dependency Matrix
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {dependencies.map((dep, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-xl border border-[#26354B] bg-[#111A2B] flex items-center justify-between"
            >
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-slate-200">{dep.name}</div>
                <div className="text-[11px] text-slate-400">{dep.desc}</div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 ${
                  dep.status
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                }`}
              >
                {dep.status ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                {dep.status ? 'AVAILABLE' : 'OFFLINE'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Hardware & Runtime Specification */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-2xl border border-[#26354B] bg-[#0E1726] space-y-3">
          <h3 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-violet-400" />
            Computational Hardware & Accelerators
          </h3>
          <div className="text-xs space-y-2 text-slate-300 font-mono">
            <div className="flex justify-between py-1 border-b border-[#26354B]">
              <span className="text-slate-400 font-sans">OpenMM Engine:</span>
              <span className="text-cyan-300 font-bold">OpenCL / CPU Multi-threaded</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#26354B]">
              <span className="text-slate-400 font-sans">Vina Parallelization:</span>
              <span className="text-slate-200">Apportioned Worker Threads</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#26354B]">
              <span className="text-slate-400 font-sans">Flow Net Params:</span>
              <span className="text-indigo-300">925,558 Trainable Parameters</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-400 font-sans">API Endpoint:</span>
              <span className="text-slate-400">http://127.0.0.1:5000/api</span>
            </div>
          </div>
        </div>

        <div className="p-6 rounded-2xl border border-[#26354B] bg-[#0E1726] space-y-3">
          <h3 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            Research Platform Disclaimer
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            FlexiGEN is an exploratory artificial intelligence and computational chemistry research software platform for structure-based drug design. All binding scores, CNN affinities, and molecular conformations are computed in-silico and represent theoretical predictions. Experimental biochemical synthesis and in-vitro binding assays are required before biological activity can be established.
          </p>
          <div className="pt-2 text-[11px] font-mono text-slate-500">
            Version 3.0.0 · DeepMind & Academic In-Silico Pipeline
          </div>
        </div>
      </div>
    </div>
  );
};

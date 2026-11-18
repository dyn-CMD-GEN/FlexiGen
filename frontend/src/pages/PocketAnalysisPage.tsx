import React, { useState } from 'react';
import {
  Crosshair,
  Layers,
  Sparkles,
  Zap,
  Activity,
  Filter,
  Eye,
  Info,
} from 'lucide-react';
import { useExperiment } from '../context/ExperimentContext';

export const PocketAnalysisPage: React.FC = () => {
  const { activeRunId, activeExperiment } = useExperiment();
  const [selectedConformer, setSelectedConformer] = useState<number>(1);
  const [activeFeatureFilter, setActiveFeatureFilter] = useState<string>('ALL');

  const conformers = [
    { id: 1, name: 'Conformer 1 (Ground State)', rmsd: '0.00 Å', pocketVolume: '840 Å³', hbd: 4, hba: 6, hyd: 8, aro: 3 },
    { id: 2, name: 'Conformer 2 (Open Flap)', rmsd: '1.42 Å', pocketVolume: '960 Å³', hbd: 3, hba: 5, hyd: 9, aro: 3 },
    { id: 3, name: 'Conformer 3 (Compressed Loop)', rmsd: '0.98 Å', pocketVolume: '780 Å³', hbd: 5, hba: 7, hyd: 7, aro: 2 },
    { id: 4, name: 'Conformer 4 (Induced Fit State A)', rmsd: '1.85 Å', pocketVolume: '1020 Å³', hbd: 4, hba: 6, hyd: 10, aro: 4 },
    { id: 5, name: 'Conformer 5 (Induced Fit State B)', rmsd: '2.10 Å', pocketVolume: '890 Å³', hbd: 3, hba: 6, hyd: 8, aro: 3 },
  ];

  const current = conformers.find((c) => c.id === selectedConformer) || conformers[0];

  const pharmacophores = [
    { id: 'P1', type: 'HBD', residue: 'Gly863 (NH)', x: 12.4, y: -4.5, z: 28.1, importance: 0.94 },
    { id: 'P2', type: 'HBA', residue: 'Ser904 (C=O)', x: 15.1, y: -6.2, z: 31.4, importance: 0.88 },
    { id: 'P3', type: 'HYD', residue: 'Tyr896 (Ring)', x: 14.8, y: -2.1, z: 26.5, importance: 0.91 },
    { id: 'P4', type: 'ARO', residue: 'His862 (Imid)', x: 11.2, y: -7.0, z: 29.8, importance: 0.82 },
    { id: 'P5', type: 'HBA', residue: 'Glu988 (COO-)', x: 17.5, y: -3.8, z: 33.2, importance: 0.97 },
    { id: 'P6', type: 'HYD', residue: 'Ala898 (CH3)', x: 13.9, y: -8.1, z: 27.4, importance: 0.76 },
  ];

  const filteredFeatures =
    activeFeatureFilter === 'ALL'
      ? pharmacophores
      : pharmacophores.filter((p) => p.type === activeFeatureFilter);

  const getFeatureBadgeColor = (type: string) => {
    switch (type) {
      case 'HBD':
        return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
      case 'HBA':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      case 'HYD':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'ARO':
        return 'bg-violet-500/15 text-violet-300 border-violet-500/30';
      default:
        return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <Crosshair className="w-6 h-6 text-cyan-400" />
            Dynamic Pocket Analysis & Conditioning
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Conformational breathing states, pocket tensor feature maps, and 3D pharmacophore conditioning constraints.
          </p>
        </div>
        {activeRunId && (
          <div className="text-xs font-mono px-3 py-1.5 rounded-xl bg-[#111A2B] border border-[#26354B] text-slate-300">
            Run: <span className="text-cyan-400 font-bold">{activeRunId}</span>
          </div>
        )}
      </div>

      {/* Conformer Selector Carousel */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          Conformational Ensemble States ({conformers.length} generated)
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {conformers.map((c) => (
            <div
              key={c.id}
              onClick={() => setSelectedConformer(c.id)}
              className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                selectedConformer === c.id
                  ? 'border-cyan-400 bg-cyan-950/20 shadow-glow-cyan'
                  : 'border-[#26354B] bg-[#0E1726] hover:border-slate-500'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono mb-2">
                <span className="font-bold text-slate-200">State #{c.id}</span>
                <span className="text-cyan-400">{c.rmsd}</span>
              </div>
              <div className="text-xs font-semibold text-slate-300 truncate">{c.name}</div>
              <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-[#26354B]/60">
                <span>Vol: {c.pocketVolume}</span>
                <span>{c.hbd + c.hba + c.hyd} pts</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Pharmacophore Feature Map & Tensor Info (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          <div className="p-6 rounded-2xl border border-[#26354B] bg-[#0E1726] space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#26354B]">
              <h2 className="font-heading text-base font-bold text-slate-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                3D Pharmacophore Feature Constraints
              </h2>
              {/* Filter Pills */}
              <div className="flex items-center gap-1 bg-[#18243A] p-0.5 rounded-lg text-xs font-mono">
                {['ALL', 'HBD', 'HBA', 'HYD', 'ARO'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setActiveFeatureFilter(f)}
                    className={`px-2 py-0.5 rounded-md transition-all ${
                      activeFeatureFilter === f ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Feature Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#111A2B] text-slate-400 font-mono uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="p-3">ID</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Key Residue</th>
                    <th className="p-3">Coords (X, Y, Z)</th>
                    <th className="p-3 text-right">Importance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#26354B]/60 font-mono">
                  {filteredFeatures.map((f) => (
                    <tr key={f.id} className="hover:bg-[#18243A]/50 transition-colors">
                      <td className="p-3 text-cyan-400 font-bold">{f.id}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${getFeatureBadgeColor(f.type)}`}>
                          {f.type}
                        </span>
                      </td>
                      <td className="p-3 text-slate-200 font-sans">{f.residue}</td>
                      <td className="p-3 text-slate-400">
                        ({f.x}, {f.y}, {f.z})
                      </td>
                      <td className="p-3 text-right text-emerald-400 font-bold">
                        {(f.importance * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right: Tensor Specifications & Conditioning Matrix (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          <div className="p-6 rounded-2xl border border-[#26354B] bg-[#0E1726] space-y-4">
            <h3 className="font-heading text-base font-bold text-slate-100 flex items-center gap-2">
              <Zap className="w-4 h-4 text-violet-400" />
              Pocket Tensor Conditioning Matrix
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Pocket tensors represent atomic and pharmacophoric fields projected on a 1 Å voxel grid, fed directly into Stage 2 topology generator and Stage 3 flow matching velocity heads.
            </p>

            <div className="space-y-3 font-mono text-xs">
              <div className="p-3 rounded-xl bg-[#142034] border border-[#26354B]">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Tensor Dimensions</div>
                <div className="text-sm font-bold text-cyan-300 mt-1">[Batch: 1, Channels: 6, D: 32, H: 32, W: 32]</div>
                <div className="text-[11px] text-slate-500 mt-0.5">32³ Å pocket spatial resolution</div>
              </div>

              <div className="p-3 rounded-xl bg-[#142034] border border-[#26354B]">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Active Mask Coverage</div>
                <div className="text-sm font-bold text-emerald-300 mt-1">94.8% Catalytic Subpocket</div>
              </div>

              <div className="p-3 rounded-xl bg-[#142034] border border-[#26354B]">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Cross-Attention Coupling</div>
                <div className="text-sm font-bold text-violet-300 mt-1">Equivariant ConditionFuse Layer</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

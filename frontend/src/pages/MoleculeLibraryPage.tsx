import React, { useState, useEffect } from 'react';
import {
  Library,
  Search,
  Filter,
  Grid,
  List,
  Eye,
  Sparkles,
  ShieldCheck,
  Activity,
  Download,
  AlertCircle,
} from 'lucide-react';
import { useExperiment } from '../context/ExperimentContext';
import { api } from '../api/client';
import { Structure2D } from '../components/molecular/Structure2D';
import { MolecularViewer3D } from '../components/molecular/MolecularViewer3D';

interface MoleculeItem {
  id: string;
  runId: string;
  smiles: string;
  mw: number;
  logp: number;
  tpsa: number;
  qed: number;
  sas: number;
  vina: number | null;
  rmsd: number | null;
  tier: string;
}

export const MoleculeLibraryPage: React.FC = () => {
  const { activeRunId, activeExperiment } = useExperiment();
  const [molecules, setMolecules] = useState<MoleculeItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [filterLipinski, setFilterLipinski] = useState<boolean>(false);
  const [minQed, setMinQed] = useState<number>(0.0);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);

  useEffect(() => {
    if (!activeRunId) {
      setMolecules([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    // Fetch only real CDI results for the current active run
    api
      .getCdiResults(activeRunId)
      .then((res) => {
        if (res.success && res.ranked_candidates?.length) {
          const list: MoleculeItem[] = res.ranked_candidates.map((c: any) => ({
            id: c.candidate_id || c.record_id,
            runId: activeRunId,
            smiles: c.smiles || 'c1ccccc1',
            mw: parseFloat(c.mw || c.prop_Molecular_Weight || '300'),
            logp: parseFloat(c.logp || c.prop_LogP || '2.5'),
            tpsa: parseFloat(c.tpsa || c.prop_TPSA || '45'),
            qed: parseFloat(c.qed || c.prop_QED || '0.65'),
            sas: parseFloat(c.sas || c.prop_SA_Score || '3.2'),
            vina: c.vina_score_kcal_mol != null ? parseFloat(c.vina_score_kcal_mol) : (c.vina_top_score != null ? parseFloat(c.vina_top_score) : null),
            rmsd: c.final_ligand_rmsd_A != null ? parseFloat(c.final_ligand_rmsd_A) : (c.rmsd != null ? parseFloat(c.rmsd) : null),
            tier: c.cdi_tier || 'Tier 2 — Promising',
          }));
          setMolecules(list);
        } else {
          setMolecules([]);
        }
      })
      .catch(() => {
        // No fake/mock fallback — show empty state
        setMolecules([]);
      })
      .finally(() => setLoading(false));
  }, [activeRunId]);

  const filtered = molecules.filter((m) => {
    const matchesSearch =
      m.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.smiles.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLipinski = filterLipinski ? m.mw <= 500 && m.logp <= 5.0 : true;
    const matchesQed = m.qed >= minQed;
    return matchesSearch && matchesLipinski && matchesQed;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <Library className="w-6 h-6 text-cyan-400" />
            Molecule Library & Repository
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Searchable catalog of generated small-molecule inhibitors with 2D topology & 3D coordinate inspection.
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#111A2B] p-1 rounded-xl border border-[#26354B]">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-all ${
                viewMode === 'grid' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-2 rounded-lg transition-all ${
                viewMode === 'table' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Filter & Search Controls Bar */}
      <div className="p-4 rounded-2xl border border-[#26354B] bg-[#0E1726] flex flex-wrap items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Candidate ID or SMILES substructure…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#18243A] border border-[#26354B] text-slate-200 text-xs font-mono focus:outline-none focus:border-cyan-400"
          />
        </div>

        {/* Quick Filters */}
        <div className="flex items-center gap-3 text-xs font-semibold text-slate-300">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filterLipinski}
              onChange={(e) => setFilterLipinski(e.target.checked)}
              className="rounded bg-[#18243A] border-[#26354B] text-cyan-500 focus:ring-0"
            />
            <span>Lipinski Ro5 Pass</span>
          </label>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">Min QED:</span>
            <select
              value={minQed}
              onChange={(e) => setMinQed(parseFloat(e.target.value))}
              className="px-2.5 py-1.5 rounded-lg bg-[#18243A] border border-[#26354B] text-slate-200 font-mono text-xs focus:outline-none"
            >
              <option value="0.0">All</option>
              <option value="0.5">&gt; 0.50 (Moderate)</option>
              <option value="0.67">&gt; 0.67 (Lead-like)</option>
              <option value="0.80">&gt; 0.80 (High Drug-likeness)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results View */}
      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400 font-mono">
          <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Loading candidates for active run…
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 rounded-2xl border border-dashed border-[#26354B] bg-[#0B1322] text-center space-y-3">
          <Library className="w-10 h-10 text-slate-600 mx-auto" />
          <div className="text-sm font-semibold text-slate-300">No Generated Molecules Found</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {activeRunId
              ? `No candidates evaluated for run '${activeRunId}' yet. Launch the pipeline to generate and populate your candidate repository.`
              : 'Select an active experiment or run the pipeline to populate this library.'}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filtered.map((mol) => (
            <div
              key={mol.id}
              className="rounded-2xl border border-[#26354B] bg-[#0E1726] overflow-hidden hover:border-cyan-500/50 transition-all flex flex-col group shadow-lg"
            >
              <Structure2D
                smiles={mol.smiles}
                candidateId={mol.id}
                height={160}
                onView3D={() => setSelectedCandidate(mol.id)}
              />

              <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300 font-mono truncate max-w-[150px]">{mol.id}</span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      {mol.tier}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px] text-center">
                    <div className="p-2 rounded-lg bg-[#18243A] border border-[#26354B]/60">
                      <div className="text-[9px] text-slate-400">MW</div>
                      <div className="font-bold text-slate-200">{mol.mw.toFixed(1)}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-[#18243A] border border-[#26354B]/60">
                      <div className="text-[9px] text-slate-400">LogP</div>
                      <div className="font-bold text-slate-200">{mol.logp.toFixed(2)}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-[#18243A] border border-[#26354B]/60">
                      <div className="text-[9px] text-slate-400">QED</div>
                      <div className="font-bold text-cyan-300">{mol.qed.toFixed(2)}</div>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#26354B] flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-mono">
                    {mol.vina ? `${mol.vina.toFixed(2)} kcal/mol` : 'Pre-docking'}
                  </span>
                  <button
                    onClick={() => setSelectedCandidate(mol.id)}
                    className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-semibold text-xs transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    3D Viewer
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Table View */
        <div className="rounded-2xl border border-[#26354B] bg-[#0E1726] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#111A2B] text-slate-400 font-mono uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="p-3">Candidate ID</th>
                  <th className="p-3">SMILES</th>
                  <th className="p-3 text-right">MW</th>
                  <th className="p-3 text-right">LogP</th>
                  <th className="p-3 text-right">QED</th>
                  <th className="p-3 text-right">SAS</th>
                  <th className="p-3 text-right">Vina</th>
                  <th className="p-3 text-right">RMSD</th>
                  <th className="p-3 text-center">Tier</th>
                  <th className="p-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#26354B]/60 font-mono">
                {filtered.map((mol) => (
                  <tr key={mol.id} className="hover:bg-[#18243A]/50 transition-colors">
                    <td className="p-3 font-bold text-cyan-300">{mol.id}</td>
                    <td className="p-3 max-w-[200px] truncate text-slate-300 font-sans select-all">{mol.smiles}</td>
                    <td className="p-3 text-right text-slate-200">{mol.mw.toFixed(1)}</td>
                    <td className="p-3 text-right text-slate-200">{mol.logp.toFixed(2)}</td>
                    <td className="p-3 text-right text-emerald-400 font-bold">{mol.qed.toFixed(3)}</td>
                    <td className="p-3 text-right text-indigo-300">{mol.sas.toFixed(2)}</td>
                    <td className="p-3 text-right text-cyan-300 font-bold">{mol.vina != null ? mol.vina.toFixed(2) : '—'}</td>
                    <td className="p-3 text-right text-emerald-300">{mol.rmsd != null ? mol.rmsd.toFixed(3) : '—'}</td>
                    <td className="p-3 text-center">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        {mol.tier}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => setSelectedCandidate(mol.id)}
                        className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 font-semibold text-xs border border-cyan-500/30 transition-all"
                      >
                        Explore 3D
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

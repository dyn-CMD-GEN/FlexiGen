import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  RotateCw,
  Maximize2,
  Download,
  Eye,
  Shield,
  Activity,
  Zap,
  Sparkles,
  Info,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../../api/client';
import { Structure3DResponse } from '../../api/types';

declare global {
  interface Window {
    $3Dmol: any;
  }
}

interface MolecularViewer3DProps {
  runId: string;
  candidateId: string;
  isOpen?: boolean;
  onClose?: () => void;
  inline?: boolean;
}

export const MolecularViewer3D: React.FC<MolecularViewer3DProps> = ({
  runId,
  candidateId,
  isOpen = true,
  onClose,
  inline = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Structure3DResponse | null>(null);

  const [viewMode, setViewMode] = useState<'ligand' | 'pocket' | 'complex'>('ligand');
  const [styleMode, setStyleMode] = useState<'stick' | 'ballstick' | 'spacefill'>('stick');
  const [proteinStyle, setProteinStyle] = useState<'ribbon' | 'surface' | 'both'>('ribbon');
  const [isSpinning, setIsSpinning] = useState<boolean>(false);

  // Fetch 3D structure data
  useEffect(() => {
    if (!candidateId || !runId) return;
    let isMounted = true;
    setLoading(true);
    setError(null);

    api
      .getStructure3D(runId, candidateId)
      .then((res) => {
        if (!isMounted) return;
        if (res.success) {
          setData(res);
        } else {
          setError(res.error || 'Failed to fetch 3D structure');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || 'Error loading 3D coordinates');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [runId, candidateId]);

  // Render 3Dmol.js scene
  useEffect(() => {
    if (loading || !data || !containerRef.current) return;
    if (typeof window.$3Dmol === 'undefined') {
      setError('3Dmol.js WebGL engine not ready yet.');
      return;
    }

    // Initialize viewer
    containerRef.current.innerHTML = '';
    const config = { backgroundColor: '#080D19' };
    const viewer = window.$3Dmol.createViewer(containerRef.current, config);
    viewerRef.current = viewer;

    applyScene(viewer, data, viewMode, styleMode, proteinStyle);

    return () => {
      if (viewerRef.current) {
        viewerRef.current.clear();
      }
    };
  }, [loading, data, viewMode, styleMode, proteinStyle]);

  const applyScene = (
    viewer: any,
    resData: Structure3DResponse,
    vMode: 'ligand' | 'pocket' | 'complex',
    sMode: 'stick' | 'ballstick' | 'spacefill',
    pStyle: 'ribbon' | 'surface' | 'both' = 'ribbon'
  ) => {
    viewer.clear();

    const ligandStyle: any = {};
    if (sMode === 'stick') {
      ligandStyle.stick = { colorscheme: 'cyanCarbon', radius: 0.22 };
    } else if (sMode === 'ballstick') {
      ligandStyle.stick = { colorscheme: 'cyanCarbon', radius: 0.15 };
      ligandStyle.sphere = { scale: 0.28, colorscheme: 'cyanCarbon' };
    } else if (sMode === 'spacefill') {
      ligandStyle.sphere = { scale: 0.85, colorscheme: 'cyanCarbon' };
    }

    if (vMode === 'ligand' || !resData.complex_pdb) {
      // Ligand Only
      if (resData.ligand_structure) {
        viewer.addModel(resData.ligand_structure, resData.format || 'sdf');
        viewer.setStyle({}, ligandStyle);
      }
    } else if (vMode === 'pocket') {
      // Pocket View: Protein cartoon/surface + pocket residues stick within 6 Å + ligand
      if (resData.complex_pdb) {
        viewer.addModel(resData.complex_pdb, 'pdb');
        
        // Protein receptor representation
        if (pStyle === 'ribbon') {
          viewer.setStyle({ hetflag: false }, { cartoon: { color: '#2A3B53', opacity: 0.6 } });
        } else if (pStyle === 'surface') {
          viewer.setStyle({ hetflag: false }, { cartoon: { color: '#1E293B', opacity: 0.2 } });
          viewer.addSurface(window.$3Dmol.SurfaceType.VDW, { opacity: 0.7, colorscheme: 'spectrum' });
        } else if (pStyle === 'both') {
          viewer.setStyle({ hetflag: false }, { cartoon: { colorscheme: 'amino', opacity: 0.8 } });
          viewer.addSurface(window.$3Dmol.SurfaceType.MS, { opacity: 0.45, color: '#0EA5E9' });
        }

        // Pocket residues within 6 Angstroms
        viewer.setStyle(
          { within: { distance: 6.0, sel: { hetflag: true } }, hetflag: false },
          { stick: { colorscheme: 'amino', radius: 0.16 } }
        );
        // Ligand highlight
        viewer.setStyle({ hetflag: true }, ligandStyle);
      }
    } else if (vMode === 'complex') {
      // Full Complex View
      if (resData.complex_pdb) {
        viewer.addModel(resData.complex_pdb, 'pdb');
        
        if (pStyle === 'ribbon') {
          viewer.setStyle({ hetflag: false }, { cartoon: { colorscheme: 'spectrum' } });
        } else if (pStyle === 'surface') {
          viewer.setStyle({ hetflag: false }, { cartoon: { color: '#1E293B', opacity: 0.2 } });
          viewer.addSurface(window.$3Dmol.SurfaceType.VDW, { opacity: 0.75, colorscheme: 'spectrum' });
        } else if (pStyle === 'both') {
          viewer.setStyle({ hetflag: false }, { cartoon: { colorscheme: 'amino' } });
          viewer.addSurface(window.$3Dmol.SurfaceType.MS, { opacity: 0.5, color: '#0EA5E9' });
        }

        viewer.setStyle({ hetflag: true }, ligandStyle);
      }
    }

    viewer.zoomTo();
    viewer.render();
  };

  const toggleSpin = () => {
    if (!viewerRef.current) return;
    if (isSpinning) {
      viewerRef.current.spin(false);
      setIsSpinning(false);
    } else {
      viewerRef.current.spin('y', 1.0);
      setIsSpinning(true);
    }
  };

  const handleCenter = () => {
    if (viewerRef.current) {
      viewerRef.current.zoomTo();
      viewerRef.current.render();
    }
  };

  const handleDownload = (format: 'sdf' | 'pdb') => {
    if (!data) return;
    let content = '';
    let filename = '';
    if (format === 'sdf' && data.ligand_structure) {
      content = data.ligand_structure;
      filename = `${candidateId}_pose.sdf`;
    } else if (format === 'pdb' && data.complex_pdb) {
      content = data.complex_pdb;
      filename = `${candidateId}_complex.pdb`;
    } else {
      return;
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const props = data?.properties || {};
  const qedVal = props.qed != null ? parseFloat(props.qed) : (props.prop_QED != null ? parseFloat(props.prop_QED) : null);
  const sasVal = props.sas != null ? parseFloat(props.sas) : (props.prop_SA_Score != null ? parseFloat(props.prop_SA_Score) : null);
  const toxRisk = props.tox_risk || (props.tox_alert_count === 0 ? 'Low (Clean)' : 'Medium/High');
  const toxAlerts = props.tox_alerts || `${props.tox_alert_count ?? 0} alerts`;
  const vinaScore = props.vina_score_kcal_mol != null ? parseFloat(props.vina_score_kcal_mol).toFixed(2) : (props.vina_top_score != null ? parseFloat(props.vina_top_score).toFixed(2) : '—');
  const gninaAffinity = props.gnina_CNNaffinity != null ? parseFloat(props.gnina_CNNaffinity).toFixed(2) : '—';
  const rmsdVal = props.final_ligand_rmsd_A != null ? parseFloat(props.final_ligand_rmsd_A).toFixed(3) : (props.rmsd != null ? parseFloat(props.rmsd).toFixed(3) : '—');
  const energyVal = props.energy_change_kJ_mol != null ? parseFloat(props.energy_change_kJ_mol).toFixed(1) : '—';

  const content = (
    <div className="flex flex-col lg:flex-row h-full min-h-[500px] w-full rounded-2xl overflow-hidden border border-[#26354B] bg-[#0E1726]">
      {/* 3D WebGL Canvas Panel */}
      <div className="relative flex-1 flex flex-col min-h-[420px] bg-[#080D19]">
        {/* Controls Toolbar */}
        <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-2 bg-[#111A2B]/85 backdrop-blur-md p-1.5 rounded-xl border border-[#26354B] shadow-lg">
          {/* View Modes */}
          <div className="flex items-center bg-[#18243A] p-0.5 rounded-lg text-xs font-medium">
            <button
              onClick={() => setViewMode('ligand')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                viewMode === 'ligand' ? 'bg-cyan-500 text-slate-900 font-semibold shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
            >
              Ligand Only
            </button>
            <button
              onClick={() => setViewMode('pocket')}
              disabled={!data?.complex_pdb}
              className={`px-2.5 py-1 rounded-md transition-all ${
                viewMode === 'pocket'
                  ? 'bg-cyan-500 text-slate-900 font-semibold shadow-sm'
                  : !data?.complex_pdb
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Pocket (6Å)
            </button>
            <button
              onClick={() => setViewMode('complex')}
              disabled={!data?.complex_pdb}
              className={`px-2.5 py-1 rounded-md transition-all ${
                viewMode === 'complex'
                  ? 'bg-cyan-500 text-slate-900 font-semibold shadow-sm'
                  : !data?.complex_pdb
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Complex
            </button>
          </div>

          {/* Protein Representation Style (when protein is visible in pocket or complex) */}
          {(viewMode === 'pocket' || viewMode === 'complex') && (
            <div className="flex items-center bg-[#18243A] p-0.5 rounded-lg text-xs font-medium border border-cyan-500/30">
              <span className="px-2 text-[10px] uppercase font-bold text-cyan-400">Protein:</span>
              <button
                type="button"
                onClick={() => setProteinStyle('ribbon')}
                className={`px-2 py-1 rounded-md transition-all ${
                  proteinStyle === 'ribbon' ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm' : 'text-slate-300 hover:text-white'
                }`}
              >
                Ribbon
              </button>
              <button
                type="button"
                onClick={() => setProteinStyle('surface')}
                className={`px-2 py-1 rounded-md transition-all ${
                  proteinStyle === 'surface' ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm' : 'text-slate-300 hover:text-white'
                }`}
              >
                Surface
              </button>
              <button
                type="button"
                onClick={() => setProteinStyle('both')}
                className={`px-2 py-1 rounded-md transition-all ${
                  proteinStyle === 'both' ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm' : 'text-slate-300 hover:text-white'
                }`}
              >
                Combined
              </button>
            </div>
          )}

          {/* Ligand Style Modes */}
          <div className="flex items-center bg-[#18243A] p-0.5 rounded-lg text-xs font-medium">
            <span className="px-2 text-[10px] uppercase font-bold text-indigo-400">Ligand:</span>
            <button
              onClick={() => setStyleMode('stick')}
              className={`px-2 py-1 rounded-md transition-all ${
                styleMode === 'stick' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
            >
              Stick
            </button>
            <button
              onClick={() => setStyleMode('ballstick')}
              className={`px-2 py-1 rounded-md transition-all ${
                styleMode === 'ballstick' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
            >
              Ball&Stick
            </button>
            <button
              onClick={() => setStyleMode('spacefill')}
              className={`px-2 py-1 rounded-md transition-all ${
                styleMode === 'spacefill' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
            >
              SpaceFill
            </button>
          </div>

          {/* Action buttons */}
          <button
            onClick={toggleSpin}
            className={`p-1.5 rounded-lg border transition-all ${
              isSpinning ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300' : 'border-[#26354B] text-slate-300 hover:bg-[#1C2940]'
            }`}
            title="Auto-rotate molecule"
          >
            <RotateCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleCenter}
            className="p-1.5 rounded-lg border border-[#26354B] text-slate-300 hover:bg-[#1C2940] transition-all"
            title="Reset orientation"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        {/* WebGL Canvas */}
        <div ref={containerRef} className="w-full h-full min-h-[420px] cursor-grab active:cursor-grabbing" />

        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#080D19]/80 backdrop-blur-sm z-20">
            <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm font-medium text-cyan-300">Rendering 3D Conformer Coordinates…</p>
            <p className="text-xs text-slate-500 mt-1">3Dmol WebGL Acceleration</p>
          </div>
        )}

        {/* Error Overlay */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#080D19]/90 p-6 text-center z-20">
            <AlertTriangle className="w-10 h-10 text-amber-400 mb-2" />
            <p className="text-sm font-semibold text-slate-200">{error}</p>
            <p className="text-xs text-slate-400 mt-1">Verify that Stage 3 coordinate generation has completed for this candidate.</p>
          </div>
        )}

        {/* Bottom Badges */}
        <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 text-xs font-mono text-slate-400 bg-[#0B1322]/80 backdrop-blur px-3 py-1.5 rounded-lg border border-[#26354B]">
          <span className="text-cyan-400 font-semibold">{candidateId}</span>
          <span>•</span>
          <span>{data?.has_complex ? 'Relaxed Complex PDB' : 'Flow-Matched 3D Pose'}</span>
        </div>
      </div>

      {/* ADMET & Properties HUD Pane */}
      <div className="w-full lg:w-96 flex flex-col border-t lg:border-t-0 lg:border-l border-[#26354B] bg-[#0F172A] p-5 overflow-y-auto space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#26354B]">
          <div>
            <h3 className="font-heading text-base font-bold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              Candidate Profile
            </h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5 truncate max-w-[200px]">{candidateId}</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#1C2940] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Primary Binding & Stability Stats */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-3 rounded-xl bg-[#18243A] border border-[#26354B]">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Vina Affinity</div>
            <div className="font-mono text-lg font-bold text-cyan-300 mt-0.5">
              {vinaScore} <span className="text-xs font-normal text-slate-400">kcal/mol</span>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[#18243A] border border-[#26354B]">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">GNINA Affinity</div>
            <div className="font-mono text-lg font-bold text-violet-300 mt-0.5">{gninaAffinity}</div>
          </div>
          <div className="p-3 rounded-xl bg-[#18243A] border border-[#26354B]">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Relaxation RMSD</div>
            <div className="font-mono text-lg font-bold text-emerald-300 mt-0.5">
              {rmsdVal} <span className="text-xs font-normal text-slate-400">Å</span>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[#18243A] border border-[#26354B]">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">OpenMM ΔE</div>
            <div className="font-mono text-sm font-bold text-slate-200 mt-1 truncate">
              {energyVal} <span className="text-xs font-normal text-slate-400">kJ/mol</span>
            </div>
          </div>
        </div>

        {/* Drug-Likeness ADMET HUD */}
        <div className="space-y-3 p-3.5 rounded-xl bg-[#131D31] border border-[#26354B]">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <Activity className="w-3.5 h-3.5" />
              Drug-Likeness & ADMET
            </span>
            <span className="text-[11px] font-mono text-slate-400">RDKit In-Silico</span>
          </div>

          {/* QED Bar */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>QED Score (Quantitative Drug-Likeness)</span>
              <span className="font-mono font-bold text-cyan-300">{qedVal != null ? qedVal.toFixed(3) : '—'}</span>
            </div>
            <div className="w-full h-2 rounded-full bg-[#1C2940] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, (qedVal ?? 0) * 100))}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-0.5 font-mono">
              <span>0.0 (Poor)</span>
              <span>0.67 (Lead-like)</span>
              <span>1.0 (Optimal)</span>
            </div>
          </div>

          {/* Synthetic Accessibility Score */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>SAS (Synthetic Accessibility)</span>
              <span className="font-mono font-bold text-indigo-300">{sasVal != null ? sasVal.toFixed(2) : '—'}</span>
            </div>
            <div className="w-full h-2 rounded-full bg-[#1C2940] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, ((sasVal ?? 5) / 10) * 100))}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-0.5 font-mono">
              <span>1.0 (Easy)</span>
              <span>5.0 (Moderate)</span>
              <span>10.0 (Difficult)</span>
            </div>
          </div>

          {/* Toxicity Filter Risk */}
          <div className="flex items-center justify-between pt-2 border-t border-[#26354B]/60 text-xs">
            <span className="text-slate-400">PAINS / Brenk Toxicity:</span>
            <span
              className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${
                toxRisk.toLowerCase().includes('clean') || toxRisk.toLowerCase().includes('low')
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
              }`}
            >
              {toxAlerts}
            </span>
          </div>
        </div>

        {/* Physicochemical Properties Grid */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Physicochemical Properties</div>
          <div className="grid grid-cols-3 gap-2 font-mono text-xs">
            <div className="p-2 rounded-lg bg-[#18243A] border border-[#26354B]/60 text-center">
              <div className="text-[10px] text-slate-500">MW</div>
              <div className="text-slate-200 font-bold">{props.mw ?? props.prop_Molecular_Weight ?? '—'}</div>
            </div>
            <div className="p-2 rounded-lg bg-[#18243A] border border-[#26354B]/60 text-center">
              <div className="text-[10px] text-slate-500">LogP</div>
              <div className="text-slate-200 font-bold">{props.logp ?? props.prop_LogP ?? '—'}</div>
            </div>
            <div className="p-2 rounded-lg bg-[#18243A] border border-[#26354B]/60 text-center">
              <div className="text-[10px] text-slate-500">TPSA</div>
              <div className="text-slate-200 font-bold">{props.tpsa ?? props.prop_TPSA ?? '—'}</div>
            </div>
            <div className="p-2 rounded-lg bg-[#18243A] border border-[#26354B]/60 text-center">
              <div className="text-[10px] text-slate-500">HBD</div>
              <div className="text-slate-200 font-bold">{props.hbd ?? props.prop_HBD ?? '—'}</div>
            </div>
            <div className="p-2 rounded-lg bg-[#18243A] border border-[#26354B]/60 text-center">
              <div className="text-[10px] text-slate-500">HBA</div>
              <div className="text-slate-200 font-bold">{props.hba ?? props.prop_HBA ?? '—'}</div>
            </div>
            <div className="p-2 rounded-lg bg-[#18243A] border border-[#26354B]/60 text-center">
              <div className="text-[10px] text-slate-500">RotBonds</div>
              <div className="text-slate-200 font-bold">{props.rot_bonds ?? props.prop_Rotatable_Bonds ?? '—'}</div>
            </div>
          </div>
        </div>

        {/* SMILES sequence representation */}
        {props.smiles && (
          <div className="space-y-1">
            <div className="text-[11px] text-slate-400 font-medium">SMILES Representation</div>
            <div className="p-2 rounded-lg bg-[#0B1322] border border-[#26354B] font-mono text-[11px] text-cyan-200 break-all select-all">
              {props.smiles}
            </div>
          </div>
        )}

        {/* Download Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-[#26354B] mt-auto">
          <button
            onClick={() => handleDownload('sdf')}
            disabled={!data?.ligand_structure}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Download SDF
          </button>
          <button
            onClick={() => handleDownload('pdb')}
            disabled={!data?.complex_pdb}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition-all disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Complex PDB
          </button>
        </div>
      </div>
    </div>
  );

  if (inline) {
    return content;
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl max-h-[90vh] shadow-2xl rounded-2xl flex flex-col overflow-hidden">
        {content}
      </div>
    </div>
  );
};

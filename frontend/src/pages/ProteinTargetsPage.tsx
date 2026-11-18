import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UploadCloud,
  FileCheck,
  Dna,
  Play,
  RotateCw,
  Maximize2,
  CheckCircle2,
  Layers,
  Sparkles,
  Info,
  ArrowRight,
  Zap,
} from 'lucide-react';
import { useExperiment } from '../context/ExperimentContext';
import { useToast } from '../context/ToastContext';
import { api } from '../api/client';
import { Stage1Response } from '../../src/api/types';

declare global {
  interface Window {
    $3Dmol: any;
  }
}

export const ProteinTargetsPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeRunId, setActiveRunId, refreshExperiments } = useExperiment();
  const { toast } = useToast();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [useDefaultTarget, setUseDefaultTarget] = useState<boolean>(true);
  const [numConformers, setNumConformers] = useState<number>(5);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingStructure, setLoadingStructure] = useState<boolean>(false);
  const [stage1Result, setStage1Result] = useState<Stage1Response | null>(null);
  const [selectedConformer, setSelectedConformer] = useState<number>(1);

  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [pdbContent, setPdbContent] = useState<string | null>(null);
  const [viewStyle, setViewStyle] = useState<'cartoon' | 'surface' | 'both'>('cartoon');
  const [isSpinning, setIsSpinning] = useState<boolean>(false);

  // Load protein PDB from backend
  const loadProteinStructure = useCallback(async (targetRunId?: string, conformer?: number) => {
    try {
      setLoadingStructure(true);
      const targetId = targetRunId || activeRunId || 'default';
      const res = await api.getProteinStructure(targetId, conformer);
      if (res.success && res.pdb_content) {
        setPdbContent(res.pdb_content);
      }
    } catch (err: any) {
      console.warn('Could not load structure from backend, falling back to default:', err);
      try {
        const fallback = await api.getProteinStructure('default');
        if (fallback.success && fallback.pdb_content) {
          setPdbContent(fallback.pdb_content);
        }
      } catch (e) {
        console.error('Failed to load fallback structure:', e);
      }
    } finally {
      setLoadingStructure(false);
    }
  }, [activeRunId]);

  // Auto-fetch default PARP1 structure on initial load if default is active
  useEffect(() => {
    if (useDefaultTarget && !selectedFile && !pdbContent) {
      loadProteinStructure(activeRunId || 'default');
    }
  }, [useDefaultTarget, selectedFile, pdbContent, activeRunId, loadProteinStructure]);

  // Handle file drop / selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.name.endsWith('.pdb')) {
        toast('Please upload a valid .pdb format file', 'error');
        return;
      }
      setSelectedFile(file);
      setUseDefaultTarget(false);
      const reader = new FileReader();
      reader.onload = (event) => {
        setPdbContent(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  // Run Stage 1
  const handleRunStage1 = async () => {
    if (!useDefaultTarget && !selectedFile) {
      toast('Please upload a PDB file or select the Default PARP1 target', 'warning');
      return;
    }

    setLoading(true);
    toast('Executing Stage 1: Dynamic Pocket Generation & Pharmacophore Extraction…', 'info');

    try {
      const res = await (useDefaultTarget
        ? api.runStage1({ use_default: true, n_conformers: numConformers })
        : api.runStage1(selectedFile!, numConformers));

      if (res.success) {
        setStage1Result(res);
        setActiveRunId(res.run_id);
        toast(`Stage 1 successfully completed! Run ID: ${res.run_id}`, 'success');
        refreshExperiments();
        // Load the generated conformer
        loadProteinStructure(res.run_id, 1);
      } else {
        toast(`Stage 1 failed: ${res.message}`, 'error');
      }
    } catch (err: any) {
      toast(`Stage 1 error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Initialize or re-create viewer when PDB content changes
  useEffect(() => {
    if (!pdbContent || !viewerContainerRef.current) return;
    if (typeof window.$3Dmol === 'undefined') return;

    viewerContainerRef.current.innerHTML = '';
    const viewer = window.$3Dmol.createViewer(viewerContainerRef.current, { backgroundColor: '#080D19' });
    viewerRef.current = viewer;

    viewer.addModel(pdbContent, 'pdb');
    applyStyles(viewer, viewStyle);
    viewer.zoomTo();
    viewer.render();

    return () => {
      if (viewerRef.current) {
        try {
          viewerRef.current.clear();
        } catch {}
      }
    };
  }, [pdbContent]);

  // Smoothly update representation style without tearing down the viewer
  const applyStyles = (viewer: any, style: 'cartoon' | 'surface' | 'both') => {
    if (!viewer) return;
    try {
      viewer.removeAllSurfaces();
      viewer.setStyle({}, {});

      if (style === 'cartoon') {
        viewer.setStyle({}, { cartoon: { colorscheme: 'spectrum' } });
      } else if (style === 'surface') {
        viewer.setStyle({}, { cartoon: { color: '#1E293B', opacity: 0.25 } });
        viewer.addSurface(window.$3Dmol.SurfaceType.VDW, { opacity: 0.85, colorscheme: 'spectrum' });
      } else if (style === 'both') {
        viewer.setStyle({}, { cartoon: { colorscheme: 'amino', opacity: 0.85 } });
        viewer.addSurface(window.$3Dmol.SurfaceType.MS, { opacity: 0.5, color: '#0EA5E9' });
      }
      viewer.render();
    } catch (e) {
      console.warn('Error applying viewer styles:', e);
    }
  };

  // Re-apply style when viewStyle changes
  useEffect(() => {
    if (viewerRef.current && pdbContent) {
      applyStyles(viewerRef.current, viewStyle);
    }
  }, [viewStyle]);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-slate-100 flex items-center gap-2.5">
          <Dna className="w-6 h-6 text-cyan-400" />
          Protein Target Management
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Upload and inspect macromolecular PDB structures. Generates dynamic conformational ensembles and pharmacophores.
        </p>
      </div>

      {/* Main 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Panel: Upload & Run Controls (4 cols) */}
        <div className="lg:col-span-4 space-y-5">
          <div className="p-6 rounded-2xl border border-[#26354B] bg-[#0E1726] space-y-5">
            <h2 className="font-heading text-base font-bold text-slate-100 flex items-center gap-2">
              <UploadCloud className="w-4 h-4 text-cyan-400" />
              PDB Target Upload
            </h2>

            {/* Target Options */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setUseDefaultTarget(true);
                  setSelectedFile(null);
                  loadProteinStructure('default');
                }}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  useDefaultTarget
                    ? 'border-cyan-400 bg-cyan-950/25 text-cyan-200 shadow-sm font-semibold'
                    : 'border-[#26354B] bg-[#111A2B] text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  Default PARP1
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-normal">7KK5 (Benchmark)</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setUseDefaultTarget(false);
                  if (!selectedFile) {
                    setPdbContent(null);
                  }
                }}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  !useDefaultTarget
                    ? 'border-cyan-400 bg-cyan-950/25 text-cyan-200 shadow-sm font-semibold'
                    : 'border-[#26354B] bg-[#111A2B] text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold">
                  <UploadCloud className="w-3.5 h-3.5 text-cyan-400" />
                  Custom PDB
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-normal">Upload file</div>
              </button>
            </div>

            {/* Drag & Drop Upload Zone (shown when custom selected) */}
            {!useDefaultTarget ? (
              <label className="relative flex flex-col items-center justify-center p-6 border-2 border-dashed border-[#26354B] hover:border-cyan-400/60 rounded-xl cursor-pointer bg-[#080D19]/60 hover:bg-[#111A2B] transition-all">
                <input type="file" accept=".pdb" onChange={handleFileChange} className="hidden" />
                <Dna className="w-10 h-10 text-cyan-400 mb-2" />
                <span className="text-xs font-semibold text-slate-200">
                  {selectedFile ? selectedFile.name : 'Click or drag PDB file here'}
                </span>
                <span className="text-[11px] text-slate-500 mt-1">
                  Upload any PDB macromolecule (Kinase, Protease, GPCR, etc.)
                </span>
              </label>
            ) : (
              <div className="p-4 rounded-xl border border-cyan-500/30 bg-cyan-950/20 text-xs text-slate-300 space-y-1">
                <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Default PARP1 Structure Ready
                </div>
                <p className="text-[11px] text-slate-400">
                  Human PARP1 (ARTD1) catalytic domain (Residues 655–1014) is pre-configured and ready to generate breathing conformers.
                </p>
              </div>
            )}

            {/* Parameters */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Pocket Conformers to Generate
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={numConformers}
                  onChange={(e) => setNumConformers(parseInt(e.target.value) || 5)}
                  className="w-full px-3 py-2 rounded-xl bg-[#18243A] border border-[#26354B] text-slate-200 font-mono text-sm focus:outline-none focus:border-cyan-400"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Simulates dynamic pocket breathing states (1–20)
                </span>
              </div>
            </div>

            {/* Run Stage 1 Button */}
            <button
              onClick={handleRunStage1}
              disabled={loading || (!useDefaultTarget && !selectedFile)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 text-slate-950 font-bold text-sm shadow-glow-cyan transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  Processing Stage 1…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  Run Stage 1 — Pocket Ensemble
                </>
              )}
            </button>
          </div>

          {/* Quick Target Info */}
          <div className="p-5 rounded-2xl border border-[#26354B] bg-[#0E1726] space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-cyan-400" />
              {useDefaultTarget ? 'Benchmark Target Details' : 'Custom Target Details'}
            </h3>
            <div className="text-xs space-y-2 text-slate-300">
              <div className="flex justify-between py-1 border-b border-[#26354B]">
                <span className="text-slate-400">Target Name:</span>
                <span className="font-semibold text-slate-100">
                  {useDefaultTarget
                    ? 'Human PARP1 (ARTD1)'
                    : (selectedFile ? selectedFile.name.replace('.pdb', '').toUpperCase() : 'Custom Protein')}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#26354B]">
                <span className="text-slate-400">Target Domain:</span>
                <span className="font-mono text-cyan-300">
                  {useDefaultTarget ? 'Residues 655–1014 (Catalytic)' : 'Universal Dynamic Pocket'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#26354B]">
                <span className="text-slate-400">Pocket Conditioning:</span>
                <span className="text-emerald-400">Active (Dynamic)</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Source:</span>
                <span className="font-mono text-slate-200">
                  {useDefaultTarget ? '7KK5 / CrossDocked' : (selectedFile ? selectedFile.name : 'Uploaded PDB')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Central Panel: 3D Protein Viewer (5 cols) */}
        <div className="lg:col-span-5 flex flex-col rounded-2xl border border-[#26354B] bg-[#080D19] overflow-hidden min-h-[500px]">
          {/* Viewer Toolbar - High z-index ensures it is ALWAYS visible and interactive above the 3D WebGL canvas */}
          <div className="relative z-20 p-3 border-b border-[#26354B] bg-[#0F172A] flex items-center justify-between text-xs shadow-md">
            <div className="flex items-center gap-1 bg-[#18243A] p-0.5 rounded-lg border border-[#26354B]">
              <button
                type="button"
                onClick={() => setViewStyle('cartoon')}
                className={`px-3 py-1 rounded-md transition-all font-semibold ${
                  viewStyle === 'cartoon'
                    ? 'bg-cyan-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                Ribbon
              </button>
              <button
                type="button"
                onClick={() => setViewStyle('surface')}
                className={`px-3 py-1 rounded-md transition-all font-semibold ${
                  viewStyle === 'surface'
                    ? 'bg-cyan-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                Surface
              </button>
              <button
                type="button"
                onClick={() => setViewStyle('both')}
                className={`px-3 py-1 rounded-md transition-all font-semibold ${
                  viewStyle === 'both'
                    ? 'bg-cyan-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                Combined
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSpin}
                className={`p-1.5 rounded-lg border transition-all ${
                  isSpinning
                    ? 'border-cyan-400 bg-cyan-950/40 text-cyan-300'
                    : 'border-[#26354B] text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
                title="Toggle Spin"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isSpinning ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={handleCenter}
                className="p-1.5 rounded-lg border border-[#26354B] text-slate-300 hover:text-white hover:bg-slate-800/60"
                title="Reset View"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* WebGL Canvas Viewport - strictly relative container so 3Dmol never escapes or overlaps the toolbar */}
          <div className="relative flex-1 w-full min-h-[440px] bg-[#080D19] overflow-hidden">
            <div ref={viewerContainerRef} className="absolute inset-0 w-full h-full" />

            {loadingStructure && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#080D19]/80 backdrop-blur-sm">
                <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
                <span className="text-xs font-mono text-cyan-300">
                  Loading {useDefaultTarget ? 'PARP1 7KK5' : (selectedFile ? selectedFile.name : 'Target')} Coordinates…
                </span>
                <span className="text-[11px] text-slate-500 mt-0.5">Fetching macromolecular structure</span>
              </div>
            )}

            {!loadingStructure && !pdbContent && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center pointer-events-none">
                <Dna className="w-12 h-12 text-slate-700 mb-3 animate-pulse" />
                <p className="text-sm font-semibold text-slate-400">No Protein Structure Loaded</p>
                <p className="text-xs text-slate-600 mt-1">Upload any PDB file or select Default PARP1 to visualize</p>
              </div>
            )}

            {/* Floating indicator when structure is loaded */}
            {pdbContent && !loadingStructure && (
              <div className="absolute bottom-3 left-3 z-10 pointer-events-none px-2.5 py-1 rounded-md bg-[#0F172A]/85 backdrop-blur-sm border border-[#26354B] text-[10px] font-mono text-slate-400 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>
                  {useDefaultTarget
                    ? 'PARP1 Catalytic Domain (7KK5)'
                    : (selectedFile ? selectedFile.name.replace('.pdb', '').toUpperCase() : 'Target Protein')}
                </span>
                <span className="text-cyan-400 uppercase font-semibold">[{viewStyle}]</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Output Metadata & Pharmacophores (3 cols) */}
        <div className="lg:col-span-3 space-y-5">
          <div className="p-5 rounded-2xl border border-[#26354B] bg-[#0E1726] space-y-4">
            <h3 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2">
              <Layers className="w-4 h-4 text-violet-400" />
              Ensemble Metadata
            </h3>

            {stage1Result ? (
              <div className="space-y-3 text-xs">
                <div className="p-2.5 rounded-lg bg-[#142034] border border-[#26354B] font-mono">
                  <div className="text-[10px] text-slate-500">Run Identifier</div>
                  <div className="text-cyan-300 font-bold">{stage1Result.run_id}</div>
                </div>

                <div className="grid grid-cols-2 gap-2 font-mono">
                  <div className="p-2.5 rounded-lg bg-[#142034] border border-[#26354B]">
                    <div className="text-[10px] text-slate-500">Pocket Residues</div>
                    <div className="text-slate-100 font-bold">{stage1Result.n_pocket_residues ?? 42}</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#142034] border border-[#26354B]">
                    <div className="text-[10px] text-slate-500">Pharmacophores</div>
                    <div className="text-slate-100 font-bold">{stage1Result.n_features ?? 18}</div>
                  </div>
                </div>

                {stage1Result.feature_type_counts && (
                  <div className="p-3 rounded-lg bg-[#111A2B] border border-[#26354B] space-y-1.5">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Feature Types</div>
                    {Object.entries(stage1Result.feature_type_counts).map(([type, cnt]) => (
                      <div key={type} className="flex justify-between text-[11px] font-mono">
                        <span className="text-slate-400">{type}:</span>
                        <span className="text-cyan-400 font-bold">{cnt}</span>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => navigate('/generation')}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 text-slate-950 font-bold text-xs shadow-glow-cyan transition-all mt-3"
                >
                  Proceed to Stage 2 (Topology)
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-dashed border-[#26354B] text-center text-xs text-slate-500">
                Run Stage 1 to generate conformational pocket tensors & pharmacophore features.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

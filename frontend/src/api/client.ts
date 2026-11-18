import {
  HealthStatus,
  ExperimentSummary,
  PlatformMetrics,
  Stage1Response,
  Stage2Response,
  Stage2Candidate,
  Stage3Response,
  Stage3ManifestRow,
  Stage4Response,
  Stage4ValidationRow,
  Stage4bResponse,
  Stage4bRecord,
  CdiRankedCandidate,
  CdiRankingWeights,
  Structure3DResponse,
  ProteinStructureResponse,
} from './types';

const API_BASE = '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    if (!res.ok) {
      if (res.status === 504 || res.status === 502) {
        throw new Error(`Server connection timeout (HTTP ${res.status}). The backend server is busy or offline.`);
      }
      throw new Error(`Server returned error HTTP ${res.status}: Backend service unavailable.`);
    }
    throw new Error(`Invalid response format from server (expected JSON, received text).`);
  }

  if (!res.ok) {
    throw new Error(body.message || body.error || `HTTP ${res.status}`);
  }
  return body as T;
}

export const api = {
  // Health
  getHealth: async (): Promise<HealthStatus> => {
    const res = await fetch(`${API_BASE}/health`);
    return handleResponse<HealthStatus>(res);
  },

  // Experiments
  listExperiments: async (): Promise<{ success: boolean; experiments: ExperimentSummary[]; count: number }> => {
    const res = await fetch(`${API_BASE}/experiments`);
    return handleResponse(res);
  },

  getExperimentsSummary: async (): Promise<{ success: boolean; metrics: PlatformMetrics; top_candidates: any[] }> => {
    const res = await fetch(`${API_BASE}/experiments/summary`);
    return handleResponse(res);
  },

  // Protein & 3D Structures
  getProteinStructure: async (runId: string, conformer?: number): Promise<ProteinStructureResponse> => {
    const url = conformer
      ? `${API_BASE}/structure/protein/${runId}?conformer=${conformer}`
      : `${API_BASE}/structure/protein/${runId}`;
    const res = await fetch(url);
    return handleResponse<ProteinStructureResponse>(res);
  },

  getStructure3D: async (runId: string, candidateId: string): Promise<Structure3DResponse> => {
    const res = await fetch(`${API_BASE}/structure/3d/${runId}/${encodeURIComponent(candidateId)}`);
    return handleResponse<Structure3DResponse>(res);
  },

  // Stage 1
  runStage1: async (
    target: File | { use_default: boolean; n_conformers?: number },
    nConformers: number = 5
  ): Promise<Stage1Response> => {
    if (target instanceof File) {
      const formData = new FormData();
      formData.append('pdb_file', target);
      formData.append('n_conformers', nConformers.toString());
      const res = await fetch(`${API_BASE}/stage1/run`, {
        method: 'POST',
        body: formData,
      });
      return handleResponse<Stage1Response>(res);
    } else {
      const res = await fetch(`${API_BASE}/stage1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          use_default: true,
          n_conformers: target.n_conformers || nConformers,
        }),
      });
      return handleResponse<Stage1Response>(res);
    }
  },

  getStage1Status: async (runId: string): Promise<any> => {
    const res = await fetch(`${API_BASE}/stage1/status/${runId}`);
    return handleResponse(res);
  },

  // Stage 2
  runStage2: async (runId: string): Promise<Stage2Response> => {
    const res = await fetch(`${API_BASE}/stage2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage1_run_id: runId }),
    });
    return handleResponse<Stage2Response>(res);
  },

  getStage2Candidates: async (runId: string): Promise<{ success: boolean; candidates: Stage2Candidate[]; total?: number }> => {
    const res = await fetch(`${API_BASE}/stage2/candidates/${runId}`);
    return handleResponse(res);
  },

  // Stage 3
  runStage3: async (params: {
    run_id: string;
    smiles_list?: string[];
    candidate_ids?: string[];
    pocket_radius?: number;
    n_steps?: number;
    n_samples?: number;
  }): Promise<Stage3Response> => {
    const res = await fetch(`${API_BASE}/stage3/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return handleResponse<Stage3Response>(res);
  },

  getStage3Results: async (runId: string): Promise<{ success: boolean; results: Stage3ManifestRow[]; manifest_rows?: Stage3ManifestRow[] }> => {
    const res = await fetch(`${API_BASE}/stage3/results/${runId}`);
    return handleResponse(res);
  },

  // Stage 4
  runStage4: async (params: string | {
    run_id: string;
    pocket_radius?: number;
    min_max_iters?: number;
  }): Promise<Stage4Response> => {
    const body = typeof params === 'string' ? { run_id: params } : params;
    const res = await fetch(`${API_BASE}/stage4/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return handleResponse<Stage4Response>(res);
  },

  getStage4ValidationRows: async (runId: string): Promise<{ success: boolean; rows: Stage4ValidationRow[]; records?: Stage4ValidationRow[] }> => {
    const res = await fetch(`${API_BASE}/stage4/validation_rows/${runId}`);
    return handleResponse(res);
  },

  // Stage 4b
  runStage4b: async (params: {
    run_id: string;
    pocket_center?: [number, number, number] | null;
    box_size?: [number, number, number];
    exhaustiveness?: number;
    num_modes?: number;
    max_mm_iters?: number;
    run_gnina?: boolean;
  }): Promise<Stage4bResponse> => {
    const res = await fetch(`${API_BASE}/stage4b/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return handleResponse<Stage4bResponse>(res);
  },

  getStage4bResults: async (runId: string): Promise<{ success: boolean; records: Stage4bRecord[] }> => {
    const res = await fetch(`${API_BASE}/stage4b/results/${runId}`);
    return handleResponse(res);
  },

  // CDI Ranking
  runCdiRank: async (params: {
    run_id: string;
    top_n?: number;
    weights?: Partial<CdiRankingWeights>;
  }): Promise<any> => {
    const res = await fetch(`${API_BASE}/cdi/rank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return handleResponse(res);
  },

  runCdiRanking: async (params: {
    run_id: string;
    top_n?: number;
    weights?: Partial<CdiRankingWeights>;
  }): Promise<any> => {
    const res = await fetch(`${API_BASE}/cdi/rank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return handleResponse(res);
  },

  getCdiResults: async (runId: string): Promise<{ success: boolean; ranked_candidates: CdiRankedCandidate[]; n_total: number }> => {
    const res = await fetch(`${API_BASE}/cdi/results/${runId}`);
    return handleResponse(res);
  },

  getCdiTopCandidates: async (runId: string): Promise<{ success: boolean; top_candidates: CdiRankedCandidate[]; n_top: number }> => {
    const res = await fetch(`${API_BASE}/cdi/top/${runId}`);
    return handleResponse(res);
  },

  // Full Pipeline Execution
  runFullPipeline: async (formData: FormData): Promise<any> => {
    const res = await fetch(`${API_BASE}/pipeline/full`, {
      method: 'POST',
      body: formData,
    });
    return handleResponse(res);
  },

  // Download URL builders
  downloads: {
    stage1: (runId: string, filename: string) => `${API_BASE}/stage1/download/${runId}/${filename}`,
    stage2: (runId: string, filename: string) => `${API_BASE}/stage2/download/${runId}/${filename}`,
    stage3Sdf: (runId: string, recordId: string) => `${API_BASE}/stage3/download_sdf/${runId}/${recordId}`,
    stage3Archive: (runId: string) => `${API_BASE}/stage3/download_archive/${runId}`,
    stage3Report: (runId: string, filename: string) => `${API_BASE}/stage3/download/${runId}/${filename}`,
    stage4Report: (runId: string, filename: string) => `${API_BASE}/stage4/download/${runId}/${filename}`,
    stage4MinArchive: (runId: string) => `${API_BASE}/stage4/download_min_archive/${runId}`,
    stage4bManifest: (runId: string) => `${API_BASE}/stage4b/download_manifest/${runId}`,
    stage4bArchive: (runId: string) => `${API_BASE}/stage4b/download_archive/${runId}`,
    stage4bRelaxedPdb: (runId: string, pairId: string) => `${API_BASE}/stage4b/download_relaxed/${runId}/${pairId}`,
    cdiDownload: (runId: string, filename: string) => `${API_BASE}/cdi/download/${runId}/${filename}`,
  },
};

// API & Data Types for FlexiGEN

export interface HealthStatus {
  status: string;
  version: string;
  stages: string[];
  torch_available: boolean;
  rdkit_available: boolean;
  checkpoint_present: boolean;
  handoff_csv_present: boolean;
  tokenizer_present: boolean;
  docking_available: boolean;
  vina_available: boolean;
  vina_binary: string | null;
  openmm_available: boolean;
  gnina_available: boolean;
  cdi_available: boolean;
}

export interface PlatformMetrics {
  total_runs: number;
  total_conformers: number;
  total_candidates: number;
  total_generated_3d: number;
  total_validated: number;
  total_docked: number;
  top_ranked_count: number;
}

export interface ExperimentSummary {
  run_id: string;
  created_at: string;
  timestamp: number;
  target_protein: string;
  stage1: boolean;
  stage2: boolean;
  stage3: boolean;
  stage4: boolean;
  stage4b: boolean;
  cdi: boolean;
  n_conformers: number;
  n_candidates: number;
  n_generated: number;
  n_validated: number;
  n_docked: number;
  top_cdi_score?: number | null;
  top_candidate_id?: string | null;
}

export interface PharmacophoreFeature {
  identity: string;
  feature: 'HBD' | 'HBA' | 'HYD' | 'ARO' | 'POS' | 'NEG';
  x: number;
  y: number;
  z: number;
}

export interface Stage1Response {
  success: boolean;
  message: string;
  run_id: string;
  n_pocket_residues?: number;
  n_features?: number;
  n_conformers?: number;
  tensor_shape?: number[];
  mask_shape?: number[];
  feature_type_counts?: Record<string, number>;
  files?: Record<string, string>;
}

export interface Stage2Candidate {
  candidate_id?: string;
  smiles: string;
  canonical_smiles: string;
  valid: boolean | string;
  MW?: number | string | null;
  LogP?: number | string | null;
  TPSA?: number | string | null;
  HBD?: number | string | null;
  HBA?: number | string | null;
  QED?: number | string | null;
  source?: string;
}

export interface Stage2Response {
  success: boolean;
  message: string;
  run_id: string;
  total_candidates?: number;
  valid_candidates?: number;
  from_tensor?: number;
  from_handoff?: number;
  validity_rate?: number;
  files?: Record<string, string>;
}

export interface Stage3ManifestRow {
  record_id: string;
  candidate_id: string;
  conformer: string;
  sample_idx: string | number;
  smiles: string;
  n_heavy_atoms: string | number;
  sdf_path?: string;
  status?: string;
}

export interface Stage3Response {
  success: boolean;
  message: string;
  run_id: string;
  n_generated: number;
  n_failed: number;
  n_steps: number;
  pocket_radius: number;
  records?: Stage3ManifestRow[];
  manifest_rows?: Stage3ManifestRow[];
  [key: string]: any;
}

export interface Stage4ValidationRow {
  record_id: string;
  candidate_id?: string;
  smiles?: string;
  sanitization_success?: string | boolean;
  sanitization_passed?: string | boolean;
  all_bonds_valid?: string | boolean;
  bond_length_mean_A?: string | number;
  bond_len_mean_A?: string | number;
  aromatic_planarity_max_rms_A?: string | number;
  max_ring_rmsd_A?: string | number;
  steric_clashes_lt_2A?: string | number;
  has_protein_clash?: string | boolean;
  geometry_screen_flag?: string;
  minimization_converged?: string | boolean;
  energy_before?: string | number;
  energy_before_kcal_mol?: string | number;
  energy_after?: string | number;
  energy_after_kcal_mol?: string | number;
  energy_reduction?: string | number;
  min_ligand_protein_dist_A?: string | number;
  [key: string]: any;
}

export interface Stage4Response {
  success: boolean;
  message: string;
  run_id: string;
  n_total?: number;
  n_structures?: number;
  n_passed?: number;
  n_failed?: number;
  pass_rate?: number;
  [key: string]: any;
}

export interface Stage4bRecord {
  candidate_id: string;
  record_id?: string;
  pair_id?: string;
  conformer?: string;
  smiles?: string;
  vina_score_kcal_mol?: string | number;
  vina_top_score?: string | number;
  energy_change_kJ_mol?: string | number;
  final_ligand_rmsd_A?: string | number;
  rmsd?: string | number;
  rmsd_A?: string | number;
  gnina_CNNscore?: string | number;
  gnina_CNNaffinity?: string | number;
  qc_verdict?: string;
  [key: string]: any;
}

export interface Stage4bResponse {
  success: boolean;
  message: string;
  run_id: string;
  n_total?: number;
  n_docked?: number;
  n_relaxed?: number;
  n_gnina?: number;
  n_qc_pass?: number;
  n_qc_flag?: number;
  n_candidates?: number;
  [key: string]: any;
}

export interface CdiRankedCandidate {
  cdi_rank: number;
  candidate_id: string;
  record_id?: string;
  conformer?: string;
  smiles: string;
  cdi_score: number;
  cdi_tier: 'Tier 1 — Top Lead' | 'Tier 2 — Promising' | 'Tier 3 — Low Priority' | string;
  docking_evaluated?: boolean;
  vina_score_kcal_mol?: number | string | null;
  vina_top_score?: number | string | null;
  gnina_CNNaffinity?: number | string | null;
  gnina_CNNscore?: number | string | null;
  final_ligand_rmsd_A?: number | string | null;
  rmsd?: number | string | null;
  rmsd_A?: number | string | null;
  energy_change_kJ_mol?: number | string | null;
  qed?: number | string | null;
  prop_QED?: number | string | null;
  sas?: number | string | null;
  prop_SA_Score?: number | string | null;
  tox_risk?: string | null;
  tox_alerts?: string | null;
  mw?: number | string | null;
  logp?: number | string | null;
  hbd?: number | string | null;
  hba?: number | string | null;
  tpsa?: number | string | null;
  rot_bonds?: number | string | null;
  fsp3?: number | string | null;
  lipinski_pass?: boolean | string | null;
  veber_pass?: boolean | string | null;
  qc_verdict?: string | null;
  final_verdict?: string | null;
  [key: string]: any;
}

export interface CdiRankingWeights {
  w_vina: number;
  w_gnina: number;
  w_rmsd: number;
  w_energy: number;
  w_qc: number;
  w_qed: number;
  w_sas: number;
  w_tox: number;
  w_lipo: number;
  w_mw: number;
}

export interface Structure3DResponse {
  success: boolean;
  message?: string;
  error?: string;
  candidate_id: string;
  format: 'sdf' | 'pdb';
  ligand_structure: string;
  complex_pdb?: string | null;
  receptor_pdb?: string | null;
  has_complex: boolean;
  has_docked: boolean;
  properties: Record<string, any>;
  [key: string]: any;
}

export interface ProteinStructureResponse {
  success: boolean;
  run_id: string;
  filename: string;
  pdb_content: string;
  pharmacophore?: {
    features: PharmacophoreFeature[];
    n_conformers: number;
    tensor_shape: number[];
  } | null;
}

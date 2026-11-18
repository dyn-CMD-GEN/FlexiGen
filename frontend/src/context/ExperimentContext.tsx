import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { HealthStatus, ExperimentSummary, PlatformMetrics } from '../api/types';
import { api } from '../api/client';

interface ExperimentContextType {
  health: HealthStatus | null;
  healthLoading: boolean;
  experiments: ExperimentSummary[];
  experimentsLoading: boolean;
  activeRunId: string | null;
  setActiveRunId: (runId: string) => void;
  activeExperiment: ExperimentSummary | null;
  metrics: PlatformMetrics | null;
  refreshHealth: () => Promise<void>;
  refreshExperiments: () => Promise<void>;
}

const ExperimentContext = createContext<ExperimentContextType | undefined>(undefined);

export const ExperimentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(true);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [experimentsLoading, setExperimentsLoading] = useState<boolean>(true);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);

  const refreshExperiments = useCallback(async () => {
    setExperimentsLoading(true);
    try {
      const expRes = await api.listExperiments();
      if (expRes.success) {
        setExperiments(expRes.experiments);
        // Default to first (latest) experiment if none selected yet
        if (!activeRunId && expRes.experiments.length > 0) {
          // Prefer run ffd5e588 if present (complete demo run), else the newest one
          const preferred = expRes.experiments.find(e => e.run_id === 'ffd5e588') || expRes.experiments[0];
          setActiveRunId(preferred.run_id);
        }
      }
      const sumRes = await api.getExperimentsSummary();
      if (sumRes.success) {
        setMetrics(sumRes.metrics);
      }
    } catch (e) {
      console.error('Failed to load experiments:', e);
    } finally {
      setExperimentsLoading(false);
    }
  }, [activeRunId]);

  const refreshHealth = useCallback(async () => {
    try {
      const h = await api.getHealth();
      setHealth(prev => {
        if (!prev && h) {
          // Came back online, re-fetch experiments
          refreshExperiments();
        }
        return h;
      });
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, [refreshExperiments]);

  useEffect(() => {
    refreshHealth();
    refreshExperiments();
    const interval = setInterval(() => {
      refreshHealth();
    }, 10000);
    return () => clearInterval(interval);
  }, [refreshHealth, refreshExperiments]);

  const activeExperiment = experiments.find((e) => e.run_id === activeRunId) || null;

  return (
    <ExperimentContext.Provider
      value={{
        health,
        healthLoading,
        experiments,
        experimentsLoading,
        activeRunId,
        setActiveRunId,
        activeExperiment,
        metrics,
        refreshHealth,
        refreshExperiments,
      }}
    >
      {children}
    </ExperimentContext.Provider>
  );
};

export const useExperiment = () => {
  const context = useContext(ExperimentContext);
  if (!context) {
    throw new Error('useExperiment must be used within an ExperimentProvider');
  }
  return context;
};

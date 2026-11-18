import React from 'react';

interface StatusBadgeProps {
  type?: 'tier' | 'qc' | 'pipeline' | 'lipinski' | 'source';
  value?: string | boolean;
  status?: 'completed' | 'ready' | 'pending' | 'error' | string;
  text?: string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  type = 'pipeline',
  value,
  status,
  text,
  className = '',
}) => {
  // If status is passed directly
  if (status) {
    if (status === 'completed' || status === 'done' || status === 'Executed') {
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 ${className}`}
        >
          {text || 'COMPLETED'}
        </span>
      );
    }
    if (status === 'ready' || status === 'running') {
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 ${className}`}
        >
          {text || 'READY'}
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-800 text-slate-500 border border-[#26354B] ${className}`}
      >
        {text || 'PENDING'}
      </span>
    );
  }

  const strVal = String(value ?? '');

  // CDI Tiers
  if (type === 'tier') {
    if (strVal.includes('Tier 1')) {
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-semibold bg-amber-400/15 text-amber-300 border border-amber-400/40 shadow-sm ${className}`}
        >
          🥇 Tier 1 — Top Lead
        </span>
      );
    }
    if (strVal.includes('Tier 2')) {
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-semibold bg-cyan-400/15 text-cyan-300 border border-cyan-400/40 ${className}`}
        >
          🥈 Tier 2 — Promising
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-semibold bg-slate-700/50 text-slate-400 border border-slate-600 ${className}`}
      >
        🥉 Tier 3 — Low Priority
      </span>
    );
  }

  // QC Verdicts
  if (type === 'qc') {
    const upper = strVal.toUpperCase();
    if (upper.includes('PASS')) {
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 ${className}`}
        >
          QC PASS
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30 ${className}`}
      >
        {strVal || 'QC FAIL'}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 ${className}`}
    >
      {text || strVal}
    </span>
  );
};

import React from 'react';

interface MetricCardProps {
  label?: string;
  title?: string;
  value: string | number;
  subtext?: string;
  subtitle?: string;
  icon?: React.ReactNode | React.ComponentType<{ className?: string }>;
  accentColor?: 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose' | 'blue';
  color?: 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose' | 'blue';
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  title,
  value,
  subtext,
  subtitle,
  icon,
  accentColor,
  color = 'cyan',
}) => {
  const chosenColor = accentColor || color;
  const displayTitle = title || label || '';
  const displaySubtext = subtitle || subtext;

  const getAccentStyles = () => {
    switch (chosenColor) {
      case 'violet':
        return {
          glow: 'group-hover:border-violet-500/50 group-hover:shadow-glow-violet',
          iconBg: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
          valText: 'text-violet-300',
        };
      case 'emerald':
        return {
          glow: 'group-hover:border-emerald-500/50',
          iconBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
          valText: 'text-emerald-300',
        };
      case 'amber':
        return {
          glow: 'group-hover:border-amber-500/50',
          iconBg: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
          valText: 'text-amber-300',
        };
      case 'rose':
        return {
          glow: 'group-hover:border-rose-500/50',
          iconBg: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
          valText: 'text-rose-300',
        };
      case 'blue':
        return {
          glow: 'group-hover:border-blue-500/50',
          iconBg: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
          valText: 'text-blue-300',
        };
      default:
        return {
          glow: 'group-hover:border-cyan-500/50 group-hover:shadow-glow-cyan',
          iconBg: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
          valText: 'text-cyan-300',
        };
    }
  };

  const styles = getAccentStyles();

  // Render icon whether it's a ReactNode or a ComponentType
  const renderIcon = () => {
    if (!icon) return null;
    if (React.isValidElement(icon)) return icon;
    if (typeof icon === 'function') {
      const IconComp = icon as React.ComponentType<{ className?: string }>;
      return <IconComp className="w-5 h-5" />;
    }
    return null;
  };

  return (
    <div
      className={`group relative flex flex-col justify-between p-4 rounded-2xl border border-[#26354B] bg-[#0E1726] transition-all duration-300 hover:-translate-y-1 ${styles.glow}`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-slate-400 tracking-wide uppercase">{displayTitle}</span>
        {icon && (
          <div className={`p-2 rounded-xl border flex items-center justify-center shrink-0 ${styles.iconBg}`}>
            {renderIcon()}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className={`font-mono text-2xl font-bold tracking-tight ${styles.valText}`}>{value}</div>
        {displaySubtext && <div className="text-[11px] font-mono text-slate-500">{displaySubtext}</div>}
      </div>
    </div>
  );
};

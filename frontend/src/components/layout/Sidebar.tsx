import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Dna,
  Crosshair,
  Sparkles,
  Library,
  ShieldCheck,
  Magnet,
  Trophy,
  FileSpreadsheet,
  History,
  Settings,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
} from 'lucide-react';

interface NavItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const navItems: NavItem[] = [
  { name: 'Overview', path: '/', icon: LayoutDashboard },
  { name: 'Protein Targets', path: '/targets', icon: Dna },
  { name: 'Pocket Analysis', path: '/pockets', icon: Crosshair, badge: 'Core' },
  { name: 'Molecular Generation', path: '/generation', icon: Sparkles },
  { name: 'Molecule Library', path: '/library', icon: Library },
  { name: 'Molecular Validation', path: '/validation', icon: ShieldCheck },
  { name: 'Docking & Rescoring', path: '/docking', icon: Magnet },
  { name: 'Ensemble Ranking', path: '/cdi', icon: Trophy, badge: 'CDI' },
  { name: 'Results & Reports', path: '/results', icon: FileSpreadsheet },
  { name: 'Experiments', path: '/experiments', icon: History },
  { name: 'Settings', path: '/settings', icon: Settings },
];

export const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`relative z-20 flex flex-col border-r border-[#26354B] bg-[#0B1322] transition-all duration-300 select-none ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-[#26354B]">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500/20 to-violet-500/30 border border-cyan-400/40 text-cyan-300 shrink-0 shadow-glow-cyan">
            <FlaskConical className="w-5 h-5" />
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-heading text-lg font-bold tracking-tight text-slate-100 flex items-center">
                Flexi<span className="text-cyan-400">GEN</span>
              </span>
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 truncate">
                AI Drug Discovery
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            title={collapsed ? item.name : undefined}
            className={({ isActive }) =>
              `group relative flex items-center gap-3.5 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-150 ${
                isActive
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-glow-cyan'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#152238] border border-transparent'
              } ${collapsed ? 'justify-center px-0' : ''}`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />
                {!collapsed && (
                  <span className="truncate flex-1 font-sans">{item.name}</span>
                )}
                {!collapsed && item.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold uppercase tracking-wider ${
                      isActive
                        ? 'bg-cyan-400/20 text-cyan-300 border border-cyan-400/40'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse Toggle */}
      <div className="p-3 border-t border-[#26354B]">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full py-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#152238] transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>
    </aside>
  );
};

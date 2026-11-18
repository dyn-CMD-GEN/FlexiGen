import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { AlertCircle, ShieldAlert } from 'lucide-react';

export const AppLayout: React.FC = () => {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#080D19] text-[#F1F5F9]">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Workspace Column */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top Header */}
        <Header />

        {/* Global Scientific Disclaimer Notice */}
        <div className="bg-[#121B2B] border-b border-[#26354B] px-6 py-1.5 flex items-center justify-between text-xs text-slate-400 select-none">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-semibold text-slate-300">Target: Human PARP1</span>
            <span className="text-slate-600">|</span>
            <span>Dynamic-Pocket Molecular Generation & Selective Inhibitor Design</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-amber-400/90 text-[11px]">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Computational Evaluation Only · Non-clinical Prototype</span>
          </div>
        </div>

        {/* Dynamic Page Outlet with Custom Scrollbar */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-6 bg-[#080D19]">
          <div className="max-w-7xl mx-auto space-y-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

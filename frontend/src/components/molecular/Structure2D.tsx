import React, { useEffect, useRef, useState } from 'react';
import { Eye, Copy, Check } from 'lucide-react';

interface Structure2DProps {
  smiles: string;
  candidateId?: string;
  width?: number;
  height?: number;
  className?: string;
  onView3D?: () => void;
}

export const Structure2D: React.FC<Structure2DProps> = ({
  smiles,
  candidateId,
  width = 240,
  height = 160,
  className = '',
  onView3D,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(smiles);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw stylized 2D molecular schematic representation
    ctx.clearRect(0, 0, width, height);

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#0F1826');
    grad.addColorStop(1, '#09101C');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Grid accent
    ctx.strokeStyle = '#182438';
    ctx.lineWidth = 1;
    for (let x = 20; x < width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 20; y < height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Pseudorandom pseudo-graph from SMILES hash for reproducible 2D node-link layout
    let hash = 0;
    for (let i = 0; i < smiles.length; i++) {
      hash = (hash << 5) - hash + smiles.charCodeAt(i);
      hash |= 0;
    }
    const seed = Math.abs(hash);

    const numNodes = Math.min(14, Math.max(6, Math.floor((smiles.length / 3) + (seed % 4))));
    const nodes: { x: number; y: number; atom: string; color: string }[] = [];
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.32;

    const atoms = ['C', 'C', 'N', 'O', 'C', 'C', 'C', 'F', 'C', 'N'];
    const colors: Record<string, string> = {
      C: '#22D3EE',
      N: '#818CF8',
      O: '#F87171',
      F: '#34D399',
      S: '#FBBF24',
    };

    for (let i = 0; i < numNodes; i++) {
      const angle = (i / numNodes) * 2 * Math.PI + (seed % 10) * 0.1;
      const r = radius * (0.65 + ((seed + i * 17) % 35) / 100);
      const atom = atoms[(seed + i) % atoms.length];
      nodes.push({
        x: centerX + Math.cos(angle) * r,
        y: centerY + Math.sin(angle) * r,
        atom,
        color: colors[atom] || '#22D3EE',
      });
    }

    // Draw bonds
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (let i = 0; i < nodes.length; i++) {
      const next = (i + 1) % nodes.length;
      ctx.beginPath();
      ctx.moveTo(nodes[i].x, nodes[i].y);
      ctx.lineTo(nodes[next].x, nodes[next].y);
      ctx.stroke();

      // Branch bond
      if (i % 3 === 0 && i + 2 < nodes.length) {
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[(i + 3) % nodes.length].x, nodes[(i + 3) % nodes.length].y);
        ctx.stroke();
      }
    }

    // Draw atoms
    nodes.forEach((n) => {
      ctx.fillStyle = '#0B1322';
      ctx.beginPath();
      ctx.arc(n.x, n.y, 7, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 4.5, 0, 2 * Math.PI);
      ctx.fill();
    });
  }, [smiles, width, height]);

  return (
    <div
      className={`group relative rounded-xl overflow-hidden border border-[#26354B] bg-[#0B1322] flex flex-col ${className}`}
    >
      <div className="relative">
        <canvas ref={canvasRef} width={width} height={height} className="w-full h-auto block" />

        {/* Hover overlay with 3D action */}
        {onView3D && (
          <div className="absolute inset-0 bg-[#080D19]/75 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button
              onClick={onView3D}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold text-xs transition-all shadow-glow-cyan"
            >
              <Eye className="w-3.5 h-3.5" />
              Explore 3D
            </button>
          </div>
        )}

        {/* Copy SMILES button */}
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 p-1 rounded-md bg-[#111A2B]/80 text-slate-400 hover:text-cyan-300 border border-[#26354B] transition-colors"
          title="Copy SMILES"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {candidateId && (
        <div className="p-2.5 bg-[#0F172A] border-t border-[#26354B] flex items-center justify-between text-xs">
          <span className="font-mono font-medium text-slate-200 truncate max-w-[150px]">{candidateId}</span>
          <span className="font-mono text-[10px] text-cyan-400 font-semibold uppercase">2D Topology</span>
        </div>
      )}
    </div>
  );
};

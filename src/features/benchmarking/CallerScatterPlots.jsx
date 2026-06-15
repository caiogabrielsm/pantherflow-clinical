import React, { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

const CALLER_COLORS = {
  Mutect2:   '#4472C4',
  VarScan2:  '#70AD47',
  LoFreq:    '#ED7D31',
  Consensus: '#7030A0',
};
const DEFAULT_COLOR = '#888';
const SHAPES = ['circle', 'triangle', 'square', 'pentagon', 'hexagon'];

// ── Formas SVG ────────────────────────────────────────────────────────────────
function Shape({ shape, cx, cy, color, size = 7 }) {
  const p = { fill: color, fillOpacity: 0.85, stroke: color, strokeWidth: 1 };
  switch (shape) {
    case 'circle':
      return <circle cx={cx} cy={cy} r={size} {...p} />;
    case 'triangle':
      return <polygon points={`${cx},${cy - size} ${cx - size * 0.87},${cy + size * 0.5} ${cx + size * 0.87},${cy + size * 0.5}`} {...p} />;
    case 'square':
      return <rect x={cx - size * 0.85} y={cy - size * 0.85} width={size * 1.7} height={size * 1.7} {...p} />;
    case 'pentagon': {
      const pts = Array.from({ length: 5 }, (_, i) => {
        const a = (i * 72 - 90) * Math.PI / 180;
        return `${cx + size * Math.cos(a)},${cy + size * Math.sin(a)}`;
      }).join(' ');
      return <polygon points={pts} {...p} />;
    }
    case 'hexagon': {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (i * 60 - 90) * Math.PI / 180;
        return `${cx + size * Math.cos(a)},${cy + size * Math.sin(a)}`;
      }).join(' ');
      return <polygon points={pts} {...p} />;
    }
    default:
      return <circle cx={cx} cy={cy} r={size} {...p} />;
  }
}

function DiamondMean({ cx, cy, color }) {
  return (
    <polygon
      points={`${cx},${cy - 9} ${cx + 9},${cy} ${cx},${cy + 9} ${cx - 9},${cy}`}
      fill={color} fillOpacity={0.9} stroke={color} strokeWidth={1.5}
    />
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, xLabel, yLabel }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const fmt = v => v != null ? `${(v * 100).toFixed(2)}%` : '—';
  return (
    <div style={{ background: 'white', border: '1px solid #cbd5e1', padding: '8px 12px', fontSize: 11, fontFamily: 'monospace', minWidth: 170 }}>
      <p style={{ fontWeight: 700, marginBottom: 4, color: d.color }}>
        {d.isMean ? `${d.caller} — Cluster Mean` : `${d.caller} · ${d.amostra}`}
      </p>
      <p style={{ margin: '2px 0', color: '#555' }}>{xLabel}: <strong>{fmt(d.x)}</strong></p>
      <p style={{ margin: '2px 0', color: '#555' }}>{yLabel}: <strong>{fmt(d.y)}</strong></p>
    </div>
  );
}

// ── Plot individual ───────────────────────────────────────────────────────────
function ScatterPlot({ label, title, subtitle, series, xLabel, yLabel, xDomain, yDomain }) {
  const fmtPct = v => `${(v * 100).toFixed(1)}%`;
  const axisStyle = { fontSize: 10, fill: '#64748b' };

  return (
    <div className="bg-white border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200">
        <p className="text-sm font-bold text-slate-800">
          <span className="font-mono text-slate-400 mr-1">{label}</span>{title}
        </p>
        {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-3">
        <ResponsiveContainer width="100%" height={270}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 32, left: 10 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" />
            <XAxis
              type="number" dataKey="x"
              domain={xDomain} tickFormatter={fmtPct}
              tick={axisStyle}
              label={{ value: xLabel, position: 'insideBottom', offset: -20, fontSize: 10, fill: '#64748b' }}
              axisLine={{ stroke: '#cbd5e1' }} tickLine={{ stroke: '#cbd5e1' }}
            />
            <YAxis
              type="number" dataKey="y"
              domain={yDomain} tickFormatter={fmtPct}
              tick={axisStyle} width={48}
              label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 14, fontSize: 10, fill: '#64748b' }}
              axisLine={{ stroke: '#cbd5e1' }} tickLine={{ stroke: '#cbd5e1' }}
            />
            <Tooltip content={<CustomTooltip xLabel={xLabel} yLabel={yLabel} />} cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} />

            {series.flatMap(({ caller, color, amostras }) =>
              amostras.map(({ amostra, shape, x, y, isMean }) => (
                <Scatter
                  key={`${caller}-${amostra}-${isMean}`}
                  data={[{ x, y, caller, amostra, color, isMean }]}
                  isAnimationActive={false}
                  shape={(props) =>
                    isMean
                      ? <DiamondMean cx={props.cx} cy={props.cy} color={color} />
                      : <Shape shape={shape} cx={props.cx} cy={props.cy} color={color} />
                  }
                />
              ))
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Utilitário: média ─────────────────────────────────────────────────────────
const mean = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

function axisRange(values, margin = 0.015) {
  const v = values.filter(x => x != null);
  if (!v.length) return [0, 1];
  return [
    parseFloat(Math.max(0, Math.min(...v) - margin).toFixed(3)),
    parseFloat(Math.min(1, Math.max(...v) + margin).toFixed(3)),
  ];
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function CallerScatterPlots({ dados = [] }) {
  const validSNV   = dados.filter(d => d.snv_precisao   != null && d.snv_sensibilidade   != null);
  const validIndel = dados.filter(d => d.indel_precisao != null && d.indel_sensibilidade != null);
  const validF1    = dados.filter(d => d.snv_f1 != null && d.indel_f1 != null);

  if (!validSNV.length && !validIndel.length) return null;

  const callers  = [...new Set(dados.map(d => d.caller))].sort();
  const amostras = [...new Set(dados.map(d => d.amostra))].sort();
  const shapeMap = Object.fromEntries(amostras.map((a, i) => [a, SHAPES[i % SHAPES.length]]));

  function buildSeries(rows, xKey, yKey) {
    return callers.map(caller => {
      const pts = rows.filter(d => d.caller === caller);
      const color = CALLER_COLORS[caller] ?? DEFAULT_COLOR;
      const xs = pts.map(d => d[xKey]).filter(v => v != null);
      const ys = pts.map(d => d[yKey]).filter(v => v != null);

      const amostrasData = pts
        .filter(d => d[xKey] != null && d[yKey] != null)
        .map(d => ({ amostra: d.amostra, shape: shapeMap[d.amostra], x: d[xKey], y: d[yKey], isMean: false }));

      const clusterMean = xs.length
        ? [{ amostra: 'Média', shape: 'diamond', x: mean(xs), y: mean(ys), isMean: true }]
        : [];

      return { caller, color, amostras: [...amostrasData, ...clusterMean] };
    }).filter(s => s.amostras.length > 0);
  }

  const seriesA = buildSeries(validSNV,   'snv_precisao',   'snv_sensibilidade');
  const seriesB = buildSeries(validIndel, 'indel_precisao', 'indel_sensibilidade');
  const seriesC = buildSeries(validF1,    'snv_f1',         'indel_f1');

  const allSnvPrec  = validSNV.map(d => d.snv_precisao);
  const allSnvSens  = validSNV.map(d => d.snv_sensibilidade);
  const allIndPrec  = validIndel.map(d => d.indel_precisao);
  const allIndSens  = validIndel.map(d => d.indel_sensibilidade);
  const allSnvF1    = validF1.map(d => d.snv_f1);
  const allIndelF1  = validF1.map(d => d.indel_f1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {validSNV.length > 0 && (
          <ScatterPlot
            label="A"
            title="SNV Recall vs. Precision"
            subtitle="higher is better · ◆ = cluster mean"
            series={seriesA}
            xLabel="SNV Precision (higher is better)"
            yLabel="SNV Recall (higher is better)"
            xDomain={axisRange(allSnvPrec)}
            yDomain={axisRange(allSnvSens)}
          />
        )}
        {validIndel.length > 0 && (
          <ScatterPlot
            label="B"
            title="Indel Recall vs. Precision"
            subtitle="higher is better · ◆ = cluster mean"
            series={seriesB}
            xLabel="Indel Precision (higher is better)"
            yLabel="Indel Recall (higher is better)"
            xDomain={axisRange(allIndPrec)}
            yDomain={axisRange(allIndSens)}
          />
        )}
      </div>

      {validF1.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ScatterPlot
            label="C"
            title="Indel F1 Score vs. SNV F1 Score"
            subtitle="cluster means averaged across amostras · ◆ = cluster mean"
            series={seriesC}
            xLabel="SNV F1 Score (higher is better)"
            yLabel="Indel F1 Score (higher is better)"
            xDomain={axisRange(allSnvF1)}
            yDomain={axisRange(allIndelF1)}
          />

          {/* Legenda */}
          <div className="bg-white border border-slate-200 px-5 py-4 flex gap-10 flex-wrap">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Software</p>
              <div className="flex flex-col gap-2">
                {callers.map(caller => (
                  <span key={caller} className="flex items-center gap-2 text-xs text-slate-700">
                    <span style={{ width: 12, height: 12, background: CALLER_COLORS[caller] ?? DEFAULT_COLOR, display: 'inline-block', flexShrink: 0 }} />
                    {caller}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Amostra</p>
              <div className="flex flex-col gap-2">
                {amostras.map((amostra, i) => (
                  <span key={amostra} className="flex items-center gap-2 text-xs text-slate-700">
                    <svg width="14" height="14" viewBox="-7 -7 14 14" style={{ flexShrink: 0 }}>
                      <Shape shape={SHAPES[i % SHAPES.length]} cx={0} cy={0} color="#64748b" />
                    </svg>
                    {amostra}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Referência</p>
              <span className="flex items-center gap-2 text-xs text-slate-700">
                <svg width="14" height="14" viewBox="-9 -9 18 18" style={{ flexShrink: 0 }}>
                  <polygon points="0,-8 8,0 0,8 -8,0" fill="#64748b" fillOpacity={0.85} stroke="#64748b" strokeWidth={1.5} />
                </svg>
                Cluster Mean
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

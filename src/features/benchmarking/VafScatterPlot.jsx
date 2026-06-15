import React, { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, ReferenceLine,
} from 'recharts';

// Matplotlib default: #1f77b4
const DOT_COLOR = '#1f77b4';

export default function VafScatterPlot({
  pontos = [],
  spearmanRho    = null,
  spearmanPvalue = null,
  pearsonR       = null,
  rmseVaf        = null,
}) {
  const scatterData = useMemo(
    () => pontos.map(p => ({ x: p.vaf_ion, y: p.vaf_panther })),
    [pontos],
  );

  if (pontos.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm py-8">
        Sem TPs para exibir.
      </div>
    );
  }

  const fmt3 = v => v != null ? v.toFixed(3) : '—';
  const pLabel = spearmanPvalue != null
    ? spearmanPvalue < 0.001 ? 'p < 0.001' : `p = ${spearmanPvalue.toFixed(3)}`
    : null;

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {/* Área do gráfico com spine (borda em todos os lados, estilo matplotlib) */}
      <div style={{ border: '1px solid #555', background: 'white', display: 'inline-block' }}>
        <ScatterChart
          width={440} height={380}
          margin={{ top: 16, right: 20, bottom: 44, left: 52 }}
        >
          <CartesianGrid stroke="#cccccc" strokeOpacity={0.5} strokeDasharray="none" />
          <XAxis
            type="number" dataKey="x"
            domain={[0, 1]}
            tickFormatter={v => `${(v * 100).toFixed(0)}%`}
            label={{ value: 'VAF Ion Reporter (%)', position: 'insideBottom', offset: -28, fontSize: 12, fill: '#222' }}
            tick={{ fontSize: 11, fill: '#333' }}
            axisLine={{ stroke: '#555' }}
            tickLine={{ stroke: '#555', size: 4 }}
            tickCount={6}
          />
          <YAxis
            type="number" dataKey="y"
            domain={[0, 1]}
            tickFormatter={v => `${(v * 100).toFixed(0)}%`}
            label={{ value: 'VAF PantherFlow (%)', angle: -90, position: 'insideLeft', offset: -36, fontSize: 12, fill: '#222' }}
            tick={{ fontSize: 11, fill: '#333' }}
            axisLine={{ stroke: '#555' }}
            tickLine={{ stroke: '#555', size: 4 }}
            tickCount={6}
          />
          {/* Linha de identidade y = x */}
          <ReferenceLine
            segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
            stroke="#888888"
            strokeDasharray="6 3"
            strokeWidth={1.2}
          />
          <Scatter
            data={scatterData}
            fill={DOT_COLOR}
            fillOpacity={0.75}
            r={4}
            isAnimationActive={false}
          />
        </ScatterChart>
      </div>

      {/* Painel de métricas estilo tabela académica */}
      <table style={{ borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace', minWidth: 380 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #333' }}>
            {['Spearman ρ', 'p-value', 'Pearson r', 'RMSE VAF', 'n (TPs)'].map(h => (
              <th key={h} style={{ padding: '4px 14px', textAlign: 'center', fontWeight: 700, color: '#222', fontFamily: 'sans-serif', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '1px solid #aaa' }}>
            <td style={{ padding: '5px 14px', textAlign: 'center' }}>{fmt3(spearmanRho)}</td>
            <td style={{ padding: '5px 14px', textAlign: 'center', color: '#555' }}>{pLabel ?? '—'}</td>
            <td style={{ padding: '5px 14px', textAlign: 'center' }}>{fmt3(pearsonR)}</td>
            <td style={{ padding: '5px 14px', textAlign: 'center' }}>{fmt3(rmseVaf)}</td>
            <td style={{ padding: '5px 14px', textAlign: 'center' }}>{pontos.length}</td>
          </tr>
        </tbody>
      </table>

      {/* Legenda inline */}
      <div style={{ fontSize: 11, color: '#555', display: 'flex', gap: 20, fontFamily: 'sans-serif' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#888" strokeDasharray="6 3" strokeWidth="1.5"/></svg>
          y = x (concordância perfeita)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill={DOT_COLOR} fillOpacity="0.75"/></svg>
          Concordante (TP)
        </span>
      </div>
    </div>
  );
}

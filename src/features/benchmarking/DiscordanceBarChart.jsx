import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts';

// Matplotlib paleta padrão
const COLOR_FP = '#1f77b4';   // azul matplotlib
const COLOR_FN = '#ff7f0e';   // laranja matplotlib

export default function DiscordanceBarChart({ discordantesVaf = [] }) {
  const chartData = useMemo(
    () => discordantesVaf.map(d => ({ faixa: d.faixa, PantherFlow: d.fp, IonTorrent: d.fn })),
    [discordantesVaf],
  );

  const totalFp = chartData.reduce((s, d) => s + d.PantherFlow, 0);
  const totalFn = chartData.reduce((s, d) => s + d.IonTorrent,  0);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm py-8">
        Sem discordâncias para exibir.
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center gap-3">
      <div style={{ border: '1px solid #555', background: 'white', display: 'inline-block' }}>
        <BarChart
          width={520} height={300}
          data={chartData}
          margin={{ top: 24, right: 28, bottom: 40, left: 48 }}
          barCategoryGap="28%"
          barGap={3}
        >
          <CartesianGrid stroke="#cccccc" strokeOpacity={0.5} strokeDasharray="none" vertical={false} />
          <XAxis
            dataKey="faixa"
            tick={{ fontSize: 11, fill: '#333' }}
            axisLine={{ stroke: '#555' }}
            tickLine={{ stroke: '#555', size: 4 }}
            label={{ value: 'Faixa de VAF', position: 'insideBottom', offset: -26, fontSize: 12, fill: '#222' }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#333' }}
            axisLine={{ stroke: '#555' }}
            tickLine={{ stroke: '#555', size: 4 }}
            allowDecimals={false}
            label={{ value: 'Nº de variantes', angle: -90, position: 'insideLeft', offset: -30, fontSize: 12, fill: '#222' }}
          />
          <Bar dataKey="PantherFlow" fill={COLOR_FP} radius={[2, 2, 0, 0]} maxBarSize={40} isAnimationActive={false}>
            <LabelList dataKey="PantherFlow" position="top" style={{ fontSize: 10, fill: '#1a5a8a', fontWeight: 700 }} />
          </Bar>
          <Bar dataKey="IonTorrent" fill={COLOR_FN} radius={[2, 2, 0, 0]} maxBarSize={40} isAnimationActive={false}>
            <LabelList dataKey="IonTorrent" position="top" style={{ fontSize: 10, fill: '#8a4010', fontWeight: 700 }} />
          </Bar>
        </BarChart>
      </div>

      {/* Legenda inline estilo matplotlib */}
      <div style={{ display: 'flex', gap: 24, fontSize: 11, fontFamily: 'sans-serif', color: '#333' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, background: COLOR_FP, display: 'inline-block', borderRadius: 2 }} />
          FP — Exclusivos PantherFlow (n={totalFp})
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, background: COLOR_FN, display: 'inline-block', borderRadius: 2 }} />
          FN — Exclusivos Ion Reporter (n={totalFn})
        </span>
      </div>

      <p style={{ fontSize: 11, color: '#555', maxWidth: 480, textAlign: 'center', fontFamily: 'sans-serif', lineHeight: 1.5 }}>
        <strong>Nota:</strong> Falsos Negativos concentrados em faixas de alto VAF (&gt;30%) representam
        majoritariamente variantes germinativas descartadas com sucesso pelo filtro do algoritmo.
      </p>
    </div>
  );
}

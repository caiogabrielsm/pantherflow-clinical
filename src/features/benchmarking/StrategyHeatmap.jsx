import React from 'react';

// ── Gradiente branco → cor para um valor 0..1 ─────────────────────────────
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function heatColor(value, isNull) {
  if (isNull) return { bg: '#f8fafc', text: '#cbd5e1' };
  // branco (baixo) → azul-escuro (alto)
  const r = lerp(255, 30,  value);
  const g = lerp(255, 64,  value);
  const b = lerp(255, 175, value);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return { bg: `rgb(${r},${g},${b})`, text: lum > 140 ? '#1e293b' : '#ffffff' };
}

const COLS = [
  { key: 'ppv',         label: 'Precisão (PPV)',   desc: 'Confirmadas / Calls' },
  { key: 'sensitivity', label: 'Sensibilidade',    desc: 'Confirmadas / Total Ion' },
];

const CATEGORY_LABEL = {
  single:    'Callers Individuais',
  intersect: 'Interseção',
  union:     'União',
};

function categoriaEstrategia(s) {
  if (!s) return 'single';
  if (s.includes('∩')) return 'intersect';
  if (s.includes('∪') || s === 'União Total') return 'union';
  return 'single';
}

export default function StrategyHeatmap({ dados = [] }) {
  if (!dados.length) return null;

  // Agrega por estratégia (média das amostras)
  const byEstrategia = {};
  for (const row of dados) {
    const e = row.estrategia;
    if (!byEstrategia[e]) byEstrategia[e] = { ppv: [], sensitivity: [], calls: [] };
    if (row.ppv         != null) byEstrategia[e].ppv.push(row.ppv);
    if (row.sensitivity != null) byEstrategia[e].sensitivity.push(row.sensitivity);
    if (row.calls       != null) byEstrategia[e].calls.push(row.calls);
  }

  const mean = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

  const rows = Object.entries(byEstrategia).map(([estrategia, d]) => ({
    estrategia,
    cat: categoriaEstrategia(estrategia),
    ppv:         mean(d.ppv),
    sensitivity: mean(d.sensitivity),
    calls:       mean(d.calls),
  }));

  // Normaliza cada coluna para 0..1 para o gradiente
  function normalize(rows, key) {
    const vals = rows.map(r => r[key]).filter(v => v != null);
    if (!vals.length) return () => 0;
    const min = Math.min(...vals), max = Math.max(...vals);
    return v => v == null ? null : max === min ? 0.5 : (v - min) / (max - min);
  }

  const normPpv  = normalize(rows, 'ppv');
  const normSens = normalize(rows, 'sensitivity');

  // Agrupa por categoria mantendo ordem
  const catOrder = ['single', 'intersect', 'union'];
  const grouped = catOrder
    .map(cat => ({ cat, rows: rows.filter(r => r.cat === cat) }))
    .filter(g => g.rows.length > 0);

  const fmt = v => v != null ? `${(v * 100).toFixed(1)}%` : '—';

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-300">
            <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest w-52">
              Estratégia
            </th>
            <th className="px-3 py-2 text-right text-[11px] font-bold text-slate-500 uppercase tracking-widest w-20">
              Calls
            </th>
            {COLS.map(c => (
              <th key={c.key} className="px-3 py-2 text-center min-w-[120px]">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{c.label}</div>
                <div className="text-[10px] font-normal text-slate-400 normal-case tracking-normal mt-0.5">{c.desc}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grouped.map(({ cat, rows: catRows }) => (
            <React.Fragment key={cat}>
              {/* Separador de categoria */}
              <tr>
                <td colSpan={4} className="px-3 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest bg-slate-50 border-t border-b border-slate-200">
                  {CATEGORY_LABEL[cat]}
                </td>
              </tr>
              {catRows.map((row, i) => {
                const ppvNorm  = normPpv(row.ppv);
                const sensNorm = normSens(row.sensitivity);
                const ppvColor  = heatColor(ppvNorm,  row.ppv == null);
                const sensColor = heatColor(sensNorm, row.sensitivity == null);
                return (
                  <tr key={row.estrategia} className={`border-b border-slate-100 ${i % 2 !== 0 ? 'bg-slate-50/20' : ''}`}>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                      {row.estrategia}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500 text-right tabular-nums">
                      {row.calls != null ? Math.round(row.calls) : '—'}
                    </td>
                    <td className="px-1 py-1">
                      <div
                        className="w-full h-8 flex items-center justify-center font-mono text-xs font-semibold tabular-nums"
                        style={{ background: ppvColor.bg, color: ppvColor.text }}
                      >
                        {fmt(row.ppv)}
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div
                        className="w-full h-8 flex items-center justify-center font-mono text-xs font-semibold tabular-nums"
                        style={{ background: sensColor.bg, color: sensColor.text }}
                      >
                        {fmt(row.sensitivity)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      {/* Escala de cor */}
      <div className="flex items-center gap-3 px-3 pt-3 pb-1">
        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Escala</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-400">Menor</span>
          <div className="w-24 h-3" style={{
            background: 'linear-gradient(to right, rgb(255,255,255), rgb(30,64,175))'
          }} />
          <span className="text-[10px] text-slate-400">Maior</span>
        </div>
        <span className="text-[10px] text-slate-400">· normalizado por coluna</span>
      </div>
    </div>
  );
}

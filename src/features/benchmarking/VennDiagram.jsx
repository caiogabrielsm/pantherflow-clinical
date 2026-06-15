import React from 'react';

// ── Derivação das 7 regiões exclusivas a partir de tabela_consenso ────────────
function deriveRegions(dados) {
  // Agrega por estratégia somando todas as amostras (aproximação para o global)
  const totals = {};
  for (const row of dados) {
    if (!row.estrategia || row.estrategia.includes('∪') || row.estrategia === 'União Total') continue;
    totals[row.estrategia] = (totals[row.estrategia] ?? 0) + (row.calls ?? 0);
  }

  const callers = Object.keys(totals).filter(k => !k.includes('∩')).sort();
  if (callers.length < 2) return null;

  const get = (...names) => {
    // tenta todas as permutações dos nomes para achar o label
    const perms = permutations(names);
    for (const p of perms) {
      const key = p.join(' ∩ ');
      if (totals[key] != null) return totals[key];
    }
    return 0;
  };

  if (callers.length === 2) {
    const [A, B] = callers;
    const nA = totals[A] ?? 0, nB = totals[B] ?? 0;
    const nAB = get(A, B);
    return { type: 2, callers, onlyA: nA - nAB, onlyB: nB - nAB, AB: nAB, totalA: nA, totalB: nB };
  }

  const [A, B, C] = callers;
  const nA = totals[A] ?? 0, nB = totals[B] ?? 0, nC = totals[C] ?? 0;
  const nAB = get(A, B), nAC = get(A, C), nBC = get(B, C), nABC = get(A, B, C);

  return {
    type: 3, callers,
    onlyA:  Math.max(0, nA - nAB - nAC + nABC),
    onlyB:  Math.max(0, nB - nAB - nBC + nABC),
    onlyC:  Math.max(0, nC - nAC - nBC + nABC),
    onlyAB: Math.max(0, nAB - nABC),
    onlyAC: Math.max(0, nAC - nABC),
    onlyBC: Math.max(0, nBC - nABC),
    ABC:    nABC,
    totalA: nA, totalB: nB, totalC: nC,
  };
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((v, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(p => [v, ...p]));
}

// ── Venn de 3 círculos ────────────────────────────────────────────────────────
function Venn3({ regions }) {
  const { callers, onlyA, onlyB, onlyC, onlyAB, onlyAC, onlyBC, ABC, totalA, totalB, totalC } = regions;
  const [A, B, C] = callers;

  const W = 520, H = 400, r = 100;
  const cxA = 188, cyA = 148;
  const cxB = 318, cyB = 148;
  const cxC = 253, cyC = 243;

  const COLORS = [
    { fill: '#7ba3d4', stroke: '#5a82b3', label: '#2c4a7a' },
    { fill: '#7dc47a', stroke: '#5aaa57', label: '#2a5e2a' },
    { fill: '#e8c47a', stroke: '#c8a050', label: '#7a5010' },
  ];

  const num = (n) => (n ?? 0).toLocaleString();

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%"
      className="block select-none"
      style={{ fontFamily: 'DejaVu Sans, Liberation Sans, Arial, sans-serif' }}
      aria-label="Diagrama de Venn — comparação de callers"
    >
      <rect width={W} height={H} fill="white" />

      {/* Círculos */}
      {[
        { cx: cxA, cy: cyA, ...COLORS[0] },
        { cx: cxB, cy: cyB, ...COLORS[1] },
        { cx: cxC, cy: cyC, ...COLORS[2] },
      ].map(({ cx, cy, fill, stroke }, i) => (
        <circle key={i} cx={cx} cy={cy} r={r}
          fill={fill} fillOpacity="0.28"
          stroke={stroke} strokeWidth="1.4" strokeOpacity="0.80" />
      ))}

      {/* Rótulos acima de cada círculo */}
      <text x={cxA - 30} y={cyA - r - 20} textAnchor="middle" fontSize="14" fontWeight="600" fill={COLORS[0].label}>{A}</text>
      <text x={cxA - 30} y={cyA - r - 5}  textAnchor="middle" fontSize="12" fill={COLORS[0].label}>{num(totalA)}</text>

      <text x={cxB + 30} y={cyB - r - 20} textAnchor="middle" fontSize="14" fontWeight="600" fill={COLORS[1].label}>{B}</text>
      <text x={cxB + 30} y={cyB - r - 5}  textAnchor="middle" fontSize="12" fill={COLORS[1].label}>{num(totalB)}</text>

      <text x={cxC} y={cyC + r + 24} textAnchor="middle" fontSize="14" fontWeight="600" fill={COLORS[2].label}>{C}</text>
      <text x={cxC} y={cyC + r + 39} textAnchor="middle" fontSize="12" fill={COLORS[2].label}>{num(totalC)}</text>

      {/* Números nas 7 regiões */}
      {/* Exclusivo A */}
      <text x={132} y={152} textAnchor="middle" fontSize="20" fontWeight="bold" fill="#1a1a2e">{num(onlyA)}</text>
      {/* Exclusivo B */}
      <text x={374} y={152} textAnchor="middle" fontSize="20" fontWeight="bold" fill="#1a1a2e">{num(onlyB)}</text>
      {/* Exclusivo C */}
      <text x={253} y={334} textAnchor="middle" fontSize="20" fontWeight="bold" fill="#1a1a2e">{num(onlyC)}</text>
      {/* A∩B apenas */}
      <text x={253} y={112} textAnchor="middle" fontSize="17" fontWeight="bold" fill="#1a1a2e">{num(onlyAB)}</text>
      {/* A∩C apenas */}
      <text x={192} y={228} textAnchor="middle" fontSize="17" fontWeight="bold" fill="#1a1a2e">{num(onlyAC)}</text>
      {/* B∩C apenas */}
      <text x={314} y={228} textAnchor="middle" fontSize="17" fontWeight="bold" fill="#1a1a2e">{num(onlyBC)}</text>
      {/* Tripla interseção */}
      <text x={253} y={192} textAnchor="middle" fontSize="16" fontWeight="bold" fill="#1a1a2e">{num(ABC)}</text>
    </svg>
  );
}

// ── Venn de 2 círculos (PantherFlow × Ion Reporter ou 2 callers) ───────────────
function Venn2({ regions, labelA = 'PantherFlow', labelB = 'Ion Reporter' }) {
  const W = 520, H = 300;
  const rxA = 120, ryA = 105, rxB = 150, ryB = 115;
  const cy = 158, cxA = 198, cxB = 330;
  const colA = '#7ba3d4', colB = '#7dc47a';

  const { onlyA, AB, onlyB, totalA, totalB } = regions ?? {};
  const [la, lb] = regions?.callers ?? [labelA, labelB];
  const num = (n) => (n ?? 0).toLocaleString();

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
      className="block select-none"
      style={{ fontFamily: 'DejaVu Sans, Liberation Sans, Arial, sans-serif' }}
    >
      <rect width={W} height={H} fill="white" />

      <ellipse cx={cxA} cy={cy} rx={rxA} ry={ryA} fill={colA} fillOpacity="0.35" stroke={colA} strokeWidth="1.4" strokeOpacity="0.85" />
      <ellipse cx={cxB} cy={cy} rx={rxB} ry={ryB} fill={colB} fillOpacity="0.30" stroke={colB} strokeWidth="1.4" strokeOpacity="0.85" />

      <text x={cxA} y={cy - ryA - 18} textAnchor="middle" fontSize="14" fontWeight="600" fill="#2c4a7a">{la}</text>
      <text x={cxA} y={cy - ryA - 4}  textAnchor="middle" fontSize="12" fill="#2c4a7a">{num(totalA ?? (onlyA + AB))}</text>

      <text x={cxB} y={cy - ryB - 18} textAnchor="middle" fontSize="14" fontWeight="600" fill="#2a5e2a">{lb}</text>
      <text x={cxB} y={cy - ryB - 4}  textAnchor="middle" fontSize="12" fill="#2a5e2a">{num(totalB ?? (AB + onlyB))}</text>

      <text x={130} y={cy + 6} textAnchor="middle" fontSize="22" fontWeight="bold" fill="#1a1a2e">{num(onlyA)}</text>
      <text x={(cxA + cxB) / 2} y={cy + 6} textAnchor="middle" fontSize="22" fontWeight="bold" fill="#1a1a2e">{num(AB)}</text>
      <text x={400} y={cy + 6} textAnchor="middle" fontSize="22" fontWeight="bold" fill="#1a1a2e">{num(onlyB)}</text>
    </svg>
  );
}

// ── Componente exportado ──────────────────────────────────────────────────────
export default function VennDiagram({ dados = [], tp = 0, fp = 0, fn = 0 }) {
  const regions = dados.length > 0 ? deriveRegions(dados) : null;

  if (regions?.type === 3) return <Venn3 regions={regions} />;

  if (regions?.type === 2) return <Venn2 regions={regions} />;

  // Fallback: PantherFlow vs Ion Reporter
  return (
    <Venn2
      regions={{ onlyA: fp, AB: tp, onlyB: fn, totalA: fp + tp, totalB: fn + tp }}
      labelA="PantherFlow"
      labelB="Ion Reporter"
    />
  );
}

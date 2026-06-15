import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';

const PAGE_SIZE = 15;

function StatusBadge({ status }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-mono font-bold border border-slate-300 text-slate-600 bg-white whitespace-nowrap">
      {status === 'FP' ? 'FP · PantherFlow' : 'FN · Ion Reporter'}
    </span>
  );
}

function ImpactoBadge({ impacto }) {
  if (!impacto || impacto === '—') return <span className="text-slate-300">—</span>;
  return (
    <span className="inline-flex px-1.5 py-0.5 text-[10px] font-bold border border-slate-300 text-slate-600 bg-white whitespace-nowrap">
      {impacto}
    </span>
  );
}

function VafCell({ value }) {
  if (value == null) return <span className="text-slate-300">—</span>;
  return (
    <span className="font-mono font-semibold tabular-nums text-slate-700">
      {(value * 100).toFixed(1)}%
    </span>
  );
}

export default function DiscordanceTable({ dados = [] }) {
  const [page,       setPage]       = useState(1);
  const [filtroTipo, setFiltroTipo] = useState('Todos');

  const getStatus = (d) => d.status ?? d.tipo ?? '—';

  const dadosFiltrados = useMemo(() =>
    filtroTipo === 'Todos' ? dados : dados.filter(d => getStatus(d) === filtroTipo),
    [dados, filtroTipo]
  );

  const totalPages  = Math.max(1, Math.ceil(dadosFiltrados.length / PAGE_SIZE));
  const paginaAtual = Math.min(page, totalPages);
  const slice       = dadosFiltrados.slice((paginaAtual - 1) * PAGE_SIZE, paginaAtual * PAGE_SIZE);

  const nFp = dados.filter(d => getStatus(d) === 'FP').length;
  const nFn = dados.filter(d => getStatus(d) === 'FN').length;

  const handleFiltro = (tipo) => { setFiltroTipo(tipo); setPage(1); };

  if (dados.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
        <AlertTriangle size={24} className="text-slate-300" />
        <p className="text-sm">Sem discordâncias encontradas para os parâmetros selecionados.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">

      {/* Controlos superiores */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex border border-slate-300 overflow-hidden text-xs font-semibold">
          {['Todos', 'FP', 'FN'].map(tipo => (
            <button
              key={tipo}
              onClick={() => handleFiltro(tipo)}
              className={`px-3 py-1.5 transition-colors border-r border-slate-300 last:border-r-0 ${
                filtroTipo === tipo
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {tipo === 'Todos' ? `Todos (${dados.length})` : tipo === 'FP' ? `FP (${nFp})` : `FN (${nFn})`}
            </button>
          ))}
        </div>

        <span className="text-xs text-slate-400 font-mono">
          {Math.min((paginaAtual - 1) * PAGE_SIZE + 1, dadosFiltrados.length)}–{Math.min(paginaAtual * PAGE_SIZE, dadosFiltrados.length)}
          {' '}de{' '}{dadosFiltrados.length}
        </span>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto border border-slate-200">
        <table className="w-full text-sm text-left border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-300">
              <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Amostra</th>
              <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Gene</th>
              <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Locus (hg38)</th>
              <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Status</th>
              <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Tipo Var.</th>
              <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Efeito Funcional</th>
              <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Impacto</th>
              <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">VAF Panther</th>
              <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">VAF Ion</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((d, i) => {
              const status = getStatus(d);
              return (
                <tr
                  key={i}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i % 2 !== 0 ? 'bg-slate-50/40' : ''}`}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">{d.amostra}</td>
                  <td className="px-4 py-2.5 font-bold text-xs text-slate-800 whitespace-nowrap">{d.gene ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-400 whitespace-nowrap">{d.locus ?? '—'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <StatusBadge status={status} />
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {d.tipo_variante && d.tipo_variante !== '—'
                      ? <span className="text-xs font-mono font-semibold border border-slate-300 px-1.5 py-0.5 text-slate-600 bg-white">{d.tipo_variante}</span>
                      : <span className="text-slate-300 text-xs">—</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600 max-w-[200px] truncate" title={d.efeito_funcional}>
                    {d.efeito_funcional && d.efeito_funcional !== '—'
                      ? d.efeito_funcional.replace(/_/g, ' ')
                      : <span className="text-slate-300">—</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <ImpactoBadge impacto={d.impacto} />
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap"><VafCell value={d.vaf_panther} /></td>
                  <td className="px-4 py-2.5 whitespace-nowrap"><VafCell value={d.vaf_ion} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <button
            disabled={paginaAtual === 1}
            onClick={() => setPage(p => p - 1)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-slate-300
                       text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={13} /> Anterior
          </button>
          <span className="text-xs text-slate-400 font-mono">
            {paginaAtual} / {totalPages}
          </span>
          <button
            disabled={paginaAtual === totalPages}
            onClick={() => setPage(p => p + 1)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-slate-300
                       text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Seguinte <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

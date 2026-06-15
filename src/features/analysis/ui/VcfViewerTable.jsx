import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, ShieldCheck } from 'lucide-react';

// --- Helpers ---

const _isPass = (filter) => !filter || filter === '.' || filter === 'PASS';

function FilterBadge({ filter }) {
  if (_isPass(filter)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
        PASS
      </span>
    );
  }
  const isLowQuality = /low|artifact|weak|strand|contamination/i.test(filter);
  return (
    <span
      title={filter}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border truncate max-w-[140px] ${
        isLowQuality
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-slate-100 text-slate-600 border-slate-200'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full inline-block shrink-0 ${isLowQuality ? 'bg-amber-400' : 'bg-slate-400'}`} />
      {filter.length > 22 ? filter.slice(0, 22) + '…' : filter}
    </span>
  );
}

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col) return <ChevronsUpDown size={12} className="text-slate-300" />;
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="text-violet-500" />
    : <ChevronDown size={12} className="text-violet-500" />;
}

const COLS = [
  { key: 'chrom',  label: 'Cromossomo'   },
  { key: 'pos',    label: 'Posição'       },
  { key: 'ref',    label: 'Ref'           },
  { key: 'alt',    label: 'Alt'           },
  { key: 'gene',   label: 'Gene'          },
  { key: 'effect', label: 'Consequência'  },
  { key: 'hgvs_p', label: 'HGVSp'        },
  { key: 'filter', label: 'Filtro'        },
];

const PAGE_SIZE = 50;

// --- Componente principal ---
// Props:
//   uuid    {string}  — patient_uuid da análise (obrigatório para o fetch)
//   caller  {string}  — 'consensus' | 'varscan' | 'mutect' | 'lofreq' (default: 'consensus')

// externalVariants: quando fornecido, ignora o fetch e usa os dados diretamente.
// Permite reutilização do componente como visualizador standalone (sem uuid).
export default function VcfViewerTable({ uuid, caller = 'consensus', externalVariants }) {
  const isExternal = externalVariants !== undefined;

  // --- Dados remotos (apenas no modo uuid) ---
  const [variants,  setVariants]  = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [erro,      setErro]      = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [totalRaw,  setTotalRaw]  = useState(0);

  // --- Filtros locais ---
  const [busca,     setBusca]     = useState('');
  const [soPassar,  setSoPassar]  = useState(false);

  // --- Ordenação e paginação ---
  const [sortCol, setSortCol] = useState('chrom');
  const [sortDir, setSortDir] = useState('asc');
  const [page,    setPage]    = useState(1);

  // Fonte efetiva de dados: prop externa tem prioridade sobre o estado interno do fetch
  const dataSource = isExternal ? externalVariants : variants;

  // --- Fetch (apenas no modo uuid) ---
  const fetchVariants = useCallback(async () => {
    if (isExternal || !uuid) return;
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch(
        `http://localhost:8000/api/analysis/${uuid}/vcf-viewer?caller=${caller}&limite=2000`
      );
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `Erro ${res.status}`);
      }
      const data = await res.json();
      setVariants(data.variants ?? []);
      setTruncated(data.truncated ?? false);
      setTotalRaw(data.total ?? 0);
    } catch (e) {
      setErro(e.message);
      setVariants([]);
    } finally {
      setLoading(false);
    }
  }, [uuid, caller, isExternal]);

  useEffect(() => {
    setBusca('');
    setSoPassar(false);
    setPage(1);
    fetchVariants();
  }, [fetchVariants]);

  // --- Lógica de filtro encadeada ---
  const filtradas = useMemo(() => {
    let lista = dataSource;

    // 1. Filtro PASS
    if (soPassar) lista = lista.filter(v => _isPass(v.filter));

    // 2. Busca textual
    const termo = busca.trim().toLowerCase();
    if (termo) {
      lista = lista.filter(v =>
        (v.gene   ?? '').toLowerCase().includes(termo) ||
        (v.chrom  ?? '').toLowerCase().includes(termo) ||
        (v.effect ?? '').toLowerCase().includes(termo) ||
        (v.hgvs_p ?? '').toLowerCase().includes(termo) ||
        (v.hgvs_c ?? '').toLowerCase().includes(termo) ||
        String(v.pos ?? '').includes(termo)
      );
    }

    return lista;
  }, [dataSource, busca, soPassar]);

  const ordenadas = useMemo(() => {
    return [...filtradas].sort((a, b) => {
      let va = a[sortCol] ?? '';
      let vb = b[sortCol] ?? '';
      if (sortCol === 'pos') { va = Number(va); vb = Number(vb); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }, [filtradas, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(ordenadas.length / PAGE_SIZE));
  const pageSlice  = ordenadas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setPage(1);
  };

  const handleBusca = (e) => { setBusca(e.target.value); setPage(1); };

  const passCount = useMemo(() => dataSource.filter(v => _isPass(v.filter)).length, [dataSource]);

  // --- Render ---
  return (
    <div className="flex flex-col gap-3">

      {/* Barra de controles */}
      <div className="flex items-center gap-3 flex-wrap">

        {/* Busca */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar gene, cromossomo, consequência…"
            value={busca}
            onChange={handleBusca}
            disabled={loading}
            className="w-full pl-8 pr-8 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 disabled:opacity-50"
          />
          {busca && (
            <button
              onClick={() => { setBusca(''); setPage(1); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
            >✕</button>
          )}
        </div>

        {/* Toggle PASS */}
        <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer select-none transition-colors text-xs font-semibold ${
          soPassar
            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
        }`}>
          <div
            onClick={() => { setSoPassar(v => !v); setPage(1); }}
            className={`relative w-8 h-4 rounded-full transition-colors ${soPassar ? 'bg-emerald-500' : 'bg-slate-200'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${soPassar ? 'translate-x-4' : ''}`} />
          </div>
          <ShieldCheck size={13} className={soPassar ? 'text-emerald-600' : 'text-slate-400'} />
          Somente Alta Qualidade (PASS)
          {!loading && dataSource.length > 0 && (
            <span className={`ml-1 px-1.5 py-0.5 rounded-full font-mono ${soPassar ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {passCount}
            </span>
          )}
        </label>

        {/* Contagem de resultados */}
        <div className="text-xs text-slate-500 ml-auto shrink-0">
          {loading ? (
            <span className="text-slate-400">Carregando…</span>
          ) : erro ? null : (
            <>
              <span className="font-semibold text-slate-700">{filtradas.length}</span>
              {filtradas.length !== dataSource.length && <> de {dataSource.length}</>}
              {' variante'}{filtradas.length !== 1 ? 's' : ''}
              {truncated && (
                <span className="ml-1.5 text-amber-600">(limite: {totalRaw} no arquivo)</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Erro de fetch */}
      {erro && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 flex items-center gap-2">
          <span className="font-bold">Erro ao carregar VCF:</span> {erro}
          <button onClick={fetchVariants} className="ml-auto underline hover:no-underline font-semibold">
            Tentar novamente
          </button>
        </div>
      )}

      {/* Tabela */}
      <div className="w-full overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {COLS.map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:text-violet-600 hover:bg-slate-100 transition-colors"
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-12 text-center text-slate-400 text-sm">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                    Carregando variantes do VCF…
                  </div>
                </td>
              </tr>
            )}

            {!loading && !erro && pageSlice.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-12 text-center text-slate-400 text-sm">
                  {busca || soPassar
                    ? 'Nenhuma variante corresponde aos filtros aplicados.'
                    : 'Nenhuma variante disponível neste VCF.'}
                </td>
              </tr>
            )}

            {!loading && !erro && pageSlice.map((v, i) => (
              <tr key={i} className="hover:bg-violet-50 transition-colors">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600 whitespace-nowrap">{v.chrom}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-700 whitespace-nowrap tabular-nums">{v.pos?.toLocaleString('pt-BR')}</td>
                <td className="px-4 py-2.5 font-mono text-xs font-semibold text-rose-700">{v.ref}</td>
                <td className="px-4 py-2.5 font-mono text-xs font-semibold text-violet-700">{v.alt}</td>
                <td className="px-4 py-2.5 text-xs font-semibold text-slate-800">{v.gene ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600 max-w-[200px] truncate" title={v.effect}>{v.effect ?? '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-500 max-w-[160px] truncate" title={v.hgvs_p}>{v.hgvs_p ?? '—'}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <FilterBadge filter={v.filter} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <button
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Anterior
          </button>
          <span className="text-xs text-slate-500">
            Página <span className="font-semibold text-slate-700">{page}</span> de{' '}
            <span className="font-semibold text-slate-700">{totalPages}</span>
            <span className="text-slate-400 ml-2">({ordenadas.length} variantes)</span>
          </span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Próxima →
          </button>
        </div>
      )}
    </div>
  );
}

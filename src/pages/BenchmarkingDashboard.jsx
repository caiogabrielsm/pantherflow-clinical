import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  TrendingUp, Target, Award, Layers,
  Play, RefreshCw, AlertTriangle, Info,
  ChevronUp, ChevronDown,
  Upload, PlusCircle, CheckCircle2, XCircle, Trash2, Search,
} from 'lucide-react';
import VennDiagram         from '../features/benchmarking/VennDiagram';
import DiscordanceTable      from '../features/benchmarking/DiscordanceTable';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ScatterChart, Scatter, Tooltip, Cell,
} from 'recharts';

// ─── Utilitários ──────────────────────────────────────────────────────────────

const pct  = (v, dec = 1) => v != null ? `${(v * 100).toFixed(dec)}%` : '—';
const fmt4 = (v)           => v != null ? v.toFixed(4)                 : '—';

function corMetrica(v) {
  if (v == null)  return 'slate';
  if (v >= 0.80)  return 'emerald';
  if (v >= 0.60)  return 'amber';
  return 'rose';
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, formatted, sublabel, color = 'slate', icon: Icon }) {
  const barColor = { emerald: 'bg-emerald-500', amber: 'bg-amber-400', rose: 'bg-rose-400', slate: 'bg-slate-300' };
  const bar = barColor[color] ?? barColor.slate;
  const pct_bar = value != null ? Math.round(value * 100) : 0;
  return (
    <div className="border border-slate-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        {Icon && <Icon size={14} className="text-slate-400" />}
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
      </div>
      <span className="text-3xl font-bold font-mono text-slate-800">{formatted}</span>
      <div className="w-full bg-slate-100 h-1 overflow-hidden">
        <div className={`h-full transition-all duration-500 ${bar}`} style={{ width: `${pct_bar}%` }} />
      </div>
      {sublabel && <p className="text-[11px] text-slate-400">{sublabel}</p>}
    </div>
  );
}

// ─── TabelaPorAmostra ─────────────────────────────────────────────────────────

function TabelaPorAmostra({ linhas = [] }) {
  const [sortKey, setSortKey] = useState('f1_score');
  const [sortDir, setSortDir] = useState('desc');

  const sorted = [...linhas].sort((a, b) => {
    const va = a[sortKey] ?? -1;
    const vb = b[sortKey] ?? -1;
    return sortDir === 'desc' ? vb - va : va - vb;
  });

  const maxF1 = Math.max(...linhas.map(l => l.f1_score ?? 0));
  const minF1 = Math.min(...linhas.map(l => l.f1_score ?? 1));

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function SortIcon({ col }) {
    if (sortKey !== col) return <ChevronUp size={11} className="opacity-20" />;
    return sortDir === 'desc'
      ? <ChevronDown size={11} className="text-slate-600" />
      : <ChevronUp   size={11} className="text-slate-600" />;
  }

  const COLS = [
    { key: 'amostra',       label: 'Amostra',       sortable: false },
    { key: 'caller',        label: 'Caller',         sortable: false },
    { key: 'parametro',     label: 'Parâmetro',      sortable: false },
    { key: 'tsv_tipo',      label: 'TSV Ion',        sortable: false },
    { key: 'n_ion',         label: 'N Ion',          sortable: true  },
    { key: 'tp',            label: 'TP',             sortable: true  },
    { key: 'fp',            label: 'FP',             sortable: true  },
    { key: 'fn',            label: 'FN',             sortable: true  },
    { key: 'sensibilidade', label: 'Sens.',           sortable: true  },
    { key: 'precisao',      label: 'Prec.',           sortable: true  },
    { key: 'f1_score',      label: 'F1-Score',       sortable: true  },
    { key: 'jaccard',       label: 'Jaccard',        sortable: true  },
    { key: 'rmse_vaf',      label: 'RMSE VAF',       sortable: true  },
    { key: 'spearman_rho',  label: 'Spearman ρ',     sortable: true  },
    { key: 'pearson_r',     label: 'Pearson r',      sortable: true  },
    { key: 'vaf_medio_tp',  label: 'VAF Médio TP',  sortable: true  },
  ];

  if (!linhas.length) return null;

  return (
    <div className="overflow-x-auto border border-slate-200">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-300">
            {COLS.map(c => (
              <th
                key={c.key}
                onClick={() => c.sortable && handleSort(c.key)}
                className={`px-3 py-2 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap text-left
                            ${c.sortable ? 'cursor-pointer hover:text-slate-700 select-none' : ''}`}
              >
                <span className="flex items-center gap-1">
                  {c.label}
                  {c.sortable && <SortIcon col={c.key} />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {sorted.map((row, i) => {
            const isTop    = row.f1_score === maxF1 && linhas.length > 1;
            const isBottom = row.f1_score === minF1 && linhas.length > 1;
            const rowCls = isTop ? 'border-l-2 border-l-emerald-400' : isBottom ? 'border-l-2 border-l-slate-300' : '';
            return (
              <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${rowCls}`}>
                <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">
                  {row.amostra}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold border border-slate-300 text-slate-600 bg-white">
                    {row.caller}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">{row.parametro}</td>
                <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{row.tsv_tipo}</td>
                <td className="px-3 py-2 text-xs text-center whitespace-nowrap">
                  <span className="font-mono font-bold text-slate-700">{row.n_ion ?? '—'}</span>
                  {row.n_ion != null && row.n_ion < 15 && (
                    <span className="ml-1.5 text-[9px] font-bold text-slate-400 border border-slate-300 px-1" title="N baixo — F1 com alta variância">N!</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-700 font-semibold tabular-nums text-center">{row.tp}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500 tabular-nums text-center">{row.fp}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500 tabular-nums text-center">{row.fn}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 tabular-nums">{pct(row.sensibilidade)}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 tabular-nums">{pct(row.precisao)}</td>
                <td className="px-3 py-2 font-mono text-xs font-bold tabular-nums text-slate-800">
                  {fmt4(row.f1_score)}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 tabular-nums">{fmt4(row.jaccard)}</td>
                <td className="px-3 py-2 font-mono text-xs tabular-nums text-center text-slate-600">
                  {row.rmse_vaf != null ? pct(row.rmse_vaf) : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 tabular-nums text-center">
                  {row.spearman_rho != null ? fmt4(row.spearman_rho) : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 tabular-nums text-center">
                  {row.pearson_r != null ? fmt4(row.pearson_r) : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500 tabular-nums">
                  {row.vaf_medio_tp != null ? pct(row.vaf_medio_tp) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── TabelaPerformanceEstrategias ────────────────────────────────────────────

const CALLER_ABBREV = { Mutect2: 'MT', VarScan2: 'VS', LoFreq: 'LF', Consensus: 'CN' };

function abreviar(s) {
  let r = s;
  for (const [full, abbr] of Object.entries(CALLER_ABBREV)) r = r.replaceAll(full, abbr);
  return r;
}

function categoriaEstrategia(s) {
  if (s.includes('∩')) return 'intersect';
  if (s.includes('∪') || s.toLowerCase().includes('uni')) return 'union';
  return 'single';
}

function TabelaPerformanceEstrategias({ dados = [] }) {
  if (!dados.length) return null;

  const grupos = dados.reduce((acc, row) => {
    (acc[row.amostra] ??= []).push(row);
    return acc;
  }, {});

  const CATEGORY_LABEL = {
    single:    'Callers Individuais — cada algoritmo usado sozinho',
    intersect: 'Interseção — variantes detectadas por mais de um caller simultaneamente',
    union:     'União — todas as variantes detectadas por pelo menos um caller',
  };

  return (
    <div className="space-y-4">
      {Object.entries(grupos).map(([amostra, rows]) => {
        const maxPpv  = Math.max(...rows.map(r => r.ppv  ?? -1));
        const maxSens = Math.max(...rows.map(r => r.sensitivity ?? -1));

        const callersIncluidos = rows
          .filter(r => categoriaEstrategia(r.estrategia) === 'single')
          .map(r => r.estrategia);

        let lastCat = null;
        const rowsWithSep = rows.map(r => {
          const cat = categoriaEstrategia(r.estrategia);
          const sep = cat !== lastCat;
          lastCat = cat;
          return { ...r, cat, sep };
        });

        return (
          <div key={amostra} className="bg-white border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3 flex-wrap">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Amostra</span>
              <span className="font-mono font-semibold text-slate-800 text-sm">{amostra}</span>
              <span className="text-slate-300">|</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Callers</span>
              <div className="flex gap-1.5">
                {callersIncluidos.map(c => (
                  <span key={c} className="text-[10px] font-mono font-semibold border border-slate-300 px-1.5 py-0.5 text-slate-600 bg-white">
                    {c}
                  </span>
                ))}
              </div>
              <span className="ml-auto text-[10px] text-slate-400 font-mono">{rows.length} estratégias</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-300">
                    <th className="px-3 py-2 text-left">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Estratégia</div>
                      <div className="text-[10px] font-normal text-slate-400 normal-case tracking-normal mt-0.5">combinação de callers utilizada</div>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Calls</div>
                      <div className="text-[10px] font-normal text-slate-400 normal-case tracking-normal mt-0.5">variantes chamadas</div>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Confirmadas</div>
                      <div className="text-[10px] font-normal text-slate-400 normal-case tracking-normal mt-0.5">presentes no Ion Reporter</div>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Precisão (PPV)</div>
                      <div className="text-[10px] font-normal text-slate-400 normal-case tracking-normal mt-0.5">Confirmadas / Calls</div>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Sensibilidade</div>
                      <div className="text-[10px] font-normal text-slate-400 normal-case tracking-normal mt-0.5">Confirmadas / Total Ion</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rowsWithSep.map((row, i) => {
                    const isBestPpv  = row.ppv  === maxPpv  && maxPpv  > 0;
                    const isBestSens = row.sensitivity === maxSens && maxSens > 0;

                    return (
                      <React.Fragment key={i}>
                        {row.sep && (
                          <tr>
                            <td colSpan={5} className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 border-t border-b border-slate-200 bg-slate-50 italic">
                              {CATEGORY_LABEL[row.cat]}
                            </td>
                          </tr>
                        )}
                        <tr className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i % 2 !== 0 ? 'bg-slate-50/30' : ''}`}>
                          <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                            {row.estrategia}
                            {isBestPpv && isBestSens && <span className="ml-2 text-[9px] font-bold border border-slate-400 px-1 py-0.5 text-slate-600">melhor geral</span>}
                            {isBestPpv && !isBestSens && <span className="ml-2 text-[9px] font-bold border border-slate-400 px-1 py-0.5 text-slate-600">maior precisão</span>}
                            {isBestSens && !isBestPpv && <span className="ml-2 text-[9px] font-bold border border-slate-400 px-1 py-0.5 text-slate-600">maior sensibilidade</span>}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-600 text-right tabular-nums">{row.calls ?? '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-600 text-right tabular-nums">{row.valid ?? '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs text-right tabular-nums font-semibold text-slate-800">
                            {row.ppv != null ? row.ppv.toFixed(3) : '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-right tabular-nums font-semibold text-slate-800">
                            {row.sensitivity != null ? row.sensitivity.toFixed(3) : '—'}
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Figura 6 — Sensibilidade Paramétrica (imagem backend) ───────────────────

function SensibilidadeParametricaImg({ imagem }) {
  if (!imagem) return null;
  return (
    <div className="bg-white border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200">
        <h3 className="text-sm font-bold text-slate-800">Figura 6 — Sensibilidade Paramétrica por Amostra</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Impacto do endurecimento dos limiares de DP e VAF · VarScan2 vs Mutect2 · permissivo (DP20·VAF2%) vs restritivo (DP30·VAF5%)
        </p>
      </div>
      <div className="p-4">
        <img
          src={`data:image/png;base64,${imagem}`}
          alt="Figura 6 — Sensibilidade Paramétrica por Amostra"
          className="w-full h-auto"
          style={{ imageRendering: 'auto' }}
        />
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function BenchmarkingDashboard() {
  const location = useLocation();

  // ── Figura 6 — imagem matplotlib do backend ──────────────────────────────
  const [imagemSensibilidade, setImagemSensibilidade] = useState(null);
  useEffect(() => {
    fetch('http://localhost:8000/api/v1/benchmarking/sensibilidade-parametrica')
      .then(r => r.json())
      .then(d => setImagemSensibilidade(d.imagem || null))
      .catch(() => {});
  }, []);

  // ── Descoberta de arquivos ─────────────────────────────────────────────────
  const [vcfsDisponiveis, setVcfsDisponiveis] = useState([]);
  const [tsvsDisponiveis, setTsvsDisponiveis] = useState([]);
  const [loadingArquivos, setLoadingArquivos] = useState(true);

  // ── Filtros do banco de pares ─────────────────────────────────────────────
  const [filtroAmostra,    setFiltroAmostra]    = useState('');
  const [filtroCallers,    setFiltroCallers]    = useState(new Set());
  const [filtroTsvTipo,    setFiltroTsvTipo]    = useState('');
  const [filtroParametro,  setFiltroParametro]  = useState('');

  // ── Lote de pares montado pelo usuário ────────────────────────────────────
  const [loteAtual, setLoteAtual] = useState([]);

  // ── Upload de novo TSV ────────────────────────────────────────────────────
  const [uploadAberto,   setUploadAberto]   = useState(false);
  const [uploadNome,     setUploadNome]     = useState('');
  const [uploadArquivo,  setUploadArquivo]  = useState(null);
  const [uploadLoading,  setUploadLoading]  = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState(null);
  const fileInputRef = useRef(null);

  // ── Execução e resultados ─────────────────────────────────────────────────
  const [resultado, setResultado] = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [notaAberta,  setNotaAberta]  = useState(false);
  const [tab1Aberta,  setTab1Aberta]  = useState(false);
  const [tab2Aberta,  setTab2Aberta]  = useState(false);
  const [tab3Aberta,  setTab3Aberta]  = useState(false);
  const [tab4Aberta,  setTab4Aberta]  = useState(false);
  const [erro,      setErro]      = useState(null);

  // ── Carregar arquivos disponíveis ─────────────────────────────────────────
  const carregarArquivos = useCallback(() => {
    setLoadingArquivos(true);
    fetch('http://localhost:8000/api/v1/benchmarking/arquivos_disponiveis')
      .then(r => r.json())
      .then(data => {
        setVcfsDisponiveis(data.vcfs ?? []);
        setTsvsDisponiveis(data.tsvs ?? []);
      })
      .catch(e => setErro('Falha ao carregar arquivos: ' + e.message))
      .finally(() => setLoadingArquivos(false));
  }, []);

  useEffect(() => { carregarArquivos(); }, [carregarArquivos, location.key]);

  // ── Banco de pares: cross-join VCF × TSV por nome_amostra ─────────────────
  const todosOsPares = useMemo(() => {
    const pares = [];
    for (const vcf of vcfsDisponiveis) {
      const tsvs = tsvsDisponiveis.filter(t => t.nome_amostra === vcf.nome_amostra);
      for (const tsv of tsvs) {
        pares.push({ amostra: vcf.nome_amostra, vcf, tsv });
      }
    }
    return pares.sort((a, b) =>
      a.amostra.localeCompare(b.amostra) ||
      a.tsv.tipo.localeCompare(b.tsv.tipo) ||
      a.vcf.parametro.localeCompare(b.vcf.parametro) ||
      a.vcf.caller.localeCompare(b.vcf.caller)
    );
  }, [vcfsDisponiveis, tsvsDisponiveis]);

  const callersDisponiveis  = useMemo(() =>
    [...new Set(todosOsPares.map(p => p.vcf.caller))].sort(), [todosOsPares]);
  const parametrosDisponiveis = useMemo(() =>
    [...new Set(todosOsPares.map(p => p.vcf.parametro))].sort(), [todosOsPares]);
  const tiposDisponiveis = useMemo(() =>
    [...new Set(todosOsPares.map(p => p.tsv.tipo))].sort(), [todosOsPares]);

  const temFiltroAtivo = filtroAmostra.trim() || filtroCallers.size > 0 || filtroTsvTipo || filtroParametro;

  const limparFiltros = useCallback(() => {
    setFiltroAmostra('');
    setFiltroCallers(new Set());
    setFiltroTsvTipo('');
    setFiltroParametro('');
  }, []);

  const toggleCaller = useCallback((caller) => {
    setFiltroCallers(prev => {
      const next = new Set(prev);
      next.has(caller) ? next.delete(caller) : next.add(caller);
      return next;
    });
  }, []);

  const paresFiltrados = useMemo(() => {
    const q = filtroAmostra.trim().toLowerCase();
    return todosOsPares.filter(p => {
      if (q && !p.amostra.toLowerCase().includes(q) && !(p.vcf.uuid ?? '').toLowerCase().includes(q)) return false;
      if (filtroCallers.size > 0 && !filtroCallers.has(p.vcf.caller)) return false;
      if (filtroTsvTipo && p.tsv.tipo !== filtroTsvTipo) return false;
      if (filtroParametro && p.vcf.parametro !== filtroParametro) return false;
      return true;
    });
  }, [todosOsPares, filtroAmostra, filtroCallers, filtroTsvTipo, filtroParametro]);

  // ── Adicionar par ao lote ─────────────────────────────────────────────────
  const adicionarPar = useCallback((par) => {
    const novoPar = {
      amostra:   par.amostra,
      vcf_path:  par.vcf.path,
      tsv_path:  par.tsv.path,
      caller:    par.vcf.caller,
      tsv_tipo:  par.tsv.tipo,
      parametro: par.vcf.parametro,
    };
    const jaExiste = loteAtual.some(
      p => p.vcf_path === novoPar.vcf_path && p.tsv_path === novoPar.tsv_path
    );
    if (!jaExiste) setLoteAtual(prev => [...prev, novoPar]);
  }, [loteAtual]);

  const adicionarTodosVisiveis = useCallback(() => {
    setLoteAtual(prev => {
      const novos = paresFiltrados
        .map(par => ({
          amostra:   par.amostra,
          vcf_path:  par.vcf.path,
          tsv_path:  par.tsv.path,
          caller:    par.vcf.caller,
          tsv_tipo:  par.tsv.tipo,
          parametro: par.vcf.parametro,
        }))
        .filter(novo => !prev.some(
          p => p.vcf_path === novo.vcf_path && p.tsv_path === novo.tsv_path
        ));
      return [...prev, ...novos];
    });
  }, [paresFiltrados]);

  const removerDoLote = (idx) => setLoteAtual(prev => prev.filter((_, i) => i !== idx));
  const limparLote    = ()    => setLoteAtual([]);

  // ── Upload de novo TSV ────────────────────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!uploadArquivo || !uploadNome.trim()) return;
    setUploadLoading(true);
    setUploadFeedback(null);
    try {
      const form = new FormData();
      form.append('file', uploadArquivo);
      form.append('nome_amostra', uploadNome.trim());
      const res  = await fetch('http://localhost:8000/api/v1/benchmarking/upload', {
        method: 'POST', body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail ?? `Erro ${res.status}`);
      setUploadFeedback({ ok: true, msg: data.mensagem });
      setUploadNome('');
      setUploadArquivo(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      carregarArquivos();
    } catch (e) {
      setUploadFeedback({ ok: false, msg: e.message });
    } finally {
      setUploadLoading(false);
    }
  }, [uploadArquivo, uploadNome, carregarArquivos]);

  // ── Rodar benchmarking ────────────────────────────────────────────────────
  const handleRodar = useCallback(async () => {
    if (!loteAtual.length) return;
    setLoading(true);
    setErro(null);
    setResultado(null);
    try {
      const pares = loteAtual.map(({ amostra, vcf_path, tsv_path, caller, tsv_tipo, parametro }) => ({
        amostra, vcf_path, tsv_path, caller, tsv_tipo, parametro,
      }));
      const res = await fetch('http://localhost:8000/api/v1/benchmarking/analisar_lote', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pares }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        const msg = typeof detail.detail === 'string'
          ? detail.detail
          : detail.detail != null
            ? JSON.stringify(detail.detail)
            : `Erro ${res.status}`;
        throw new Error(msg);
      }
      setResultado(await res.json());
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [loteAtual]);

  // ── Agregação global ──────────────────────────────────────────────────────
  const agregado = useMemo(() => {
    const pares = resultado?.metricas_por_par;
    if (!pares?.length) return null;
    const tp = pares.reduce((s, p) => s + (p.tp ?? 0), 0);
    const fp = pares.reduce((s, p) => s + (p.fp ?? 0), 0);
    const fn = pares.reduce((s, p) => s + (p.fn ?? 0), 0);
    const rmseVals = pares.map(p => p.rmse_vaf).filter(v => v != null);
    const rmse_medio = rmseVals.length ? rmseVals.reduce((a, b) => a + b, 0) / rmseVals.length : null;
    const spearVals  = pares.map(p => p.spearman_rho).filter(v => v != null);
    const spearman_medio = spearVals.length ? spearVals.reduce((a, b) => a + b, 0) / spearVals.length : null;
    return {
      tp, fp, fn,
      sensibilidade:   tp + fn > 0          ? tp / (tp + fn)               : null,
      precisao:        tp + fp > 0          ? tp / (tp + fp)               : null,
      f1_score:        2 * tp + fp + fn > 0 ? 2 * tp / (2 * tp + fp + fn) : null,
      jaccard:         tp + fp + fn > 0     ? tp / (tp + fp + fn)          : null,
      rmse_medio,
      spearman_medio,
    };
  }, [resultado]);

  // ── Derivações dos dados de gráficos ──────────────────────────────────────
  const vennData          = resultado?.dados_graficos?.venn_global              ?? resultado?.venn_data;
  const scatterData       = resultado?.dados_graficos?.scatter_global            ?? resultado?.scatter_data;
  const discordantesVaf   = resultado?.dados_graficos?.discordantes_vaf          ?? resultado?.discordantes_vaf;
  const detalhamentoDisc  = resultado?.dados_graficos?.detalhamento_discordantes ?? resultado?.detalhamento_discordantes;
  const detalhamentoConc  = resultado?.dados_graficos?.detalhamento_concordantes ?? [];

  // ── LOO por Amostra ───────────────────────────────────────────────────────
  const looAmostra = useMemo(() => {
    const pares = resultado?.metricas_por_par;
    if (!pares?.length || !agregado) return [];
    const amostras = [...new Set(pares.map(p => p.amostra))].sort();
    return amostras.map(amostra => {
      const resto = pares.filter(p => p.amostra !== amostra);
      const excl  = pares.filter(p => p.amostra === amostra);
      const tp_excl = excl.reduce((s, p) => s + (p.tp ?? 0), 0);
      const fp_excl = excl.reduce((s, p) => s + (p.fp ?? 0), 0);
      const fn_excl = excl.reduce((s, p) => s + (p.fn ?? 0), 0);
      const tp = resto.reduce((s, p) => s + (p.tp ?? 0), 0);
      const fp = resto.reduce((s, p) => s + (p.fp ?? 0), 0);
      const fn = resto.reduce((s, p) => s + (p.fn ?? 0), 0);
      const f1_sem = 2 * tp + fp + fn > 0 ? 2 * tp / (2 * tp + fp + fn) : null;
      const delta  = f1_sem != null ? f1_sem - agregado.f1_score : null;
      return { amostra, tp_excl, fp_excl, fn_excl, f1_global: agregado.f1_score, f1_sem, delta };
    });
  }, [resultado, agregado]);

  // ── LOO por Variante ──────────────────────────────────────────────────────
  const looVariante = useMemo(() => {
    if (!agregado || !detalhamentoConc) return [];
    const { tp, fp, fn, f1_score } = agregado;
    const fns = (detalhamentoDisc ?? []).filter(v => v.tipo === 'FN');

    const calcF1 = (new_tp, new_fp, new_fn) =>
      2 * new_tp + new_fp + new_fn > 0
        ? 2 * new_tp / (2 * new_tp + new_fp + new_fn)
        : null;

    const rows = [];
    for (const v of detalhamentoConc) {
      const f1_sem = calcF1(tp - 1, fp, fn);
      const delta  = f1_sem != null ? f1_sem - f1_score : null;
      rows.push({ ...v, tipo: 'TP', f1_sem, delta });
    }
    for (const v of fns) {
      const f1_sem = calcF1(tp, fp, fn - 1);
      const delta  = f1_sem != null ? f1_sem - f1_score : null;
      rows.push({ ...v, tipo: 'FN', f1_sem, delta });
    }
    // Ordena: maior delta primeiro (FNs impactantes), depois TPs mais críticos
    return rows.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  }, [agregado, detalhamentoConc, detalhamentoDisc]);

  // ── Helpers de badge ──────────────────────────────────────────────────────
  const badgeTsv = (_tipo) => 'bg-white text-slate-600 border-slate-300';

  const callerColors = {
    Mutect2:   'bg-white text-slate-600 border-slate-300',
    VarScan2:  'bg-white text-slate-600 border-slate-300',
    LoFreq:    'bg-white text-slate-600 border-slate-300',
    Consensus: 'bg-white text-slate-600 border-slate-300',
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="w-full pb-10 space-y-4">

      {/* Cabeçalho */}
      <div className="border-b border-slate-300 pb-3">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Benchmarking Analítico</h2>
        <p className="text-sm text-slate-500 mt-0.5">Validação PantherFlow vs Ion Reporter · cascata dinâmica multi-caller</p>
      </div>

      {/* ── Painel de Montagem de Lote ─────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 overflow-hidden">

        {/* Header do painel */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Info size={14} className="text-slate-400" />
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Banco de Pares Disponíveis
            </p>
          </div>
          <button
            onClick={carregarArquivos}
            disabled={loadingArquivos}
            title="Recarregar arquivos disponíveis"
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-violet-600
                       font-semibold transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={loadingArquivos ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* ── Tabela de pares ───────────────────────────────────────────── */}
          <div>
            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-2 mb-3">

              {/* Busca por amostra */}
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={filtroAmostra}
                  onChange={e => setFiltroAmostra(e.target.value)}
                  placeholder="Amostra ou UUID…"
                  className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-none bg-white w-36
                             focus:outline-none focus:border-slate-500 font-mono"
                />
              </div>

              {/* Toggle Caller */}
              {callersDisponiveis.map(caller => (
                <button
                  key={caller}
                  onClick={() => toggleCaller(caller)}
                  className={`px-2.5 py-1 text-[11px] font-mono font-semibold border transition-colors
                    ${filtroCallers.has(caller)
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-500 border-slate-300 hover:border-slate-600'}`}
                >
                  {caller}
                </button>
              ))}

              {/* Select TSV tipo */}
              {tiposDisponiveis.length > 1 && (
                <select
                  value={filtroTsvTipo}
                  onChange={e => setFiltroTsvTipo(e.target.value)}
                  className="py-1.5 px-2.5 text-xs border border-slate-200 rounded-none bg-white
                             focus:outline-none focus:border-slate-500 text-slate-600"
                >
                  <option value="">Tipo TSV</option>
                  {tiposDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}

              {/* Select Parâmetro */}
              {parametrosDisponiveis.length > 1 && (
                <select
                  value={filtroParametro}
                  onChange={e => setFiltroParametro(e.target.value)}
                  className="py-1.5 px-2.5 text-xs border border-slate-200 rounded-none bg-white
                             focus:outline-none focus:border-slate-500 text-slate-600 font-mono"
                >
                  <option value="">Parâmetro</option>
                  {parametrosDisponiveis.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              )}

              {/* Contador + limpar */}
              {!loadingArquivos && (
                <span className="text-xs text-slate-400 font-mono ml-1">
                  {paresFiltrados.length} de {todosOsPares.length} pares
                </span>
              )}
              {temFiltroAtivo && (
                <button
                  onClick={limparFiltros}
                  className="text-xs text-rose-500 font-semibold hover:underline ml-1"
                >
                  Limpar filtros
                </button>
              )}

            </div>

            {/* Botão adicionar todos */}
            <div className="flex mb-3">
              {!loadingArquivos && paresFiltrados.length > 0 && (
                <button
                  onClick={adicionarTodosVisiveis}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300
                             bg-white text-slate-700 text-xs font-semibold
                             hover:bg-slate-50 transition-colors"
                >
                  <PlusCircle size={12} />
                  {temFiltroAtivo
                    ? `Adicionar filtrados (${paresFiltrados.length})`
                    : `Adicionar todos (${paresFiltrados.length})`}
                </button>
              )}
            </div>

            {loadingArquivos ? (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
                <RefreshCw size={13} className="animate-spin" /> Escaneando diretórios…
              </div>
            ) : todosOsPares.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-4 border border-dashed
                              border-slate-200 text-xs text-slate-400">
                <AlertTriangle size={13} className="shrink-0 text-amber-400" />
                Nenhum par encontrado. Verifique se existem VCFs em AUDITORIA_DIR e TSVs em ion_torrent/.
              </div>
            ) : paresFiltrados.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-4 border border-dashed
                              border-slate-200 text-xs text-slate-400">
                <Search size={13} className="shrink-0" />
                Nenhuma amostra corresponde ao filtro "{filtroAmostra}".
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-400
                                   text-[11px] uppercase tracking-wider">
                      <th className="px-4 py-3 font-semibold text-left whitespace-nowrap">Amostra</th>
                      <th className="px-4 py-3 font-semibold text-left whitespace-nowrap">UUID</th>
                      <th className="px-4 py-3 font-semibold text-left whitespace-nowrap">TSV Ion</th>
                      <th className="px-4 py-3 font-semibold text-left whitespace-nowrap">Parâmetro</th>
                      <th className="px-4 py-3 font-semibold text-left whitespace-nowrap">Caller</th>
                      <th className="px-4 py-3 font-semibold text-center whitespace-nowrap">Adicionar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paresFiltrados.map((par, i) => {
                      const jaNoLote = loteAtual.some(
                        p => p.vcf_path === par.vcf.path && p.tsv_path === par.tsv.path
                      );
                      return (
                        <tr
                          key={i}
                          className={`transition-colors ${jaNoLote ? 'bg-orange-50/60' : 'hover:bg-slate-50'}`}
                        >
                          <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">
                            {par.amostra}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span
                              title={par.vcf.uuid}
                              onClick={() => navigator.clipboard?.writeText(par.vcf.uuid)}
                              className="font-mono text-[10px] text-slate-400 border border-slate-200 px-1.5 py-0.5 cursor-pointer hover:border-slate-400 hover:text-slate-600 transition-colors select-all"
                            >
                              {(par.vcf.uuid ?? '').slice(0, 8)}…
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold border ${badgeTsv(par.tsv.tipo)}`}>
                              {par.tsv.tipo}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">
                            {par.vcf.parametro}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold border
                                             ${callerColors[par.vcf.caller] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                              {par.vcf.caller}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <button
                              onClick={() => adicionarPar(par)}
                              disabled={jaNoLote}
                              title={jaNoLote ? 'Já no lote' : 'Adicionar ao lote'}
                              className={`inline-flex items-center justify-center w-7 h-7 border transition-colors
                                          ${jaNoLote
                                            ? 'border-orange-300 text-orange-400 bg-orange-50 cursor-default'
                                            : 'border-slate-400 text-slate-500 hover:border-slate-900 hover:text-slate-900'}`}
                            >
                              {jaNoLote
                                ? <CheckCircle2 size={13} />
                                : <PlusCircle   size={13} />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Lote atual ────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Lote Atual ({loteAtual.length} {loteAtual.length === 1 ? 'par' : 'pares'})
              </p>
              {loteAtual.length > 0 && (
                <button
                  onClick={limparLote}
                  className="flex items-center gap-1 text-xs text-rose-500 font-semibold hover:underline"
                >
                  <Trash2 size={11} /> Limpar tudo
                </button>
              )}
            </div>

            {loteAtual.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-3 border border-dashed border-slate-200
                              text-xs text-slate-400">
                <Info size={13} className="shrink-0" />
                Clique em "+" na tabela acima para adicionar pares de análise ao lote.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {loteAtual.map((par, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 px-3 py-2 border border-orange-200
                               bg-orange-50 text-xs font-medium text-orange-900"
                  >
                    <span className="font-mono font-bold text-orange-800">{par.amostra}</span>
                    <span className="text-orange-300">·</span>
                    <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold border border-orange-300 text-orange-700 bg-white">
                      {par.tsv_tipo}
                    </span>
                    <span className="text-orange-300">·</span>
                    <span className="font-mono text-orange-700">{par.parametro}</span>
                    <span className="text-orange-300">·</span>
                    <span className="font-mono text-orange-700">{par.caller}</span>
                    <button
                      onClick={() => removerDoLote(idx)}
                      className="ml-1 text-orange-300 hover:text-rose-500 transition-colors"
                      title="Remover do lote"
                    >
                      <XCircle size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Upload de novo TSV (colapsável) ───────────────────────────── */}
          <div className="border border-dashed border-slate-200 overflow-hidden">
            <button
              onClick={() => { setUploadAberto(o => !o); setUploadFeedback(null); }}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold
                         text-slate-500 hover:bg-slate-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <PlusCircle size={14} className={uploadAberto ? 'text-orange-500' : 'text-slate-900'} />
                Importar Novo TSV (Ion Reporter)
              </span>
              <span className="text-slate-300 text-lg leading-none">{uploadAberto ? '−' : '+'}</span>
            </button>

            {uploadAberto && (
              <div className="px-4 pb-4 pt-3 space-y-3 border-t border-slate-100">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                      Nome da Amostra
                    </label>
                    <input
                      type="text"
                      value={uploadNome}
                      onChange={e => setUploadNome(e.target.value)}
                      placeholder="Ex: Pul099"
                      maxLength={32}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-none
                                 focus:outline-none focus:border-slate-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                      Arquivo TSV
                    </label>
                    <div className="flex gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".tsv,.csv,.txt"
                        onChange={e => setUploadArquivo(e.target.files?.[0] ?? null)}
                        className="hidden"
                        id="upload-tsv-input"
                      />
                      <label
                        htmlFor="upload-tsv-input"
                        className="flex-1 flex items-center gap-2 px-3 py-2 text-sm border border-slate-200
                                   rounded-none cursor-pointer hover:bg-slate-50 transition-colors truncate"
                      >
                        <Upload size={13} className="text-slate-400 shrink-0" />
                        <span className="truncate text-slate-500 text-xs">
                          {uploadArquivo ? uploadArquivo.name : 'Selecionar arquivo…'}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleUpload}
                    disabled={uploadLoading || !uploadNome.trim() || !uploadArquivo}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white
                               text-xs font-bold hover:bg-slate-700
                               disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                  >
                    {uploadLoading
                      ? <><RefreshCw size={13} className="animate-spin" /> Enviando…</>
                      : <><Upload size={13} /> Enviar e Registrar</>}
                  </button>
                  {uploadFeedback && (
                    <span className={`flex items-center gap-1.5 text-xs font-semibold
                                      ${uploadFeedback.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {uploadFeedback.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                      {uploadFeedback.msg}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Botão principal ────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <Info size={12} className="shrink-0" />
              Liftover hg19→hg38 · cruzamento por CHR:POS · zero arquivos intermediários.
            </p>
            <button
              onClick={handleRodar}
              disabled={loading || loteAtual.length === 0}
              className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white
                         text-sm font-bold hover:bg-slate-700
                         disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? <><RefreshCw size={15} className="animate-spin" /> Processando…</>
                : <><Play size={15} /> Rodar Análise do Lote ({loteAtual.length})</>}
            </button>
          </div>

        </div>
      </div>

      {/* Erros de execução */}
      {erro && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 px-5 py-4 text-sm text-red-700">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span><span className="font-bold">Erro: </span>{erro}</span>
        </div>
      )}
      {resultado?.erros?.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 px-5 py-4 text-sm text-amber-700">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Avisos de processamento:</span>
            <ul className="mt-1 list-disc list-inside space-y-0.5">
              {resultado.erros.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* ── Área de resultados ─────────────────────────────────────────────── */}
      {(resultado || loading) && (
        <div className={`space-y-4 transition-opacity duration-300 ${loading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>

          {loading && !resultado && (
            <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
              <RefreshCw size={28} className="animate-spin text-violet-500" />
              <p className="text-sm">Processando lote — liftover + cruzamento de variantes…</p>
            </div>
          )}

          {resultado && (
            <>
              {/* Cards de métricas agregadas */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <MetricCard
                  label="Sensibilidade"
                  value={agregado?.sensibilidade}
                  formatted={pct(agregado?.sensibilidade)}
                  sublabel={`TP/(TP+FN) · ${agregado?.tp ?? '—'}/${(agregado?.tp ?? 0) + (agregado?.fn ?? 0)}`}
                  color={corMetrica(agregado?.sensibilidade)}
                  icon={Target}
                />
                <MetricCard
                  label="Precisão (PPV)"
                  value={agregado?.precisao}
                  formatted={pct(agregado?.precisao)}
                  sublabel={`TP/(TP+FP) · ${agregado?.tp ?? '—'}/${(agregado?.tp ?? 0) + (agregado?.fp ?? 0)}`}
                  color={corMetrica(agregado?.precisao)}
                  icon={Award}
                />
                <MetricCard
                  label="F1-Score"
                  value={agregado?.f1_score}
                  formatted={fmt4(agregado?.f1_score)}
                  sublabel="Média harmónica Sens × Prec"
                  color={corMetrica(agregado?.f1_score)}
                  icon={TrendingUp}
                />
                <MetricCard
                  label="Jaccard"
                  value={agregado?.jaccard}
                  formatted={fmt4(agregado?.jaccard)}
                  sublabel={`TP/(TP+FP+FN) · ${agregado?.tp ?? '—'}/${(agregado?.tp ?? 0) + (agregado?.fp ?? 0) + (agregado?.fn ?? 0)}`}
                  color={corMetrica(agregado?.jaccard)}
                  icon={Layers}
                />
                <MetricCard
                  label="RMSE VAF (médio)"
                  value={agregado?.rmse_medio != null ? 1 - agregado.rmse_medio : null}
                  formatted={agregado?.rmse_medio != null ? pct(agregado.rmse_medio) : '—'}
                  sublabel="Erro médio entre VAF Ion e Panther nos TPs"
                  color={agregado?.rmse_medio == null ? 'slate' : agregado.rmse_medio < 0.05 ? 'emerald' : agregado.rmse_medio < 0.15 ? 'amber' : 'rose'}
                  icon={TrendingUp}
                />
                <MetricCard
                  label="Spearman ρ (médio)"
                  value={agregado?.spearman_medio}
                  formatted={agregado?.spearman_medio != null ? fmt4(agregado.spearman_medio) : '—'}
                  sublabel="Correlação de VAF Ion vs Panther (TPs)"
                  color={corMetrica(agregado?.spearman_medio)}
                  icon={Award}
                />
              </div>

              {/* Contagens absolutas */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Verdadeiros Positivos (TP)', value: agregado?.tp },
                  { label: 'Falsos Positivos (FP)',       value: agregado?.fp },
                  { label: 'Falsos Negativos (FN)',        value: agregado?.fn },
                ].map(({ label, value }) => (
                  <div key={label} className="border border-slate-200 bg-white p-4 flex flex-col items-center gap-1">
                    <span className="text-4xl font-bold font-mono text-slate-800">{value ?? '—'}</span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">{label}</span>
                  </div>
                ))}
              </div>

              {/* Nota metodológica — recolhível */}
              <div className="border border-slate-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setNotaAberta(o => !o)}
                  className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-slate-50 transition-colors"
                >
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nota Metodológica</span>
                  <span className="text-slate-400 text-sm leading-none">{notaAberta ? '−' : '+'}</span>
                </button>
                {notaAberta && (
                  <div className="px-6 pb-5 pt-2 space-y-4 text-xs text-slate-600 leading-relaxed border-t border-slate-200">
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-700">Métricas de concordância</p>
                      <p>
                        A comparação entre PantherFlow e Ion Reporter é realizada por correspondência de locus (cromossomo + posição + REF + ALT) após normalização de coordenadas.
                        Variantes presentes em ambas as plataformas são classificadas como <span className="font-semibold">Verdadeiro Positivo (TP)</span>;
                        exclusivas do PantherFlow como <span className="font-semibold">Falso Positivo (FP)</span>;
                        e exclusivas do Ion Reporter como <span className="font-semibold">Falso Negativo (FN)</span>.
                        A <span className="font-semibold">Sensibilidade</span> (Recall) mede a fração das variantes Ion Reporter recuperadas pelo pipeline: TP / (TP + FN).
                        A <span className="font-semibold">Precisão</span> mede a fração das chamadas do PantherFlow confirmadas: TP / (TP + FP).
                        O <span className="font-semibold">F1-Score</span> é a média harmônica entre Sensibilidade e Precisão, penalizando igualmente FP e FN.
                        O <span className="font-semibold">Índice de Jaccard</span> representa a sobreposição dos conjuntos: TP / (TP + FP + FN).
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-700">Métricas de concordância de frequência alélica</p>
                      <p>
                        Para os TPs, a concordância quantitativa de VAF é avaliada pelo <span className="font-semibold">RMSE VAF</span> (raiz do erro quadrático médio entre VAF PantherFlow e VAF Ion Reporter)
                        e pelo <span className="font-semibold">coeficiente de Spearman (ρ)</span>, que mede a correlação ordinal entre as frequências alélicas das duas plataformas sem pressupor linearidade.
                        O <span className="font-semibold">coeficiente de Pearson (r)</span> é calculado complementarmente para correlação linear.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-700">Figura 2 — Diagrama de Venn</p>
                      <p>Representa graficamente a partição dos conjuntos de variantes. A região de interseção corresponde aos TPs (concordantes). As regiões exclusivas correspondem a FPs (PantherFlow) e FNs (Ion Reporter).</p>
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-700">Figura 3 — Correlação de VAF (TPs)</p>
                      <p>Scatter plot de VAF Ion Reporter (eixo X) versus VAF PantherFlow (eixo Y) para os TPs. A linha tracejada representa concordância perfeita (y = x). Pontos abaixo da diagonal indicam subestimação sistemática pelo PantherFlow; pontos acima, superestimação.</p>
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-700">Figura 4 — Distribuição das discordâncias por faixa de VAF</p>
                      <p>Histograma de FPs e FNs estratificados em quatro faixas de frequência alélica (&lt;5%, 5–15%, 15–30%, &gt;30%). Concentração de discordâncias em VAF baixo (&lt;5%) é esperada em amostras tumor-only com baixa fração tumoral, refletindo os limites técnicos de detecção (LOD) das plataformas.</p>
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-700">Leave-One-Out por Amostra</p>
                      <p>Para cada amostra do lote, os pares correspondentes são excluídos e as métricas globais (TP, FP, FN, F1) são recalculadas com as amostras restantes. ΔF1 positivo indica que a amostra reduz o desempenho global; ΔF1 negativo indica contribuição positiva para o score agregado.</p>
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-700">Leave-One-Out por Variante de Referência</p>
                      <p>Para cada variante do conjunto de referência Ion Reporter (TP ou FN), simula-se o impacto de excluí-la do cálculo. FNs com ΔF1 elevado representam variantes sistematicamente não detectadas que mais penalizam a sensibilidade — candidatas prioritárias para ajuste de limiares de VAF ou profundidade de cobertura.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Tabela 1 — benchmarking por par */}
              <div className="bg-white border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2 cursor-pointer select-none" onClick={() => setTab1Aberta(v => !v)}>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Tabela 1 — Benchmarking por Par</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Clique no cabeçalho para ordenar · Destaque: melhor ▲ e menor ▼ F1
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono bg-slate-100 text-slate-500 px-2 py-1">{resultado.metricas_por_par?.length ?? 0} pares</span>
                    <span className="text-xs font-bold text-slate-400 border border-slate-300 w-6 h-6 flex items-center justify-center">{tab1Aberta ? '−' : '+'}</span>
                  </div>
                </div>
                {tab1Aberta && (
                  <div className="p-4">
                    <TabelaPorAmostra linhas={resultado.metricas_por_par ?? []} />
                  </div>
                )}
              </div>

              {/* Tabela de Performance de Estratégias (Consenso/Combinatória) */}
              {resultado.heatmap_estrategia && (
                <div className="bg-white border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-800">Figura 1 — Heatmap de Performance por Estratégia</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Precisão e Sensibilidade por estratégia de variant calling · gerado com seaborn</p>
                  </div>
                  <div className="p-4">
                    <img
                      src={`data:image/png;base64,${resultado.heatmap_estrategia}`}
                      alt="Heatmap de performance por estratégia"
                      className="w-full h-auto"
                    />
                  </div>
                </div>
              )}

              {resultado.tabela_consenso?.length > 0 && (
                <div className="bg-white border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2 cursor-pointer select-none" onClick={() => setTab2Aberta(v => !v)}>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">Tabela 2 — Performance de Estratégias de Variant Calling</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Comparação de algoritmos isolados, interseções e uniões contra o padrão-ouro Ion Reporter
                      </p>
                    </div>
                    <span className="text-xs font-bold text-slate-400 border border-slate-300 w-6 h-6 flex items-center justify-center">{tab2Aberta ? '−' : '+'}</span>
                  </div>
                  {tab2Aberta && (
                    <div className="p-4">
                      <TabelaPerformanceEstrategias dados={resultado.tabela_consenso} />
                    </div>
                  )}
                </div>
              )}

              {/* Grid de gráficos */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {vennData && (
                  <div className="bg-white border border-slate-200 overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-200">
                      <h3 className="text-sm font-bold text-slate-800">Figura 2 — Diagrama de Venn</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Interseção dos conjuntos de variantes de cada plataforma</p>
                    </div>
                    <div className="p-4">
                      <VennDiagram tp={vennData.tp} fp={vennData.fp} fn={vennData.fn} />
                    </div>
                  </div>
                )}

                {resultado?.tabela_consenso?.length > 0 && (
                  <div className="bg-white border border-slate-200 overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-200">
                      <h3 className="text-sm font-bold text-slate-800">Figura 3 — Diagrama de Venn por Caller</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Sobreposição de variantes entre os algoritmos de variant calling</p>
                    </div>
                    <div className="p-4">
                      <VennDiagram dados={resultado.tabela_consenso} />
                    </div>
                  </div>
                )}

                {resultado?.dados_graficos?.imagem_scatter && (
                  <div className="bg-white border border-slate-200 overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-200">
                      <h3 className="text-sm font-bold text-slate-800">Figura 4 — Correlação de VAF (TPs)</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Pontos abaixo de y=x indicam subestimação pelo PantherFlow</p>
                    </div>
                    <div className="p-4 flex justify-center">
                      <img
                        src={`data:image/png;base64,${resultado.dados_graficos.imagem_scatter}`}
                        alt="Figura 4 — Correlação de VAF (TPs)"
                        className="h-auto"
                        style={{ maxWidth: 520 }}
                      />
                    </div>
                  </div>
                )}

                {resultado?.dados_graficos?.imagem_discordancias && (
                  <div className="bg-white border border-slate-200 overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-200">
                      <h3 className="text-sm font-bold text-slate-800">
                        Figura 5 — Distribuição das Discordâncias por Faixa de VAF
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Concentração em VAF &lt;5% indica limites técnicos de detecção (LOD do ctDNA tumor-only)
                      </p>
                    </div>
                    <div className="p-4 flex justify-center">
                      <img
                        src={`data:image/png;base64,${resultado.dados_graficos.imagem_discordancias}`}
                        alt="Figura 5 — Distribuição das Discordâncias por Faixa de VAF"
                        className="h-auto"
                        style={{ maxWidth: 600 }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Figura 6 — Sensibilidade Paramétrica (matplotlib backend) */}
              <SensibilidadeParametricaImg imagem={imagemSensibilidade} />

              {/* Tabela 3 — caracterização molecular das discordantes */}
              <div className="bg-white border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2 cursor-pointer select-none" onClick={() => setTab3Aberta(v => !v)}>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      Tabela 3 — Caracterização Molecular das Variantes Discordantes
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Tipo de variante · Efeito funcional (SnpEff) · Impacto · FPs ordenados por VAF descendente
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono bg-slate-100 text-slate-500 px-2 py-1">{detalhamentoDisc?.length ?? 0} variantes</span>
                    <span className="text-xs font-bold text-slate-400 border border-slate-300 w-6 h-6 flex items-center justify-center">{tab3Aberta ? '−' : '+'}</span>
                  </div>
                </div>
                {tab3Aberta && (
                  <div className="p-4">
                    <DiscordanceTable dados={detalhamentoDisc ?? []} />
                  </div>
                )}
              </div>

              {/* Tabela 4 — variantes concordantes (TP) */}
              {detalhamentoConc.length > 0 && (
                <div className="bg-white border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2 cursor-pointer select-none" onClick={() => setTab4Aberta(v => !v)}>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">
                        Tabela 4 — Variantes Concordantes (True Positives)
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Detectadas por PantherFlow E confirmadas pelo Ion Reporter · ordenadas por amostra e locus
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono bg-slate-100 text-slate-500 px-2 py-1">{detalhamentoConc.length} variantes</span>
                      <span className="text-xs font-bold text-slate-400 border border-slate-300 w-6 h-6 flex items-center justify-center">{tab4Aberta ? '−' : '+'}</span>
                    </div>
                  </div>
                  {tab4Aberta && <div className="p-4 overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b-2 border-slate-300">
                          {['Amostra','Locus','Gene','Tipo','Efeito (SnpEff)','HGVS (Proteína)',
                            'Impacto','Fonte Ion','VAF Ion','VAF Panther','Δ VAF'].map(h => (
                            <th key={h} className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase tracking-widest text-left whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detalhamentoConc.map((v, i) => {
                          const delta = (v.vaf_ion != null && v.vaf_panther != null)
                            ? v.vaf_panther - v.vaf_ion : null;
                          return (
                            <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i % 2 !== 0 ? 'bg-slate-50/30' : ''}`}>
                              <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">
                                {v.amostra}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">
                                {v.locus}
                              </td>
                              <td className="px-3 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap">
                                {v.gene ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                                {v.tipo_variante ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                                {v.efeito_funcional ?? '—'}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">
                                {v.hgvs_p && v.hgvs_p !== '—' ? v.hgvs_p : '—'}
                              </td>
                              <td className="px-3 py-2 text-xs whitespace-nowrap">
                                {v.impacto && v.impacto !== '—'
                                  ? <span className="border border-slate-300 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 bg-white">{v.impacto}</span>
                                  : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                {v.tsv_tipo ? (
                                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold border border-slate-300 text-slate-600 bg-white">
                                    {v.tsv_tipo}
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-slate-700 tabular-nums">
                                {v.vaf_ion != null ? pct(v.vaf_ion) : '—'}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-slate-700 tabular-nums">
                                {v.vaf_panther != null ? pct(v.vaf_panther) : '—'}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-slate-600 tabular-nums">
                                {delta != null ? `${delta > 0 ? '+' : ''}${pct(delta)}` : <span className="text-slate-300">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>}
                </div>
              )}
              {/* ── LOO por Amostra ── */}
              {false && looAmostra.length > 0 && (
                <div className="bg-white border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-800">Figura 4 — Sensibilidade da Coorte (Leave-One-Out por Amostra)</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      ΔF1 ao excluir cada amostra do cálculo global. Barras laranjas (ΔF1 negativo): a remoção piora o desempenho — amostra crítica para o conjunto. Barras verdes (ΔF1 positivo): a remoção melhora o desempenho — amostra puxava a média para baixo.
                    </p>
                  </div>
                  <div className="p-6 flex flex-col items-center gap-3">
                    <div style={{ border: '1px solid #555', background: 'white', display: 'inline-block' }}>
                      <BarChart
                        layout="vertical"
                        width={540}
                        height={Math.max(220, looAmostra.length * 38)}
                        data={[...looAmostra].sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))}
                        margin={{ top: 12, right: 72, left: 80, bottom: 28 }}
                      >
                        <CartesianGrid stroke="#cccccc" strokeOpacity={0.5} strokeDasharray="none" vertical={true} horizontal={false} />
                        <XAxis
                          type="number"
                          tickFormatter={v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}pp`}
                          tick={{ fontSize: 11, fill: '#333' }}
                          axisLine={{ stroke: '#555' }}
                          tickLine={{ stroke: '#555', size: 3 }}
                          label={{ value: 'ΔF1 (pontos percentuais)', position: 'insideBottom', offset: -14, fontSize: 12, fill: '#222' }}
                        />
                        <YAxis
                          type="category"
                          dataKey="amostra"
                          tick={{ fontSize: 11, fill: '#333', fontWeight: 600 }}
                          width={76}
                          axisLine={{ stroke: '#555' }}
                          tickLine={{ stroke: '#555', size: 3 }}
                        />
                        <ReferenceLine x={0} stroke="#333" strokeWidth={1.2} />
                        <Bar dataKey="delta" radius={0} maxBarSize={20} isAnimationActive={false}>
                          {[...looAmostra]
                            .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))
                            .map((row, i) => (
                              <Cell
                                key={i}
                                fill={row.delta < -0.001 ? '#ff7f0e' : row.delta > 0.001 ? '#2ca02c' : '#aaaaaa'}
                              />
                            ))
                          }
                        </Bar>
                      </BarChart>
                    </div>
                    <div style={{ display: 'flex', gap: 24, fontSize: 11, fontFamily: 'sans-serif', color: '#333' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 14, height: 14, background: '#ff7f0e', display: 'inline-block' }} />
                        ΔF1 negativo — amostra crítica
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 14, height: 14, background: '#2ca02c', display: 'inline-block' }} />
                        ΔF1 positivo — amostra problemática
                      </span>
                    </div>
                  </div>
                  {/* Tabela detalhada colapsável */}
                  <details className="border-t border-slate-100">
                    <summary className="px-5 py-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-slate-600 select-none">
                      Ver tabela detalhada
                    </summary>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 text-[11px] uppercase tracking-wider">
                            {['Amostra','TP excl.','FP excl.','FN excl.','F1 Global','F1 sem ela','ΔF1','Efeito'].map(h => (
                              <th key={h} className="px-4 py-3 font-semibold text-left whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {[...looAmostra].sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).map((row, i) => {
                            const pos = row.delta > 0.001;
                            const neg = row.delta < -0.001;
                            return (
                              <tr key={i} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-700">{row.amostra}</td>
                                <td className="px-4 py-2.5 font-mono text-xs text-emerald-700 font-bold text-center">{row.tp_excl}</td>
                                <td className="px-4 py-2.5 font-mono text-xs text-indigo-600 font-bold text-center">{row.fp_excl}</td>
                                <td className="px-4 py-2.5 font-mono text-xs text-orange-600 font-bold text-center">{row.fn_excl}</td>
                                <td className="px-4 py-2.5 font-mono text-xs text-slate-600 tabular-nums">{fmt4(row.f1_global)}</td>
                                <td className="px-4 py-2.5 font-mono text-xs text-slate-600 tabular-nums">{fmt4(row.f1_sem)}</td>
                                <td className={`px-4 py-2.5 font-mono text-xs font-bold tabular-nums ${pos ? 'text-rose-600' : neg ? 'text-emerald-600' : 'text-slate-400'}`}>
                                  {row.delta != null ? `${row.delta > 0 ? '+' : ''}${fmt4(row.delta)}` : '—'}
                                </td>
                                <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                                  {pos
                                    ? <span className="px-2 py-0.5 rounded-none text-[10px] font-bold border bg-rose-50 text-rose-700 border-rose-200">Reduz F1</span>
                                    : neg
                                      ? <span className="px-2 py-0.5 rounded-none text-[10px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">Eleva F1</span>
                                      : <span className="px-2 py-0.5 rounded-none text-[10px] font-bold border bg-slate-100 text-slate-500 border-slate-200">Neutro</span>
                                  }
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              )}

              {/* ── LOO por Variante ── */}
              {false && looVariante.length > 0 && (
                <div className="bg-white border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-800">Figura 5 — Impacto Variantil Específico (LOO)</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      VAF Ion (eixo X) × ΔF1 ao excluir a variante (eixo Y). TPs abaixo de zero são os mais críticos para o score; FNs acima de zero são os casos mais difíceis de detectar pelo pipeline.
                    </p>
                  </div>
                  <div className="p-6 flex flex-col items-center gap-3">
                    <div style={{ border: '1px solid #555', background: 'white', display: 'inline-block' }}>
                      <ScatterChart width={500} height={380} margin={{ top: 16, right: 24, bottom: 48, left: 52 }}>
                        <CartesianGrid stroke="#cccccc" strokeOpacity={0.5} strokeDasharray="none" />
                        <XAxis
                          type="number"
                          dataKey="vaf_ion"
                          name="VAF Ion"
                          domain={[0, 1]}
                          tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                          label={{ value: 'VAF Ion Reporter (%)', position: 'insideBottom', offset: -30, fontSize: 12, fill: '#222' }}
                          tick={{ fontSize: 11, fill: '#333' }}
                          axisLine={{ stroke: '#555' }}
                          tickLine={{ stroke: '#555', size: 4 }}
                          tickCount={6}
                        />
                        <YAxis
                          type="number"
                          dataKey="delta"
                          name="ΔF1"
                          tickFormatter={v => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}pp`}
                          label={{ value: 'ΔF1 (pontos percentuais)', angle: -90, position: 'insideLeft', offset: -36, fontSize: 12, fill: '#222' }}
                          tick={{ fontSize: 11, fill: '#333' }}
                          axisLine={{ stroke: '#555' }}
                          tickLine={{ stroke: '#555', size: 4 }}
                        />
                        <ReferenceLine y={0} stroke="#555" strokeWidth={1} strokeDasharray="6 3" />
                        <Tooltip
                          cursor={{ strokeDasharray: '3 3', stroke: '#aaa' }}
                          content={({ payload }) => {
                            if (!payload?.length) return null;
                            const d = payload[0]?.payload;
                            if (!d) return null;
                            return (
                              <div style={{ background: 'white', border: '1px solid #ccc', borderRadius: 4, padding: '8px 12px', fontSize: 11, fontFamily: 'monospace', minWidth: 180, boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
                                <p style={{ fontWeight: 700, marginBottom: 4 }}>{d.chave ?? d.locus ?? '—'}</p>
                                <p style={{ color: '#555', marginBottom: 4 }}>{d.amostra ?? '—'} · <strong>{d.gene ?? '—'}</strong></p>
                                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                                  <tbody>
                                    <tr><td style={{ color: '#888', paddingRight: 12 }}>VAF Ion</td><td style={{ fontWeight: 600 }}>{d.vaf_ion != null ? `${(d.vaf_ion * 100).toFixed(1)}%` : '—'}</td></tr>
                                    <tr><td style={{ color: '#888', paddingRight: 12 }}>ΔF1</td><td style={{ fontWeight: 700, color: d.delta > 0 ? '#d62728' : '#2ca02c' }}>{d.delta != null ? `${d.delta > 0 ? '+' : ''}${(d.delta * 100).toFixed(3)}pp` : '—'}</td></tr>
                                    <tr><td style={{ color: '#888', paddingRight: 12 }}>Tipo</td><td style={{ fontWeight: 700 }}>{d.tipo}</td></tr>
                                  </tbody>
                                </table>
                              </div>
                            );
                          }}
                        />
                        <Scatter name="TP" data={looVariante.filter(v => v.tipo === 'TP' && v.vaf_ion != null)} fill="#1f77b4" fillOpacity={0.75} r={5} isAnimationActive={false} />
                        <Scatter name="FN" data={looVariante.filter(v => v.tipo === 'FN' && v.vaf_ion != null)} fill="#ff7f0e" fillOpacity={0.80} r={5} isAnimationActive={false} />
                      </ScatterChart>
                    </div>
                    <div style={{ display: 'flex', gap: 24, fontSize: 11, fontFamily: 'sans-serif', color: '#333' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#1f77b4" fillOpacity="0.75"/></svg>
                        TP — detectado pelo pipeline
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#ff7f0e" fillOpacity="0.8"/></svg>
                        FN — não detectado
                      </span>
                    </div>
                  </div>
                  {/* Tabela detalhada colapsável */}
                  <details className="border-t border-slate-100">
                    <summary className="px-5 py-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-slate-600 select-none">
                      Ver tabela detalhada ({looVariante.length} variantes)
                    </summary>
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 text-[11px] uppercase tracking-wider">
                            {['Tipo','Amostra','Locus','Gene','VAF Ion','F1 sem ela','ΔF1','Efeito'].map(h => (
                              <th key={h} className="px-4 py-3 font-semibold text-left whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {looVariante.map((v, i) => {
                            const pos = v.delta > 0.0001;
                            const neg = v.delta < -0.0001;
                            return (
                              <tr key={i} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-2.5 whitespace-nowrap">
                                  <span className={`px-2 py-0.5 rounded-none text-[10px] font-bold border uppercase ${v.tipo === 'TP' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>{v.tipo}</span>
                                </td>
                                <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">{v.amostra ?? '—'}</td>
                                <td className="px-4 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">{v.locus ?? '—'}</td>
                                <td className="px-4 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap">{v.gene ?? '—'}</td>
                                <td className="px-4 py-2.5 font-mono text-xs text-slate-600 tabular-nums">{v.vaf_ion != null ? pct(v.vaf_ion) : '—'}</td>
                                <td className="px-4 py-2.5 font-mono text-xs text-slate-600 tabular-nums">{fmt4(v.f1_sem)}</td>
                                <td className={`px-4 py-2.5 font-mono text-xs font-bold tabular-nums ${pos ? 'text-rose-600' : neg ? 'text-emerald-600' : 'text-slate-400'}`}>
                                  {v.delta != null ? `${v.delta > 0 ? '+' : ''}${fmt4(v.delta)}` : '—'}
                                </td>
                                <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                                  {pos
                                    ? <span className="px-2 py-0.5 rounded-none text-[10px] font-bold border bg-rose-50 text-rose-700 border-rose-200">Difícil detectar</span>
                                    : neg
                                      ? <span className="px-2 py-0.5 rounded-none text-[10px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">Alta contribuição</span>
                                      : <span className="px-2 py-0.5 rounded-none text-[10px] font-bold border bg-slate-100 text-slate-500 border-slate-200">Neutro</span>
                                  }
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

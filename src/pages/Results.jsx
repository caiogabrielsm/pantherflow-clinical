import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileText, User, Activity, ChevronLeft, Download, Dna, BarChart2, GitMerge, Timer, Zap, FlaskConical, ShieldCheck, ClipboardList, Terminal, AlertTriangle } from 'lucide-react';
import { api } from '../common/data/api';

// Badge colorido de impacto SnpEff — HIGH vermelho, MODERATE âmbar, LOW verde, MODIFIER cinza
function ImpactBadge({ impact }) {
  const styles = {
    HIGH:     'bg-red-100 text-red-700 border-red-200',
    MODERATE: 'bg-amber-100 text-amber-700 border-amber-200',
    LOW:      'bg-emerald-100 text-emerald-700 border-emerald-200',
    MODIFIER: 'bg-slate-100 text-slate-500 border-slate-200',
  };
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border uppercase tracking-wider ${styles[impact] ?? styles.MODIFIER}`}>
      {impact}
    </span>
  );
}

// Badge de patogenicidade ClinVar
function ClinvarBadge({ sig }) {
  if (!sig || sig === '—') return <span className="text-slate-400 text-xs">—</span>;
  const s = sig.toLowerCase();
  // Ordem importa: testar casos específicos antes do genérico 'pathogenic'
  if (s.includes('conflicting'))
    return <span className="inline-block px-2 py-0.5 text-[10px] font-bold border uppercase tracking-wider bg-slate-100 text-slate-600 border-slate-300" title={sig}>Conflitante</span>;
  if (s.includes('likely_pathogenic') || s === 'likely pathogenic')
    return <span className="inline-block px-2 py-0.5 text-[10px] font-bold border uppercase tracking-wider bg-orange-100 text-orange-700 border-orange-200" title={sig}>Prov. Patogênico</span>;
  if (s.includes('pathogenic') && !s.includes('likely_benign'))
    return <span className="inline-block px-2 py-0.5 text-[10px] font-bold border uppercase tracking-wider bg-red-100 text-red-700 border-red-200">{sig}</span>;
  if (s.includes('benign'))
    return <span className="inline-block px-2 py-0.5 text-[10px] font-bold border uppercase tracking-wider bg-emerald-100 text-emerald-700 border-emerald-200">{sig}</span>;
  if (s.includes('uncertain') || s.includes('vus'))
    return <span className="inline-block px-2 py-0.5 text-[10px] font-bold border uppercase tracking-wider bg-amber-100 text-amber-700 border-amber-200">VUS</span>;
  return <span className="text-xs text-slate-500">{sig}</span>;
}

const getVariantType = (ref, alt) => {
  if (!ref || !alt) return '—';
  if (ref.length === 1 && alt.length === 1) return 'SNV';
  if (ref.length > alt.length) return 'DEL';
  if (ref.length < alt.length) return 'INS';
  if (ref.length === alt.length && ref.length > 1) return 'MNV';
  return 'COMPLEX';
};

const VARIANT_TYPE_STYLES = {
  SNV:     'bg-slate-100 text-slate-700 border-slate-300',
  INS:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  DEL:     'bg-red-50 text-red-600 border-red-200',
  MNV:     'bg-amber-50 text-amber-700 border-amber-200',
  COMPLEX: 'bg-slate-100 text-slate-500 border-slate-200',
};

// Tabela de variantes — exibe todas as colunas clínicas sempre
function VariantTable({ variants }) {
  if (!variants || variants.length === 0) {
    return (
      <p className="text-sm text-slate-400 italic text-center py-8">
        Nenhuma variante encontrada neste caller para o painel alvo.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto border border-slate-200">
      <table className="w-full text-left text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-300">
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Chr</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Posição</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Ref → Alt</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Tipo</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Gene</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Efeito</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Freq. Pop. (gnomAD)</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Confiança (Stats)</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Impacto</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">HGVS (Proteína)</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">ClinVar (Sig.)</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">ClinVar (Doença)</th>
            <th className="px-4 py-2.5 pr-5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">COSMIC (Hits)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {variants.map((v, i) => (
            <tr key={i} className={`transition-colors hover:bg-slate-50 ${i % 2 !== 0 ? 'bg-slate-50/40' : ''}`}>
              <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{v.chrom || '—'}</td>
              <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{v.pos || '—'}</td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                <span className="text-slate-400">{v.ref || '—'}</span>
                <span className="mx-1 text-slate-300">→</span>
                <span>{v.alt || '—'}</span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {(() => {
                  const t = getVariantType(v.ref, v.alt);
                  return (
                    <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border uppercase tracking-wider ${VARIANT_TYPE_STYLES[t] ?? VARIANT_TYPE_STYLES.COMPLEX}`}>
                      {t}
                    </span>
                  );
                })()}
              </td>
              <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap">{v.gene || '—'}</td>
              <td className="px-4 py-3 text-xs text-slate-600">{v.effect?.replace(/_/g, ' ') || '—'}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                {v.pop_af != null ? (
                  v.pop_af > 0.01
                    ? <span className="inline-block px-2 py-0.5 text-[10px] font-bold border uppercase tracking-wider bg-slate-100 text-slate-500 border-slate-200" title="Frequência > 1% — possível polimorfismo germinal">{(v.pop_af * 100).toFixed(2)}%</span>
                    : <span className="font-mono text-xs font-semibold text-slate-700">{v.pop_af === 0 ? '<0.01%' : `${(v.pop_af * 100).toFixed(4)}%`}</span>
                ) : <span className="text-slate-300 text-xs">—</span>}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {v.statistical_confidence && v.statistical_confidence !== 'N/A' ? (
                  <span className={`font-mono text-xs font-semibold ${
                    v.statistical_confidence.startsWith('TLOD')
                      ? 'text-slate-800'
                      : 'text-slate-600'
                  }`}>
                    {v.statistical_confidence}
                  </span>
                ) : (
                  <span className="text-slate-300 text-xs">N/A</span>
                )}
              </td>
              <td className="px-4 py-3"><ImpactBadge impact={v.impact ?? 'MODIFIER'} /></td>
              <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{v.hgvs_p || '—'}</td>
              <td className="px-4 py-3"><ClinvarBadge sig={v.clinvar_sig} /></td>
              <td className="px-4 py-3 text-xs text-slate-500 max-w-[240px] truncate" title={v.clinvar_disease || ''}>{v.clinvar_disease || '—'}</td>
              <td className="px-4 py-3 pr-5 font-mono text-xs font-semibold whitespace-nowrap">
                {v.cosmic_cnt && v.cosmic_cnt !== '—'
                  ? <span className="text-slate-800 font-semibold">{v.cosmic_cnt}</span>
                  : <span className="text-slate-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Mapeamento de nomes internos de etapas para labels legíveis no UI
const STEP_LABELS = {
  fastqc:              'FastQC (QC Bruto)',
  trimmomatic:         'Trimmomatic (Limpeza)',
  bwa_mem:             'BWA-MEM + Samtools (Alinhamento → BAM)',
  samtools:            'Samtools (Conversão BAM)',
  samtools_coverage:   'samtools coverage (Profundidade do Painel)',
  varscan2:            'VarScan2 (Chamada de Variantes)',
  mutect2:             'Mutect2 + Filtros GATK (Chamada de Variantes)',
  contamination_calc:  'CalculateContamination (Modelo GDC)',
  artifact_filter:     'LearnReadOrientationModel (Modelo F1R2)',
};

// Funções puras de classificação — definidas fora do componente para não serem
// recriadas a cada render.
const _isPathogenic = (sig) => {
  if (!sig || sig === '—') return false;
  const s = sig.toLowerCase();
  return s.includes('pathogenic') && !s.includes('likely_benign') && !s.includes('benign');
};

const _classifyVariant = (v) => {
  const highImpact = v.impact === 'HIGH' || v.impact === 'MODERATE';
  const pathogenic = _isPathogenic(v.clinvar_sig);
  const common     = v.pop_af != null && v.pop_af > 0.01;
  return (highImpact || pathogenic) && (!common || pathogenic) ? 'IN' : 'OUT';
};

export default function Results() {
  const { uuid } = useParams();
  const navigate = useNavigate();
  const [runData, setRunData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Aba principal da página: 'laudo' ou 'qc'
  const [activePageTab, setActivePageTab] = useState('laudo');
  // Aba interna da tabela de variantes
  const [activeCallerTab, setActiveCallerTab] = useState('varscan');
  // Filtro de cromossomo
  const [filtroCromossomo, setFiltroCromossomo] = useState('Todos');
  // Busca por gene (ex: EGFR, ALK, KRAS)
  const [buscaGene, setBuscaGene] = useState('');
  // Triagem Ion Reporter: 'IN' = Relevantes, 'OUT' = Ruído Biológico
  const [variantViewMode, setVariantViewMode] = useState('IN');
  // Paginação client-side — evita DOM overload em amostras sem BED (>1000 variantes)
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const [consensusList, setConsensusList] = useState([]);
  const [vcfFetchError, setVcfFetchError] = useState(false);

  // Reset de página ao trocar aba, categoria, cromossomo ou busca
  useEffect(() => {
    setCurrentPage(1);
  }, [activeCallerTab, variantViewMode, filtroCromossomo, buscaGene]);

  useEffect(() => {
    if (!uuid) { setLoading(false); return; }
    api.getAnalysis(uuid)
      .then(data => setRunData(data))
      .catch(() => setError('Não foi possível carregar os dados desta análise.'))
      .finally(() => setLoading(false));
  }, [uuid]);

  useEffect(() => {
    if (!uuid) return;
    fetch(`http://localhost:8000/api/analysis/${uuid}/vcf-viewer?caller=consensus&limite=2000`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => { if (data?.variants) setConsensusList(data.variants); })
      .catch(err => { console.warn('[vcf-viewer] falha ao carregar:', err); setVcfFetchError(true); });
  }, [uuid]);

  // Rules of Hooks: all useMemo calls must be before any conditional early return
  const timeSteps = useMemo(() => {
    if (!runData?.time_steps) return null;
    try { return JSON.parse(runData.time_steps); } catch { return null; }
  }, [runData?.time_steps]);

  const GENES_RELEVANTES = ['ALK','BRAF','EGFR','ERBB2','FGFR1','FGFR2','FGFR3','KRAS','MET','NRG1','NTRK1','NTRK2','NTRK3','RET','ROS1'];

  const varscanList = useMemo(() => {
    if (!runData?.varscan_details) return [];
    try { return JSON.parse(runData.varscan_details); } catch { return []; }
  }, [runData?.varscan_details]);

  const mutectList = useMemo(() => {
    if (!runData?.mutect_details) return [];
    try { return JSON.parse(runData.mutect_details); } catch { return []; }
  }, [runData?.mutect_details]);

  const lofreqList = useMemo(() => {
    if (!runData?.lofreq_details) return [];
    try { return JSON.parse(runData.lofreq_details); } catch { return []; }
  }, [runData?.lofreq_details]);


  const activeList = useMemo(() => {
    if (activeCallerTab === 'varscan')   return varscanList;
    if (activeCallerTab === 'mutect')    return mutectList;
    if (activeCallerTab === 'lofreq')    return lofreqList;
    if (activeCallerTab === 'consensus') return consensusList;
    return [];
  }, [activeCallerTab, varscanList, mutectList, lofreqList, consensusList]);

  // Painel de genes relevantes: apenas variantes de consenso
  const painelGenes = useMemo(() => {
    return GENES_RELEVANTES.map(gene => {
      const hits = consensusList.filter(v => v.gene === gene);
      const vistos = new Set();
      const unicos = hits.filter(v => {
        const chave = `${v.chrom}:${v.pos}:${v.ref}:${v.alt}`;
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      });
      return { gene, variantes: unicos };
    });
  }, [consensusList]);

  const cromossomosDisponiveis = useMemo(
    () => ['Todos', ...new Set(activeList.map(v => v.chrom).filter(Boolean))],
    [activeList]
  );

  const variantesFiltradas = useMemo(
    () => filtroCromossomo === 'Todos' ? activeList : activeList.filter(v => v.chrom === filtroCromossomo),
    [activeList, filtroCromossomo]
  );

  const variantesBusca = useMemo(() => {
    const termo = buscaGene.trim().toLowerCase();
    if (!termo) return variantesFiltradas;
    return variantesFiltradas.filter(v =>
      (v.gene ?? '').toLowerCase().includes(termo) ||
      (v.hgvs_c ?? '').toLowerCase().includes(termo) ||
      (v.hgvs_p ?? '').toLowerCase().includes(termo)
    );
  }, [variantesFiltradas, buscaGene]);

  const variantesIN = useMemo(
    () => variantesBusca.filter(v => _classifyVariant(v) === 'IN'),
    [variantesBusca]
  );
  const variantesOUT = useMemo(
    () => variantesBusca.filter(v => _classifyVariant(v) === 'OUT'),
    [variantesBusca]
  );
  const displayedVariants = variantViewMode === 'IN' ? variantesIN : variantesOUT;
  const hasVariants = runData?.variants_consensus != null;

  if (!uuid) {
    return (
      <div className="w-full py-10 flex flex-col items-center justify-center text-slate-500 bg-white rounded-xl border border-slate-200 shadow-sm p-10 mt-6">
        <ClipboardList size={48} className="text-slate-300 mb-4" />
        <h2 className="text-xl font-bold text-slate-700">Nenhuma análise selecionada</h2>
        <p className="mt-2 text-center text-sm max-w-sm">
          Para visualizar um laudo, acesse o Dashboard e clique em{' '}
          <span className="font-semibold text-violet-700">Resultado</span> na linha da análise concluída.
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-6 flex items-center gap-2 px-4 py-2 bg-violet-700 hover:bg-violet-800 text-white rounded-lg font-medium transition-colors text-sm"
        >
          <ChevronLeft size={16} /> Ir para o Dashboard
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-full py-10 flex flex-col items-center justify-center text-slate-500 bg-white rounded-xl border border-slate-200 shadow-sm p-10 mt-6">
        <p className="text-sm">Carregando análise...</p>
      </div>
    );
  }

  if (error || !runData) {
    return (
      <div className="w-full py-10 flex flex-col items-center justify-center text-slate-500 bg-white rounded-xl border border-slate-200 shadow-sm p-10 mt-6">
        <FileText size={48} className="text-slate-300 mb-4" />
        <h2 className="text-xl font-bold text-slate-700">Análise não encontrada</h2>
        <p className="mt-2 text-center text-sm">{error || 'Para visualizar um laudo, acesse a Dashboard e clique em "Resultado" na tabela de corridas concluídas.'}</p>
        <button
          onClick={() => navigate('/')}
          className="mt-6 px-4 py-2 bg-violet-700 hover:bg-violet-800 text-white rounded-lg font-medium transition-colors"
        >
          Voltar para Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="w-full py-6 space-y-6">

      {/* ── BARRA DE AÇÕES DE TOPO ── */}
      <div className="flex items-center justify-between print:hidden">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-slate-500 hover:text-violet-700 transition-colors font-medium text-sm"
        >
          <ChevronLeft size={16} /> Voltar
        </button>
        <div className="flex gap-3">
          <a
            href={api.getAnnotatedVcfUrl(uuid)}
            download
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 font-medium text-sm shadow-sm transition-colors"
          >
            <Download size={16} /> Baixar VCF Anotado
          </a>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-violet-700 text-white rounded-lg hover:bg-violet-800 font-medium text-sm shadow-sm transition-colors"
          >
            <Download size={16} /> Exportar PDF
          </button>
        </div>
      </div>

      {/* ── CABEÇALHO GLOBAL (sempre visível, independente da aba) ── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print:shadow-none print:border-none">

        {/* Título do laudo */}
        <div className="px-8 py-6 border-b border-slate-200 bg-slate-50 flex justify-between items-start print:bg-slate-50">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Dna className="text-violet-700" size={24} />
              {runData.patient_id}
              {runData.biological_sex && (
                <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border uppercase tracking-wider bg-slate-100 text-slate-600 border-slate-200">
                  {runData.biological_sex === 'M' ? 'Masculino' : 'Feminino'}
                </span>
              )}
            </h1>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-slate-700">ID do Relatório</p>
            <p className="text-xs font-mono text-slate-500">{runData.patient_uuid.split('-')[0].toUpperCase()}-2026</p>
            <p className="text-[10px] font-mono text-slate-400 mt-1 break-all">{runData.patient_uuid}</p>
          </div>
        </div>

        {/* Dados do paciente — contexto global */}
        <div className="border-b border-slate-100">
          <div className="p-6">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Médico Solicitante</p>
            <p className="text-sm text-slate-700 font-medium">{runData.doctor}</p>
          </div>
        </div>

        {/* ── NAVEGAÇÃO DE ABAS ── */}
        <div className="flex border-b border-slate-200 px-6 print:hidden">
          {[
            { key: 'laudo',  label: 'Resultados',            icon: GitMerge      },
            { key: 'qc',     label: 'Controle de Qualidade', icon: ShieldCheck  },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActivePageTab(key)}
              className={`flex items-center gap-2 px-5 py-4 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                activePageTab === key
                  ? 'border-violet-600 text-violet-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* ── ABA: LAUDO CLÍNICO ── */}
        {activePageTab === 'laudo' && (
          <div className="p-8 space-y-8">

            {/* Painel de Genes Relevantes */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                <Dna size={17} className="text-violet-700" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Painel de Genes Relevantes</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Genes de interesse clínico rastreados nesta análise.</p>
                </div>
              </div>
              {vcfFetchError && (
                <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-xs text-amber-700">
                  <AlertTriangle size={14} /> Não foi possível carregar variantes do VCF — painel pode estar incompleto.
                </div>
              )}
              <div className="grid grid-cols-3 sm:grid-cols-5 divide-x divide-y divide-slate-100">
                {painelGenes.map(({ gene, variantes }) => {
                  const detectado = variantes.length > 0;
                  return (
                    <div key={gene} className="p-4">
                      <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${detectado ? 'text-slate-800' : 'text-slate-400'}`}>
                        {gene}
                      </p>
                      {detectado ? (
                        <ul className="space-y-0.5">
                          {variantes.map((v, i) => (
                            <li key={i} className="text-[11px] font-mono text-slate-800 leading-snug">
                              {v.hgvs_p || v.hgvs_c || `${v.ref}>${v.alt}`}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[11px] text-slate-400">Nenhum detectado</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>


            {/* Banner de Alerta de Qualidade Subótima — renderizado quando qc_warning_flag = true */}
            {timeSteps?.qc_warning_flag === true && (
              <div className="border border-slate-300 bg-slate-50 p-4 flex gap-3 print:border-slate-400">
                <div className="shrink-0 mt-0.5">
                  <AlertTriangle size={16} className="text-slate-500" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                    Aviso de Qualidade Subótima de Sequenciamento
                  </p>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    A análise de métricas nativas do painel revelou uma cobertura genômica
                    irregular{' '}
                    <span className="font-semibold font-mono bg-slate-100 border border-slate-300 px-1 py-0.5 text-slate-800">
                      ({timeSteps.qc_warning_message})
                    </span>
                    . Esta degradação reduz severamente o poder estatístico da ferramenta para a
                    detecção de variantes somáticas em baixa frequência alélica (VAF &lt; 5%).
                    Recomenda-se extrema cautela na interpretação de resultados negativos
                    (ausência de mutação). A possibilidade de falsos-negativos nas regiões de
                    baixa cobertura e zonas cegas (dropouts) não pode ser descartada, e os
                    achados positivos devem ser correlacionados com o quadro clínico.
                  </p>
                </div>
              </div>
            )}

            {/* Variantes com sub-abas caller */}
            {hasVariants ? (
              <div>
                <h3 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-2 mb-5 flex items-center gap-2">
                  <GitMerge size={20} className="text-violet-700" />
                  Identificação de Variantes (Tumor-Only)
                </h3>

                <div className="flex border-b-2 border-slate-300 mb-5 gap-0">
                  {[
                    { key: 'varscan',   label: 'VarScan2', count: runData.variants_varscan },
                    { key: 'mutect',    label: 'Mutect2',  count: runData.variants_mutect  },
                    { key: 'lofreq',    label: 'LoFreq',   count: lofreqList.length || null },
                    { key: 'consensus', label: 'Consenso', count: runData.variants_consensus },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => { setActiveCallerTab(tab.key); setFiltroCromossomo('Todos'); setVariantViewMode(tab.key === 'consensus' ? 'OUT' : 'IN'); setBuscaGene(''); }}
                      className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-[2px] transition-colors flex items-center gap-2 ${
                        activeCallerTab === tab.key
                          ? 'border-slate-900 text-slate-900 bg-white'
                          : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {tab.label}
                      <span className={`text-xs font-mono font-bold px-1.5 py-0.5 ${
                        activeCallerTab === tab.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {tab.count ?? 0}
                      </span>
                    </button>
                  ))}
                </div>

                {(() => {
                  const totalPages      = Math.ceil(displayedVariants.length / itemsPerPage);
                  const indexOfLast     = currentPage * itemsPerPage;
                  const currentVariants = displayedVariants.slice(indexOfLast - itemsPerPage, indexOfLast);

                  return (
                    <>
                      <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
                        {activeCallerTab !== 'consensus' && (
                          <div className="flex items-start gap-2 px-1 text-xs text-slate-500">
                            <span className="mt-0.5 shrink-0 font-bold text-slate-400">i</span>
                            <span>
                              <span className="font-semibold text-slate-700">{activeList.length}</span> variantes com anotação SnpEff
                              {(() => {
                                const totalCaller = activeCallerTab === 'varscan' ? runData.variants_varscan
                                  : activeCallerTab === 'mutect' ? runData.variants_mutect
                                  : null;
                                return totalCaller != null
                                  ? <> de <span className="font-semibold text-slate-700">{totalCaller}</span> chamadas pelo caller</>
                                  : null;
                              })()}
                              . Ordenadas por impacto (HIGH → MODIFIER).
                            </span>
                          </div>
                        )}
                        {activeCallerTab === 'consensus' && <div />}

                        <div className="flex items-center gap-2 flex-1 min-w-0 max-w-xs">
                          <div className="relative w-full">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-xs">⌕</span>
                            <input
                              type="text"
                              placeholder="Buscar gene (ex: EGFR, ALK…)"
                              value={buscaGene}
                              onChange={e => setBuscaGene(e.target.value)}
                              className="w-full pl-7 pr-3 py-1.5 text-xs border border-slate-200 bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:border-slate-500"
                            />
                            {buscaGene && (
                              <button
                                onClick={() => setBuscaGene('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                              >✕</button>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <label htmlFor="filtro-chr" className="text-xs font-semibold text-slate-500 whitespace-nowrap">
                            Filtrar por Chr:
                          </label>
                          <select
                            id="filtro-chr"
                            value={filtroCromossomo}
                            onChange={e => setFiltroCromossomo(e.target.value)}
                            className="text-xs border border-slate-200 px-3 py-1.5 bg-white text-slate-700 font-mono font-semibold focus:outline-none focus:border-slate-500 cursor-pointer"
                          >
                            {cromossomosDisponiveis.map(chr => (
                              <option key={chr} value={chr}>{chr === 'Todos' ? 'Todos os cromossomos' : chr}</option>
                            ))}
                          </select>
                          {filtroCromossomo !== 'Todos' && (
                            <span className="text-xs text-slate-600 font-semibold">
                              {variantesFiltradas.length} variante{variantesFiltradas.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Toggle IN / OUT — estilo Ion Reporter */}
                      <div className="mb-4 flex items-center gap-2">
                        <button
                          onClick={() => setVariantViewMode('IN')}
                          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border transition-colors ${
                            variantViewMode === 'IN'
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-600 border-slate-300 hover:border-slate-600 hover:text-slate-800'
                          }`}
                        >
                          Variantes Relevantes
                          <span className={`text-xs font-mono font-bold px-1.5 py-0.5 ${
                            variantViewMode === 'IN' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {variantesIN.length}
                          </span>
                        </button>
                        <button
                          onClick={() => setVariantViewMode('OUT')}
                          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border transition-colors ${
                            variantViewMode === 'OUT'
                              ? 'bg-slate-700 text-white border-slate-700'
                              : 'bg-white text-slate-600 border-slate-300 hover:border-slate-600'
                          }`}
                        >
                          {activeCallerTab === 'consensus' ? 'Todas as Variantes' : 'Variantes Removidas pelo Filtro'}
                          <span className={`text-xs font-mono font-bold px-1.5 py-0.5 ${
                            variantViewMode === 'OUT' ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {variantesOUT.length}
                          </span>
                        </button>
                      </div>

                      <VariantTable variants={currentVariants} />

                      {totalPages > 1 && (
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
                          <button
                            onClick={() => setCurrentPage(p => p - 1)}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            Anterior
                          </button>
                          <span className="text-xs text-slate-500 font-medium">
                            Página <span className="font-bold text-slate-700">{currentPage}</span> de{' '}
                            <span className="font-bold text-slate-700">{totalPages}</span>
                            <span className="ml-2 text-slate-400">({displayedVariants.length} variantes)</span>
                          </span>
                          <button
                            onClick={() => setCurrentPage(p => p + 1)}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1.5 text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            Próximo
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <h4 className="font-bold text-amber-800 text-sm mb-1">Nota Técnica</h4>
                <p className="text-xs text-amber-700">Este laudo foi gerado por uma versão anterior do pipeline. A chamada de variantes multi-caller não está disponível para esta análise.</p>
              </div>
            )}

          </div>
        )}

        {/* ── ABA: CONTROLE DE QUALIDADE ── */}
        {activePageTab === 'qc' && (
          <div className="p-8 space-y-8 print:hidden">

            {/* Resumo do Alinhamento */}
            <div>
              <h3 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                <BarChart2 size={20} className="text-violet-700" />
                Resumo do Alinhamento
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                As leituras foram mapeadas contra o genoma de referência{' '}
                <span className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded border border-slate-200">Homo_sapiens_assembly38.fasta</span>{' '}
                utilizando o algoritmo BWA-MEM.
              </p>
              <ul className="space-y-0 text-sm text-slate-600 divide-y divide-slate-50 border border-slate-100 rounded-lg overflow-hidden">
                <li className="flex justify-between items-center px-5 py-3 bg-white">
                  <span className="font-medium">Total de Reads Processados</span>
                  <span className="font-mono font-semibold">{runData.total_reads || '—'}</span>
                </li>
                <li className="flex justify-between items-center px-5 py-3 bg-white">
                  <span className="font-medium">Taxa de Mapeamento</span>
                  <span className={`font-mono font-bold ${runData.mapping_rate ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {runData.mapping_rate || '—'}
                  </span>
                </li>
                <li className="flex justify-between items-center px-5 py-3 bg-white">
                  <span className="font-medium">Profundidade Média (Coverage)</span>
                  <span className="font-mono font-semibold">{runData.mean_coverage || '—'}</span>
                </li>
              </ul>
            </div>

            {/* Telemetria de Performance */}
            {(timeSteps || runData.time_total) && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                  <Timer size={18} className="text-violet-700" />
                  <div>
                    <h3 className="text-md font-bold text-slate-800">Métricas de Performance (Profiling)</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Custo computacional por etapa da pipeline de processamento.</p>
                  </div>
                </div>
                <div className="p-6">
                  {timeSteps && (
                    <ul className="space-y-0 text-sm divide-y divide-slate-50 mb-4">
                      {Object.entries(timeSteps).map(([step, tempo]) => (
                        <li key={step} className="flex justify-between items-center py-2.5">
                          <span className="text-slate-600">{STEP_LABELS[step] ?? step}</span>
                          <span className="font-mono text-slate-700 font-semibold">{tempo}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {runData.time_total && (
                    <div className="flex justify-between items-center bg-slate-900 text-white rounded-lg px-5 py-3 mt-2">
                      <span className="text-sm font-bold flex items-center gap-2">
                        <Zap size={16} className="text-amber-400" />
                        Tempo Total da Pipeline
                      </span>
                      <span className="font-mono font-bold text-amber-400 text-lg">{runData.time_total}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* iFrames FastQC + Qualimap */}
            <div className="grid grid-cols-1 gap-8">
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200 bg-slate-50">
                  <h3 className="text-md font-bold text-slate-800">1. Qualidade Pré-Alinhamento (FastQC)</h3>
                  <p className="text-xs text-slate-500 mt-1">Avaliação bruta das leituras do sequenciador antes do processamento e limpeza.</p>
                </div>
                <div className="w-full h-[520px] bg-slate-50 relative">
                  <iframe
                    src={`http://localhost:8000/api/analysis/${runData.patient_uuid}/qc-report`}
                    title="Relatório FastQC"
                    className="w-full h-full border-none"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      const msg = document.createElement('div');
                      msg.className = 'absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400';
                      msg.innerHTML = '<span style="font-size:2rem">⚠️</span><span style="font-size:0.875rem;font-weight:600">Relatório FastQC indisponível</span><span style="font-size:0.75rem">O arquivo de relatório não foi gerado ou não pôde ser carregado.</span>';
                      e.target.parentNode.appendChild(msg);
                    }}
                  />
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                  <Terminal size={18} className="text-violet-700 shrink-0" />
                  <div>
                    <h3 className="text-md font-bold text-slate-800">2. Controle de Cobertura do Painel (samtools bedcov)</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Profundidade calculada sobre os alvos da Twist Bioscience via samtools bedcov.</p>
                  </div>
                </div>

                {/* Métrica principal — profundidade média global */}
                <div className="px-6 pt-6 pb-4 flex flex-col items-center gap-1 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Profundidade Média do Painel</p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-4xl font-bold font-mono text-violet-700">
                      {runData.mean_coverage ?? 'N/A'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Controle de Cobertura Concluído via Samtools</p>
                </div>

                {/* Métricas de alerta — dropouts e alvos críticos */}
                <div className="grid grid-cols-2 divide-x divide-slate-100">
                  <div className="px-6 py-4 flex flex-col gap-1">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Alvos sem Cobertura (0×)</p>
                    <p className={`text-sm font-mono font-bold mt-0.5 ${
                      timeSteps?.qc_alvos_zerados && timeSteps.qc_alvos_zerados !== 'N/A' && !timeSteps.qc_alvos_zerados.startsWith('0 /')
                        ? 'text-red-600'
                        : 'text-slate-700'
                    }`}>
                      {timeSteps?.qc_alvos_zerados ?? 'N/A'}
                    </p>
                    <p className="text-[10px] text-slate-400 leading-tight">Regiões com profundidade zero (dropout total).</p>
                  </div>
                  <div className="px-6 py-4 flex flex-col gap-1">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cobertura Subótima (&lt; 30×)</p>
                    <p className={`text-sm font-mono font-bold mt-0.5 ${
                      timeSteps?.qc_alvos_criticos && timeSteps.qc_alvos_criticos !== 'N/A' && !timeSteps.qc_alvos_criticos.startsWith('0 /')
                        ? 'text-amber-600'
                        : 'text-slate-700'
                    }`}>
                      {timeSteps?.qc_alvos_criticos ?? 'N/A'}
                    </p>
                    <p className="text-[10px] text-slate-400 leading-tight">Alvos abaixo do limiar de 30× para 5% VAF somático.</p>
                  </div>
                </div>

                <p className="px-6 py-3 text-[10px] text-slate-400 border-t border-slate-100">
                  Dados de cobertura base a base salvos em formato TXT no diretório de processamento.
                </p>
              </div>
            </div>

          </div>
        )}


      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileText, User, Activity, ChevronLeft, Download, Dna, BarChart2, GitMerge, Timer, Zap, FlaskConical } from 'lucide-react';
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
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${styles[impact] ?? styles.MODIFIER}`}>
      {impact}
    </span>
  );
}

// Mapeamento de nomes internos de etapas para labels legíveis no UI
const STEP_LABELS = {
  fastqc:     'FastQC (QC Bruto)',
  trimmomatic:'Trimmomatic (Limpeza)',
  bwa_mem:    'BWA-MEM (Alinhamento)',
  samtools:   'Samtools (Conversão BAM)',
  qualimap:   'Qualimap (QC BAM)',
  varscan2:   'VarScan2 (Chamada de Variantes)',
  mutect2:    'Mutect2 (Chamada de Variantes)',
};

export default function Results() {
  const { uuid } = useParams();
  const navigate = useNavigate();
  const [runData, setRunData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!uuid) { setLoading(false); return; }
    api.getAnalysis(uuid)
      .then(data => setRunData(data))
      .catch(() => setError('Não foi possível carregar os dados desta análise.'))
      .finally(() => setLoading(false));
  }, [uuid]);

  // Parse defensivo do JSON de telemetria — análises antigas retornam null sem crashar
  const timeSteps = (() => {
    if (!runData?.time_steps) return null;
    try { return JSON.parse(runData.time_steps); } catch { return null; }
  })();

  // Parse defensivo do JSON de anotação SnpEff
  const annotationSummary = (() => {
    if (!runData?.annotation_summary) return null;
    try { return JSON.parse(runData.annotation_summary); } catch { return null; }
  })();

  const hasVariants = runData?.variants_consensus != null;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-10 flex flex-col items-center justify-center text-slate-500 bg-white rounded-xl border border-slate-200 shadow-sm p-10 mt-6">
        <p className="text-sm">Carregando análise...</p>
      </div>
    );
  }

  if (error || !runData) {
    return (
      <div className="max-w-4xl mx-auto py-10 flex flex-col items-center justify-center text-slate-500 bg-white rounded-xl border border-slate-200 shadow-sm p-10 mt-6">
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
    <div className="max-w-5xl mx-auto py-6 space-y-8">

      {/* ========================================== */}
      {/* BARRA DE AÇÕES DE TOPO (Oculta na impressão) */}
      {/* ========================================== */}
      <div className="flex items-center justify-between print:hidden">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-slate-500 hover:text-violet-700 transition-colors font-medium text-sm"
        >
          <ChevronLeft size={16} /> Voltar
        </button>
        <div className="flex gap-3">
          {/* Botão de download do VCF anotado — só aparece se a anotação existir */}
          {annotationSummary && (
            <a
              href={api.getAnnotatedVcfUrl(uuid)}
              download
              className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 font-medium text-sm shadow-sm transition-colors"
            >
              <Download size={16} /> Baixar VCF Anotado
            </a>
          )}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-violet-700 text-white rounded-lg hover:bg-violet-800 font-medium text-sm shadow-sm transition-colors"
          >
            <Download size={16} /> Exportar PDF
          </button>
        </div>
      </div>

      {/* ========================================== */}
      {/* 1. ZONA DO LAUDO (Imprimível)              */}
      {/* ========================================== */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print:shadow-none print:border-none">

        {/* Cabeçalho do Laudo */}
        <div className="p-8 border-b border-slate-200 bg-slate-50 flex justify-between items-start print:bg-slate-50">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Dna className="text-violet-700" size={24} />
              Laudo Genômico Computacional
            </h1>
            <p className="text-slate-500 mt-1">Gerado automaticamente pelo PantherFlow Clinical</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-slate-700">ID do Relatório</p>
            <p className="text-xs font-mono text-slate-500">{runData.patient_uuid.split('-')[0].toUpperCase()}-2026</p>
          </div>
        </div>

        {/* Informações Clínicas */}
        <div className="grid grid-cols-2 gap-6 p-8 border-b border-slate-100">
          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Paciente</p>
              <p className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <User size={18} className="text-slate-400" /> {runData.patient_id}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Médico Solicitante</p>
              <p className="text-md text-slate-700">{runData.doctor}</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Protocolo Executado</p>
              <p className="text-md font-semibold text-violet-700 flex items-center gap-2">
                <Activity size={18} /> {runData.protocol}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">UUID de Processamento</p>
              <p className="text-xs font-mono text-slate-500">{runData.patient_uuid}</p>
            </div>
          </div>
        </div>

        {/* Resumo Biológico */}
        <div className="p-8 space-y-8">

          {/* --- Alinhamento --- */}
          <div>
            <h3 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4">Resumo do Alinhamento</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              O arquivo FASTQ fornecido foi submetido ao pipeline de bioinformática PantherFlow. As leituras foram mapeadas com sucesso contra o genoma de referência{' '}
              <span className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded border border-slate-200">Homo_sapiens_assembly38.fasta</span>{' '}
              utilizando o algoritmo BWA-MEM.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="font-medium">Total de Reads Processados:</span>
                <span className="font-mono font-semibold">{runData.total_reads || "Calculando..."}</span>
              </li>
              <li className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="font-medium">Taxa de Mapeamento:</span>
                <span className={`font-mono font-bold ${runData.mapping_rate ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {runData.mapping_rate || "Calculando..."}
                </span>
              </li>
              <li className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="font-medium">Profundidade Média (Coverage):</span>
                <span className="font-mono font-semibold">{runData.mean_coverage || "Calculando..."}</span>
              </li>
            </ul>
          </div>

          {/* --- Seção de Variantes (renderiza apenas se os dados existirem) --- */}
          {hasVariants && (
            <div>
              <h3 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                <GitMerge size={20} className="text-violet-700" />
                Identificação de Variantes (Tumor-Only)
              </h3>

              <div className="grid grid-cols-3 gap-4">
                {/* VarScan2 */}
                <div className="border border-slate-200 rounded-lg p-4 text-center bg-slate-50">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">VarScan2</p>
                  <p className="text-3xl font-bold text-slate-700 font-mono">
                    {runData.variants_varscan ?? '—'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">variantes brutas</p>
                </div>

                {/* Mutect2 */}
                <div className="border border-slate-200 rounded-lg p-4 text-center bg-slate-50">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Mutect2</p>
                  <p className="text-3xl font-bold text-slate-700 font-mono">
                    {runData.variants_mutect ?? '—'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">variantes brutas</p>
                </div>

                {/* Consenso — destaque visual */}
                <div className="border-2 border-violet-300 rounded-lg p-4 text-center bg-violet-50 relative">
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-violet-700 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Consenso
                  </span>
                  <p className="text-xs font-bold text-violet-500 uppercase tracking-wider mb-2 mt-1">Multi-Caller</p>
                  <p className="text-3xl font-bold text-violet-700 font-mono">
                    {runData.variants_consensus}
                  </p>
                  <p className="text-xs text-violet-500 mt-1">concordantes entre os algoritmos</p>
                </div>
              </div>
            </div>
          )}

          {/* Nota Técnica — exibe aviso legado apenas para análises sem dados de variantes */}
          {!hasVariants && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg print:border-amber-400">
              <h4 className="font-bold text-amber-800 text-sm mb-1">Nota Técnica</h4>
              <p className="text-xs text-amber-700">Este laudo foi gerado por uma versão anterior do pipeline. A chamada de variantes multi-caller não está disponível para esta análise.</p>
            </div>
          )}

        </div>
      </div>

      {/* ========================================== */}
      {/* 2. ZONA DE AUDITORIA INTERATIVA            */}
      {/* (Não imprimível)                           */}
      {/* ========================================== */}
      {runData.status === 'completed' && (
        <div className="space-y-6 print:hidden">

          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-2 pt-4">
            <BarChart2 size={24} className="text-violet-700" />
            Controle de Qualidade Detalhado
          </h2>

          {/* --- Seção de Telemetria (renderiza apenas se os dados existirem) --- */}
          {(timeSteps || runData.time_total) && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                <Timer size={18} className="text-violet-700" />
                <div>
                  <h3 className="text-md font-bold text-slate-800">Métricas de Performance (Profiling)</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Custo computacional por etapa da pipeline de processamento.</p>
                </div>
              </div>
              <div className="p-6">
                {timeSteps && (
                  <ul className="space-y-1 text-sm mb-4">
                    {Object.entries(timeSteps).map(([step, tempo]) => (
                      <li key={step} className="flex justify-between items-center py-2 border-b border-slate-50">
                        <span className="text-slate-600">{STEP_LABELS[step] ?? step}</span>
                        <span className="font-mono text-slate-700 font-semibold">{tempo}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Tempo Total em destaque */}
                {runData.time_total && (
                  <div className="flex justify-between items-center bg-slate-900 text-white rounded-lg px-4 py-3 mt-2">
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

          {/* --- Seção de Anotação Funcional (SnpEff) --- */}
          {annotationSummary && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FlaskConical size={18} className="text-violet-700" />
                  <div>
                    <h3 className="text-md font-bold text-slate-800">Anotação Funcional (SnpEff GRCh38.99)</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Impacto biológico das variantes de consenso identificadas.</p>
                  </div>
                </div>
                <a
                  href={api.getAnnotatedVcfUrl(uuid)}
                  download
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <Download size={13} /> VCF Completo
                </a>
              </div>

              {/* Cards de totais */}
              <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
                <div className="p-4 text-center">
                  <p className="text-2xl font-bold text-slate-800 font-mono">{annotationSummary.total_annotated}</p>
                  <p className="text-xs text-slate-500 mt-1 font-medium uppercase tracking-wider">Total</p>
                </div>
                <div className="p-4 text-center">
                  <p className="text-2xl font-bold text-red-600 font-mono">{annotationSummary.high_impact}</p>
                  <p className="text-xs text-red-400 mt-1 font-bold uppercase tracking-wider">HIGH</p>
                </div>
                <div className="p-4 text-center">
                  <p className="text-2xl font-bold text-amber-500 font-mono">{annotationSummary.moderate_impact}</p>
                  <p className="text-xs text-amber-400 mt-1 font-bold uppercase tracking-wider">MODERATE</p>
                </div>
                <div className="p-4 text-center">
                  <p className="text-2xl font-bold text-slate-400 font-mono">
                    {annotationSummary.low_impact + annotationSummary.modifier_impact}
                  </p>
                  <p className="text-xs text-slate-400 mt-1 font-bold uppercase tracking-wider">LOW / MODIFIER</p>
                </div>
              </div>

              {/* Tabela de top variantes */}
              {annotationSummary.top_variants?.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 text-xs uppercase tracking-wider">
                        <th className="p-3 pl-4 font-semibold">Gene</th>
                        <th className="p-3 font-semibold">Posição</th>
                        <th className="p-3 font-semibold">Ref → Alt</th>
                        <th className="p-3 font-semibold">Efeito</th>
                        <th className="p-3 font-semibold">Impacto</th>
                        <th className="p-3 pr-4 font-semibold">HGVS (Proteína)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {annotationSummary.top_variants.map((v, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 pl-4 font-bold text-slate-800">{v.gene || '—'}</td>
                          <td className="p-3 font-mono text-xs text-slate-500">{v.chrom}:{v.pos}</td>
                          <td className="p-3 font-mono text-xs text-slate-600">
                            <span className="text-slate-400">{v.ref}</span>
                            <span className="mx-1 text-slate-300">→</span>
                            <span>{v.alt}</span>
                          </td>
                          <td className="p-3 text-xs text-slate-600">{v.effect?.replace(/_/g, ' ')}</td>
                          <td className="p-3">
                            <ImpactBadge impact={v.impact} />
                          </td>
                          <td className="p-3 pr-4 font-mono text-xs text-slate-500">{v.hgvs_p}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-8">
            {/* Relatório 1: FastQC */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-200 bg-slate-50">
                <h3 className="text-md font-bold text-slate-800">1. Qualidade Pré-Alinhamento (FastQC)</h3>
                <p className="text-xs text-slate-500 mt-1">Avaliação bruta das leituras do sequenciador antes do processamento e limpeza.</p>
              </div>
              <div className="w-full h-[500px] bg-slate-50">
                <iframe
                  src={`http://localhost:8000/api/analysis/${runData.patient_uuid}/qc-report`}
                  title="Relatório FastQC"
                  className="w-full h-full border-none"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </div>
            </div>

            {/* Relatório 2: Qualimap */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-200 bg-slate-50">
                <h3 className="text-md font-bold text-slate-800">2. Qualidade do Mapeamento BAM (Qualimap)</h3>
                <p className="text-xs text-slate-500 mt-1">Análise de cobertura, profundidade e qualidade do alinhamento no genoma de referência.</p>
              </div>
              <div className="w-full h-[600px] bg-slate-50">
                <iframe
                  src={`http://localhost:8000/api/analysis/${runData.patient_uuid}/qualimap/qualimapReport.html`}
                  title="Relatório Qualimap"
                  className="w-full h-full border-none"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </div>
            </div>
          </div>

        </div>
      )}

    </div>
  );
}

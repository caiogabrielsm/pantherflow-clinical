import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileText, User, Activity, ChevronLeft, Download, Dna, BarChart2 } from 'lucide-react';

export default function Results() {
  const location = useLocation();
  const navigate = useNavigate();
  
  const runData = location.state?.runData;

  if (!runData) {
    return (
      <div className="max-w-4xl mx-auto py-10 flex flex-col items-center justify-center text-slate-500 bg-white rounded-xl border border-slate-200 shadow-sm p-10 mt-6">
        <FileText size={48} className="text-slate-300 mb-4" />
        <h2 className="text-xl font-bold text-slate-700">Nenhuma análise selecionada</h2>
        <p className="mt-2 text-center text-sm">Para visualizar um laudo, acesse a Dashboard e clique em "Resultado" na tabela de corridas concluídas.</p>
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
          <button 
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-violet-700 text-white rounded-lg hover:bg-violet-800 font-medium text-sm shadow-sm transition-colors"
          >
            <Download size={16} /> Exportar PDF
          </button>
        </div>
      </div>

      {/* ========================================== */}
      {/* 1. ZONA DO LAUDO (Imprimível) */}
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
                <User size={18} className="text-slate-400" /> {runData.patientId}
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
        <div className="p-8 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4">Resumo do Alinhamento</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              O arquivo FASTQ fornecido foi submetido ao pipeline de bioinformática PantherFlow. As leituras foram mapeadas com sucesso contra o genoma de referência <span className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded border border-slate-200">Homo_sapiens_assembly38.fasta</span> utilizando o algoritmo BWA-MEM. 
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

          <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-lg print:border-amber-400">
            <h4 className="font-bold text-amber-800 text-sm mb-1">Nota Técnica</h4>
            <p className="text-xs text-amber-700">Este é um relatório de alinhamento (.bam). A chamada de variantes requer etapas adicionais na próxima atualização do pipeline.</p>
          </div>
        </div>
      </div>

      {/* ========================================== */}
      {/* 2. ZONA DE AUDITORIA INTERATIVA (Não imprimível) */}
      {/* ========================================== */}
      {runData.status === 'completed' && (
        <div className="space-y-6 print:hidden">
          
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-2 pt-4">
            <BarChart2 size={24} className="text-violet-700"/>
            Controle de Qualidade Detalhado
          </h2>

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
import React, { useState, useEffect } from 'react';
import { Activity, CheckCircle, XCircle, Terminal, Cpu } from 'lucide-react';
import { api } from '../../common/data/api';
import HardwareMonitor from './ui/HardwareMonitor';

export default function MonitorFeature() {
  const [latestRun, setLatestRun] = useState(null);
  const [sysHealth, setSysHealth] = useState(null);

  const fetchStatus = async () => {
    try {
      const historyData = await api.getHistory();
      if (historyData && historyData.length > 0) {
        setLatestRun(historyData[0]);
      }
      
      const healthData = await api.getHealth();
      setSysHealth(healthData);
    } catch (error) {
      console.error("Erro ao buscar status do monitoramento:", error);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  if (!latestRun) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 flex flex-col items-center justify-center text-slate-500">
        <Activity className="animate-pulse mb-3 text-slate-300" size={40} />
        <p>Nenhuma análise em andamento ou no histórico recente.</p>
      </div>
    );
  }

  const isProcessing = latestRun.status === 'processing';
  const isCompleted = latestRun.status === 'completed';
  const isFailed = latestRun.status === 'failed';

  return (
    /* Mudamos para um GRID layout: 1 coluna no celular, 3 colunas em telas grandes */
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
      
      {/* COLUNA ESQUERDA (Ocupa 2 espaços): CARD DO PIPELINE */}
      <div className="xl:col-span-2 flex flex-col gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className={`p-6 flex items-center justify-between border-b 
            ${isProcessing ? 'border-amber-100 bg-amber-50/30' : ''}
            ${isCompleted ? 'border-emerald-100 bg-emerald-50/30' : ''}
            ${isFailed ? 'border-red-100 bg-red-50/30' : 'border-slate-100'}
          `}>
            <div>
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Cpu className={isProcessing ? "text-amber-500" : "text-slate-400"} size={24} />
                Processamento Ativo
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Paciente: <span className="font-semibold text-slate-700">{latestRun.patientId}</span> | 
                Protocolo: <span className="font-semibold text-slate-700">{latestRun.protocol}</span>
              </p>
            </div>
            
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-sm border border-slate-100">
              {isProcessing && <Activity size={18} className="text-amber-500 animate-spin" />}
              {isCompleted && <CheckCircle size={18} className="text-emerald-500" />}
              {isFailed && <XCircle size={18} className="text-red-500" />}
              <span className="font-bold text-sm uppercase tracking-wider">
                {isProcessing && <span className="text-amber-600">Em Execução</span>}
                {isCompleted && <span className="text-emerald-600">Concluído</span>}
                {isFailed && <span className="text-red-600">Falha</span>}
              </span>
            </div>
          </div>

          <div className="p-6 bg-slate-900 text-emerald-400 font-mono text-sm h-[400px] overflow-y-auto">
            <div className="flex items-center gap-2 text-slate-400 mb-4 pb-2 border-b border-slate-700/50">
              <Terminal size={16} /> Console do Pipeline (WSL2 Docker)
            </div>
            <div className="space-y-2">
              <p className="text-slate-300">&gt; Inicializando ambiente isolado para UUID: {latestRun.patient_uuid || latestRun.id}...</p>
              <p className="text-slate-300">&gt; Descompactando FASTQ e validando integridade...</p>
              {isProcessing && <p className="animate-pulse text-amber-400">&gt; Executando BWA (Burrows-Wheeler Aligner)...</p>}
              {isCompleted && (
                <>
                  <p>&gt; Executando BWA (Burrows-Wheeler Aligner)... [OK]</p>
                  <p>&gt; Mapeamento concluído. Gerando arquivo .sam...</p>
                  <p>&gt; Executando Samtools (conversão SAM para BAM)... [OK]</p>
                  <p className="text-emerald-300 font-bold mt-4">&gt; PIPELINE FINALIZADO COM SUCESSO.</p>
                </>
              )}
              {isFailed && <p className="text-red-400 font-bold mt-4">&gt; ERRO FATAL: Falha na execução do pipeline.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* COLUNA DIREITA (Ocupa 1 espaço): MONITOR DE CARGA DO SISTEMA */}
      <div className="xl:col-span-1 sticky top-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <HardwareMonitor sysHealth={sysHealth} />
        </div>
      </div>

    </div>
  );
}
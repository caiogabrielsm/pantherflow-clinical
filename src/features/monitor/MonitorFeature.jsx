import React, { useState, useEffect } from 'react';
import { Activity, CheckCircle, XCircle, Terminal, Cpu } from 'lucide-react';
import { useLocation } from 'react-router-dom'; // <--- IMPORTANTE: Pegar dados da navegação
import { api } from '../../common/data/api';
import HardwareMonitor from './ui/HardwareMonitor';

export default function MonitorFeature() {
  const location = useLocation();
  const [latestRun, setLatestRun] = useState(null);
  const [sysHealth, setSysHealth] = useState(null);
  
  // --- O NOVO RADAR DE LOGS (TEMPO REAL) ---
  const [consoleLogs, setConsoleLogs] = useState("> Aguardando inicialização do pipeline...\n");
  
  // Verifica se a tela anterior passou um UUID específico para monitorar
  const targetUuid = location.state?.activeUuid;

  const fetchStatus = async () => {
    try {
      const historyData = await api.getHistory();
      if (historyData && historyData.length > 0) {
        // Se viemos do botão "Processar", foca na análise daquele UUID. 
        // Se não, foca na análise mais recente da fila.
        const focusRun = targetUuid 
          ? historyData.find(run => run.patient_uuid === targetUuid) || historyData[0]
          : historyData[0];
          
        setLatestRun(focusRun);
      }
      
      const healthData = await api.getHealth();
      setSysHealth(healthData);
    } catch (error) {
      console.error("Erro ao buscar status do monitoramento:", error);
    }
  };

  // Radar 1: Status Geral e Hardware (a cada 3s)
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [targetUuid]);

  // Radar 2: Logs em Tempo Real (a cada 2s)
  useEffect(() => {
    let logInterval;

    if (latestRun?.patient_uuid && latestRun?.status === 'processing') {
      logInterval = setInterval(async () => {
        try {
          const data = await api.getConsoleLogs(latestRun.patient_uuid);
          if (data) setConsoleLogs(data.logs);
        } catch (error) {
          console.error("Falha ao buscar logs da pipeline:", error);
        }
      }, 2000);
    } 
    // Se não estiver mais processando, fazemos um último fetch para garantir o log final
    else if (latestRun?.patient_uuid && (latestRun?.status === 'completed' || latestRun?.status === 'failed')) {
        api.getConsoleLogs(latestRun.patient_uuid)
          .then(data => { if (data) setConsoleLogs(data.logs); })
          .catch(err => console.error(err));
    }

    return () => clearInterval(logInterval);
  }, [latestRun?.patient_uuid, latestRun?.status]);


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
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
      
      {/* COLUNA ESQUERDA: CARD DO PIPELINE */}
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
                {isProcessing ? "Processamento Ativo" : "Última Análise Registrada"}
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Paciente: <span className="font-semibold text-slate-700">{latestRun.patient_id}</span> |
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

          {/* O NOVO TERMINAL EM TEMPO REAL */}
          <div className="p-6 bg-slate-900 shadow-inner">
            <div className="flex items-center justify-between text-slate-400 mb-4 pb-2 border-b border-slate-700/50">
              <span className="flex items-center gap-2">
                <Terminal size={16} /> Console do Pipeline (WSL2 Docker)
              </span>
              {isProcessing && (
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
              )}
            </div>
            <div className="font-mono text-xs text-emerald-400 h-[400px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {consoleLogs}
            </div>
          </div>
        </div>
      </div>

      {/* COLUNA DIREITA: MONITOR DE CARGA DO SISTEMA */}
      <div className="xl:col-span-1 sticky top-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <HardwareMonitor sysHealth={sysHealth} />
        </div>
      </div>

    </div>
  );
}
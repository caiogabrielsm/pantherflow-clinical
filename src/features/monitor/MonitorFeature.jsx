import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Terminal, Cpu, Activity } from 'lucide-react';
import { GiPawPrint } from 'react-icons/gi';
import { useLocation, useParams } from 'react-router-dom';
import { api } from '../../common/data/api';
import HardwareMonitor from './ui/HardwareMonitor';

export default function MonitorFeature() {
  const location = useLocation();
  const { uuid: uuidParam } = useParams();
  const [latestRun, setLatestRun] = useState(null);
  const [sysHealth, setSysHealth] = useState(null);
  const [consoleLogs, setConsoleLogs] = useState("> Aguardando inicialização do pipeline...\n");
  const targetUuid = uuidParam || location.state?.activeUuid;

  const fetchStatus = async () => {
    try {
      const historyData = await api.getHistory();
      if (historyData && historyData.length > 0) {
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

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [targetUuid]);

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
    } else if (latestRun?.patient_uuid && (latestRun?.status === 'completed' || latestRun?.status === 'failed')) {
      api.getConsoleLogs(latestRun.patient_uuid)
        .then(data => { if (data) setConsoleLogs(data.logs); })
        .catch(err => console.error(err));
    }
    return () => clearInterval(logInterval);
  }, [latestRun?.patient_uuid, latestRun?.status]);

  if (!latestRun) {
    return (
      <div className="bg-white border border-slate-200 p-10 flex flex-col items-center justify-center text-slate-400 mt-0">
        <Activity className="animate-pulse mb-3 text-slate-300" size={36} />
        <p className="text-sm">Nenhuma análise em andamento ou no histórico recente.</p>
      </div>
    );
  }

  const isProcessing = latestRun.status === 'processing';
  const isCompleted = latestRun.status === 'completed';
  const isFailed = latestRun.status === 'failed';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start pt-4">

      {/* COLUNA ESQUERDA: PIPELINE */}
      <div className="lg:col-span-8 flex flex-col gap-0 border border-slate-200 bg-white">

        {/* Cabeçalho do card */}
        <div className={`px-6 py-4 flex items-center justify-between border-b border-slate-200
          ${isProcessing ? 'bg-amber-50/40' : ''}
          ${isCompleted ? 'bg-emerald-50/30' : ''}
          ${isFailed ? 'bg-red-50/30' : ''}
        `}>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
              {isProcessing ? 'Processamento Ativo' : 'Última Análise Registrada'}
            </p>
            <p className="text-sm text-slate-600">
              Paciente: <span className="font-semibold text-slate-800">{latestRun.patient_id}</span>
              <span className="mx-2 text-slate-300">|</span>
              Protocolo: <span className="font-semibold text-slate-800">{latestRun.protocol}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 border border-slate-200 px-3 py-1.5 bg-white">
            {isProcessing && <GiPawPrint className="text-amber-500 animate-pulse w-4 h-4" />}
            {isCompleted && <CheckCircle size={14} className="text-emerald-500" />}
            {isFailed && <XCircle size={14} className="text-red-500" />}
            <span className="text-xs font-bold uppercase tracking-widest">
              {isProcessing && <span className="text-amber-600">Em Execução</span>}
              {isCompleted && <span className="text-emerald-600">Concluído</span>}
              {isFailed && <span className="text-red-600">Falha</span>}
            </span>
          </div>
        </div>

        {/* Terminal */}
        <div className="bg-slate-900">
          <div className="flex items-center justify-between px-6 py-3 border-b border-slate-700/60">
            <span className="flex items-center gap-2 text-xs text-slate-400 font-mono uppercase tracking-widest">
              <Terminal size={13} /> Console — WSL2 / Docker
            </span>
            {isProcessing && (
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            )}
          </div>
          <div className="font-mono text-xs text-emerald-400 min-h-[580px] h-[580px] overflow-y-auto whitespace-pre-wrap leading-relaxed px-6 py-4">
            {consoleLogs}
          </div>
        </div>
      </div>

      {/* COLUNA DIREITA: HARDWARE */}
      <div className="lg:col-span-4 sticky top-4 border border-slate-200">
        <HardwareMonitor sysHealth={sysHealth} />
      </div>

    </div>
  );
}

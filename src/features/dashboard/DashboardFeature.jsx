// src/features/dashboard/DashboardFeature.jsx
import React, { useState, useEffect } from 'react';
import { Activity, HardDrive } from 'lucide-react';

// Importando a nossa Camada Data
import { api } from './data/api';

// Importando as nossas peças da Camada UI (Filhos)
import UploadForm from './ui/UploadForm';
import RunsTable from './ui/RunsTable';
import HardwareMonitor from './ui/HardwareMonitor';

export default function DashboardFeature() {
  // 1. Estados (A Memória Central)
  const [runs, setRuns] = useState([]);
  const [sysHealth, setSysHealth] = useState(null);

  // 2. Lógica de Busca (Conecta com a Camada Data)
  const fetchData = async () => {
    try {
      // Busca a tabela e a saúde do PC simultaneamente
      const historyData = await api.getHistory();
      const healthData = await api.getHealth();
      
      setRuns(historyData);
      setSysHealth(healthData);
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
    }
  };

  // 3. O Radar (Polling)
  useEffect(() => {
    fetchData(); // Busca inicial
    const interval = setInterval(fetchData, 5000); // Radar a cada 5 segundos
    return () => clearInterval(interval);
  }, []);

  // 4. O Layout Principal
  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-10">
      
      {/* CABEÇALHO */}
      <div className="flex justify-between items-end px-1">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Visão Geral</h2>
          <p className="text-slate-500 mt-1">Status operacional da unidade de sequenciamento.</p>
        </div>
      </div>

      {/* FILHO 1: FORMULÁRIO */}
      {/* Passamos o fetchData para ele chamar quando terminar um upload com sucesso */}
      <UploadForm onUploadSuccess={fetchData} />

      {/* O QUADRO GERAL (Métricas, Tabela e Hardware) */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        
        {/* FAIXA DE MÉTRICAS (Topo do quadro) */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/30">
          
          <div className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Corridas Históricas</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{runs.length}</span>
              </div>
            </div>
            <div className="h-10 w-10 bg-white border border-slate-100 rounded-full flex items-center justify-center text-violet-700 shadow-sm">
              <Activity size={20} />
            </div>
          </div>

          <div className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Armazenamento (SSD)</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">
                  {sysHealth ? sysHealth.disk.label.split(' ')[0] : '--'}
                </span>
                <span className="text-xs text-slate-400">GB livres</span>
              </div>
            </div>
            <div className="h-10 w-10 bg-white border border-slate-100 rounded-full flex items-center justify-center text-amber-500 shadow-sm">
              <HardDrive size={20} />
            </div>
          </div>
        </div>

        {/* ÁREA INFERIOR (Duas Colunas) */}
        <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-slate-100 min-h-[500px]">
          
          {/* FILHO 2: TABELA DE CORRIDAS (Esquerda) */}
          <RunsTable runs={runs} onRunDeleted={fetchData} />

          {/* FILHO 3: MONITOR DE HARDWARE (Direita) */}
          <HardwareMonitor sysHealth={sysHealth} />

        </div>
      </div>
    </div>
  );
}
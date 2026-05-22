import React, { useState, useEffect } from 'react';
import { Activity, HardDrive } from 'lucide-react';
import { api } from '../../common/data/api';
import RunsTable from './ui/RunsTable'; // <-- Tabela importada localmente!

export default function DashboardFeature() {
  const [runs, setRuns] = useState([]);
  const [sysHealth, setSysHealth] = useState(null);

  const fetchData = async () => {
    try {
      const historyData = await api.getHistory();
      const healthData = await api.getHealth();
      setRuns(historyData);
      setSysHealth(healthData);
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6 w-full pb-10">
      <div className="flex justify-between items-end px-1">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Visão Geral</h2>
          <p className="text-slate-500 mt-1">Status operacional e histórico de sequenciamento.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/30">
          <div className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Histórico de Corridas</p>
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

        {/* TABELA DE CORRIDAS: Agora ocupa o espaço total embaixo das métricas */}
        <div className="flex flex-col min-h-[500px]">
          <RunsTable runs={runs} onRunDeleted={fetchData} />
        </div>
      </div>
    </div>
  );
}
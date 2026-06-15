import React, { useState, useEffect, useMemo } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../common/data/api';
import RunsTable from './ui/RunsTable';

export default function DashboardFeature() {
  const [runs, setRuns] = useState([]);
  const [sysHealth, setSysHealth] = useState(null);
  const [busca, setBusca] = useState('');

  const fetchData = async () => {
    try {
      const historyData = await api.getHistory();
      const healthData  = await api.getHealth();
      setRuns(historyData);
      setSysHealth(healthData);
    } catch (error) {
      console.error('Erro ao buscar dados:', error);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const runsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter(r =>
      r.patient_id?.toLowerCase().includes(q) ||
      r.patient_uuid?.toLowerCase().includes(q) ||
      r.doctor?.toLowerCase().includes(q) ||
      r.status?.toLowerCase().includes(q)
    );
  }, [runs, busca]);

  return (
    <div className="w-full pb-10">

      {/* Cabeçalho da seção */}
      <div className="border-b border-slate-300 pb-3 mb-0">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Visão Geral</h2>
        <p className="text-sm text-slate-500 mt-0.5">Status operacional e histórico de sequenciamento</p>
      </div>

      {/* Barra de estatísticas + busca */}
      <div className="flex items-stretch border-b border-slate-200 bg-white">
        {/* Stat: corridas */}
        <div className="px-6 py-3 border-r border-slate-200 flex items-center gap-3 shrink-0">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">Corridas</span>
          <span className="text-2xl font-bold text-slate-900 font-mono">{runs.length}</span>
        </div>

        {/* Stat: armazenamento */}
        <div className="px-6 py-3 border-r border-slate-200 flex items-center gap-3 shrink-0">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">Armazenamento livre</span>
          <span className="text-2xl font-bold text-slate-900 font-mono">
            {sysHealth ? sysHealth.disk.label.split(' ')[0] : '—'}
          </span>
          <span className="text-xs text-slate-400">GB</span>
        </div>

        {/* Busca — ocupa o restante */}
        <div className="flex-1 flex items-center gap-2 px-4">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por paciente, médico, UUID ou status…"
            className="w-full text-sm outline-none text-slate-700 placeholder-slate-400 bg-transparent py-3"
          />
          {busca && (
            <span className="text-xs text-slate-400 whitespace-nowrap font-mono">
              {runsFiltrados.length}/{runs.length}
            </span>
          )}
        </div>
      </div>

      {/* Tabela de corridas — sem wrapper de card */}
      <div className="bg-white border-b border-slate-200">
        <RunsTable runs={runsFiltrados} onRunDeleted={fetchData} />
      </div>

    </div>
  );
}

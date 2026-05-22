import React from 'react';
import MonitorFeature from '../features/monitor/MonitorFeature';

export default function Monitor() {
  return (
    <div className="w-full py-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Monitoramento do Sequenciamento</h2>
        <p className="text-slate-500 mt-1">Acompanhe o status do pipeline genômico em tempo real.</p>
      </div>
      
      <MonitorFeature />
    </div>
  );
}
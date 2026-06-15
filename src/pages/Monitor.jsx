import React from 'react';
import MonitorFeature from '../features/monitor/MonitorFeature';

export default function Monitor() {
  return (
    <div className="w-full pb-10">
      <div className="border-b border-slate-300 pb-3 mb-0">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Monitoramento</h2>
        <p className="text-sm text-slate-500 mt-0.5">Acompanhe o status do pipeline genômico em tempo real.</p>
      </div>
      <MonitorFeature />
    </div>
  );
}

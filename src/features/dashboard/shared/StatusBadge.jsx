// src/features/dashboard/shared/StatusBadge.jsx
import React from 'react';

export default function StatusBadge({ status }) {
  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';

  if (isCompleted) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20">
        Concluído
      </span>
    );
  }
  
  if (isFailed) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-red-50 text-red-700 ring-1 ring-red-600/20">
        Falha
      </span>
    );
  }
  
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-600/20">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 animate-pulse"/>
      {status === 'processing' ? 'Iniciando...' : status}
    </span>
  );
}
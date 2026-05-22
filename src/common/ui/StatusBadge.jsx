import React from 'react';
import { GiPawPrint } from 'react-icons/gi';


export default function StatusBadge({ status }) {
  const isCompleted = status === 'completed';
  const isFailed    = status === 'failed';

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
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-500/30">
      <GiPawPrint className="animate-pulse text-amber-500 w-5 h-5 mr-2" />
      {status === 'processing' ? 'Processando...' : status}
    </span>
  );
}
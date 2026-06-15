import React from 'react';
import { GiPawPrint } from 'react-icons/gi';

export default function StatusBadge({ status }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider border border-emerald-600 text-emerald-700 bg-transparent">
        Concluído
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider border border-red-500 text-red-600 bg-transparent">
        Falha
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider border border-amber-500 text-amber-600 bg-transparent">
      <GiPawPrint className="animate-pulse w-3 h-3" />
      {status === 'processing' ? 'Processando' : status}
    </span>
  );
}

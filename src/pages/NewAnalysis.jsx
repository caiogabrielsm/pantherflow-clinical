import React from 'react';
import UploadForm from '../features/analysis/ui/UploadForm'; // <-- Consumindo da feature isolada

export default function NewAnalysis() {
  return (
    <div className="max-w-4xl mx-auto py-6">
      <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-6">Nova Análise Genômica</h2>
      <UploadForm />
    </div>
  );
}
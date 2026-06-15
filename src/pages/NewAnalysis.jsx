import React from 'react';
import UploadForm from '../features/analysis/ui/UploadForm'; // <-- Consumindo da feature isolada

export default function NewAnalysis() {
  return (
    <div className="w-full">
      <UploadForm />
    </div>
  );
}
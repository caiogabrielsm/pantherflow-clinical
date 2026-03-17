import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Dna, ArrowLeft, User, Stethoscope, FileText, Activity } from 'lucide-react';

export default function Results() {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Recebe os dados do paciente que vieram da tela de History/Monitor
  const analysisData = location.state?.analysisData;

  if (!analysisData) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-slate-500">
        <p>Nenhuma análise selecionada.</p>
        <button onClick={() => navigate('/monitor')} className="mt-4 text-violet-600 font-bold hover:underline">
          Voltar ao Monitor
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto pb-10 space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center gap-4 px-1">
        <button 
          onClick={() => navigate('/monitor')}
          className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft size={20} className="text-slate-600" />
        </button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Relatório Genômico</h2>
          <p className="text-slate-500 mt-1">Resultados do alinhamento WGS.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Card do Paciente */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm col-span-1 space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="p-3 bg-violet-50 text-violet-600 rounded-lg">
              <User size={24} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase">Paciente</p>
              <p className="font-bold text-slate-800 text-lg">{analysisData.patient_id}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2 mb-1">
                <Stethoscope size={14} /> Médico Responsável
              </p>
              <p className="font-medium text-slate-700">{analysisData.doctor}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2 mb-1">
                <FileText size={14} /> Protocolo
              </p>
              <p className="font-medium text-slate-700 uppercase">{analysisData.protocol}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2 mb-1">
                <Activity size={14} /> ID de Rastreio (LGPD)
              </p>
              <p className="font-mono text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-100 break-all">
                {analysisData.patient_uuid}
              </p>
            </div>
          </div>
        </div>

        {/* Card de Resultados (Mock) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm col-span-1 lg:col-span-2 flex flex-col items-center justify-center min-h-[400px]">
           <Dna size={64} className="text-violet-200 mb-6" />
           <h3 className="text-xl font-bold text-slate-700">Alinhamento Concluído</h3>
           <p className="text-slate-500 max-w-md text-center mt-2">
             O arquivo BAM correspondente a esta análise foi gerado com sucesso pelo cluster WSL2 e está pronto para o *Variant Calling*.
           </p>
           
           <div className="mt-8 flex gap-4">
              <button className="px-6 py-2 bg-violet-600 text-white font-bold rounded-lg shadow-sm hover:bg-violet-700 transition-colors">
                Baixar Laudo PDF
              </button>
              <button className="px-6 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-lg shadow-sm hover:bg-slate-50 transition-colors">
                Exportar BAM
              </button>
           </div>
        </div>

      </div>
    </div>
  );
}
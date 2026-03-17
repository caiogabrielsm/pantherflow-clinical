import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom'; 
import { 
  UploadCloud, ArrowRight, User, 
  Stethoscope, Settings2, CheckCircle2 
} from 'lucide-react';

export default function NewAnalysis() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null); 
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const [formData, setFormData] = useState({
    patientId: '',
    doctor: '',
    protocol: 'wgs-t2t',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      alert("Por favor, selecione um arquivo FASTQ.");
      return;
    }

    setUploading(true);

    const data = new FormData();
    data.append("file", selectedFile);
    data.append("patientId", formData.patientId);
    data.append("doctor", formData.doctor);
    data.append("protocol", formData.protocol);
    
    try {
      const response = await fetch('http://localhost:8000/api/upload', {
        method: 'POST',
        body: data
      });

      if (response.ok) {
        const result = await response.json();
        setTimeout(() => {
          setUploading(false);
          // Redirecionamento corrigido para bater com o App.js
          navigate('/monitor', { 
            state: { result: result, patientInfo: formData } 
          });
        }, 800);
      } else {
        throw new Error("Erro no servidor");
      }
    } catch (error) {
      console.error("Erro na conexão:", error);
      alert("Erro ao conectar com o Backend PantherFlow.");
      setUploading(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto pb-10 space-y-6">
      <div className="px-1">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Nova Sequência</h2>
        <p className="text-slate-500 mt-1">Configure os parâmetros e inicie o pipeline de análise.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col lg:flex-row min-h-[600px]">
        
        {/* Lado Esquerdo: Inputs */}
        <div className="flex-1 flex flex-col divide-y divide-slate-100">
          <div className="p-8">
            <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
              <div className="p-1.5 bg-violet-50 text-violet-600 rounded-lg">
                <User size={18} />
              </div>
              Identificação Clínica
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">ID do Paciente</label>
                <input 
                  type="text" 
                  placeholder="Ex: PF-2026-X99"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg focus:border-violet-500 outline-none"
                  value={formData.patientId}
                  onChange={(e) => setFormData({...formData, patientId: e.target.value})}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Médico Responsável</label>
                <div className="relative">
                  <Stethoscope size={16} className="absolute left-3 top-3.5 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Dr. Nome"
                    className="w-full p-3 pl-10 bg-slate-50 border border-slate-200 rounded-lg focus:border-violet-500 outline-none"
                    value={formData.doctor}
                    onChange={(e) => setFormData({...formData, doctor: e.target.value})}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Área de Drop do Arquivo */}
          <div className="flex-1 p-8 bg-slate-50/30">
            <div 
              className={`h-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-10 transition-all cursor-pointer relative
                ${dragActive ? 'border-violet-500 bg-violet-50' : 'border-slate-300 bg-white hover:border-violet-400'}`}
              onDragEnter={handleDrag} 
              onDragLeave={handleDrag} 
              onDragOver={handleDrag} 
              onDrop={handleDrop}
              onClick={() => fileInputRef.current.click()} 
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                onChange={handleFileChange} 
                accept=".fastq,.fastq.gz,.bam" 
                disabled={uploading}
              />

              <div className="text-center pointer-events-none">
                {selectedFile ? (
                  <div className="animate-in fade-in">
                    <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      {uploading ? <UploadCloud className="animate-pulse" size={32} /> : <CheckCircle2 size={32} />}
                    </div>
                    <p className="font-bold text-slate-800">{selectedFile.name}</p>
                    <p className="text-xs text-slate-500 mt-1">{(selectedFile.size / (1024*1024)).toFixed(2)} MB</p>
                  </div>
                ) : (
                  <>
                    <UploadCloud size={40} className="text-slate-300 mb-4 mx-auto" />
                    <p className="font-bold text-slate-700">Clique ou arraste o arquivo FASTQ aqui</p>
                    <p className="text-xs text-slate-400 mt-1">Formatos aceitos: .fastq, .gz, .bam</p>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Lado Direito: Botão de Ação */}
        <div className="lg:w-[350px] bg-slate-50 border-l border-slate-200 p-8 flex flex-col justify-between">
          <div className="space-y-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Settings2 size={18} /> Parâmetros
            </h3>
            <p className="text-xs text-slate-500">O pipeline usará o genoma de referência GRCh38 pré-indexado no WSL2.</p>
          </div>

          <button 
            onClick={handleSubmit}
            disabled={!selectedFile || uploading}
            className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all
              ${!selectedFile || uploading ? 'bg-slate-200 text-slate-400' : 'bg-violet-600 text-white hover:bg-violet-700 shadow-lg'}`}
          >
            {uploading ? 'PROCESSANDO...' : 'INICIAR ANÁLISE'}
            <ArrowRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
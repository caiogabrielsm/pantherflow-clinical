// src/features/dashboard/ui/UploadForm.jsx
import React, { useState } from 'react';
import { Upload, Activity, Play } from 'lucide-react';
import { api } from '../data/api'; // Importando a nossa camada de dados!

export default function UploadForm({ onUploadSuccess }) {
  // 1. Estados Locais: Agora eles vivem SÓ dentro do formulário.
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [formData, setFormData] = useState({
    patientId: '',
    doctor: '',
    protocol: '',
    file: null,
  });

  // 2. Lógica de Interação
  const handleInputChange = (e) => {
    const { name, value, files } = e.target;
    setFormData((prev) => ({ ...prev, [name]: files ? files[0] : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.file) return alert("Selecione um arquivo FASTQ!");

    setIsUploading(true);
    setUploadProgress(0);

    const data = new FormData();
    data.append('file', formData.file);
    data.append('patientId', formData.patientId);
    data.append('doctor', formData.doctor);
    data.append('protocol', formData.protocol);

    try {
      // Usamos a função limpa que criamos no api.js
      await api.uploadAnalysis(data, setUploadProgress);
      
      // Limpa os campos após o sucesso
      setFormData({ patientId: '', doctor: '', protocol: '', file: null });
      
      // Avisa o componente "Pai" (Dashboard) para ele atualizar a tabela
      if (onUploadSuccess) {
        onUploadSuccess();
      }
    } catch (error) {
      alert("Erro no upload. Verifique se o backend está rodando.");
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadProgress(0), 2000);
    }
  };

  // 3. O Visual (JSX) - Exatamente igual ao original
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
        <Upload size={16} className="text-violet-700" /> Iniciar Novo Sequenciamento
      </h3>
      
      <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4 items-end">
        <div className="flex-1 w-full space-y-1">
          <label className="text-xs font-medium text-slate-500">ID Paciente</label>
          <input type="text" name="patientId" required value={formData.patientId} onChange={handleInputChange}
            className="w-full border border-slate-200 rounded-lg p-2 text-sm outline-none focus:border-violet-600 focus:ring-1 focus:ring-violet-600" />
        </div>
        
        <div className="flex-1 w-full space-y-1">
          <label className="text-xs font-medium text-slate-500">Médico Solicitante</label>
          <input type="text" name="doctor" required value={formData.doctor} onChange={handleInputChange}
            className="w-full border border-slate-200 rounded-lg p-2 text-sm outline-none focus:border-violet-600 focus:ring-1 focus:ring-violet-600" />
        </div>

        <div className="flex-1 w-full space-y-1">
          <label className="text-xs font-medium text-slate-500">Protocolo</label>
          <select name="protocol" required value={formData.protocol} onChange={handleInputChange}
            className="w-full border border-slate-200 rounded-lg p-2 text-sm outline-none bg-white">
            <option value="" disabled>Selecione...</option>
            <option value="WES_V1">Exoma (WES) - V1</option>
            <option value="WGS_V1">Genoma (WGS) - V1</option>
            <option value="ONCOLOGY">Painel Oncológico</option>
          </select>
        </div>

        <div className="flex-1 w-full space-y-1">
          <label className="text-xs font-medium text-slate-500">Arquivo (.fastq)</label>
          <input type="file" name="file" accept=".fastq,.fastq.gz,.fq,.fq.gz" required onChange={handleInputChange}
            className="w-full border border-slate-200 rounded-lg text-sm file:mr-4 file:py-2 file:px-4 file:border-0 file:text-sm file:font-semibold file:bg-slate-50 file:text-violet-700 hover:file:bg-slate-100" />
        </div>

        <button type="submit" disabled={isUploading}
          className={`px-6 py-2.5 rounded-lg text-sm font-bold text-white transition-all shadow-sm flex items-center gap-2
            ${isUploading ? 'bg-slate-400 cursor-not-allowed' : 'bg-violet-700 hover:bg-violet-800'}`}>
          {isUploading ? <Activity size={16} className="animate-spin" /> : <Play size={16} />}
          {isUploading ? 'Enviando...' : 'Processar'}
        </button>
      </form>

      {/* BARRA DE PROGRESSO */}
      {uploadProgress > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div className="bg-violet-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
          </div>
          <span className="text-xs font-bold text-slate-600 w-10">{uploadProgress}%</span>
        </div>
      )}
    </div>
  );
}
import React, { useState, useEffect } from 'react';
import { Upload, Activity, Play, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../common/data/api';

export default function UploadForm() {
  const navigate = useNavigate();

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDockerOnline, setIsDockerOnline] = useState(true);

  const [formData, setFormData] = useState({
    patientId: '',
    doctor: '',
    protocol: '',
  });
  const [fileR1, setFileR1] = useState(null);
  const [fileR2, setFileR2] = useState(null);
  const [sex, setSex] = useState('');

  // RADAR: CHECAGEM DO DOCKER
  useEffect(() => {
    const verifyInfra = async () => {
      const online = await api.checkDockerHealth();
      setIsDockerOnline(online);
    };
    verifyInfra();
    const interval = setInterval(verifyInfra, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const isFormValid = formData.patientId && formData.doctor && formData.protocol && sex && fileR1 && fileR2;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isDockerOnline) return alert("Ligue o Docker antes de processar!");
    if (!fileR1 || !fileR2) return alert("Selecione os arquivos R1 e R2 antes de processar!");

    setIsUploading(true);
    setUploadProgress(0);

    const data = new FormData();
    data.append('files', fileR1);
    data.append('files', fileR2);
    data.append('patientId', formData.patientId);
    data.append('doctor', formData.doctor);
    data.append('protocol', formData.protocol);
    data.append('sex', sex);

    try {
      const responseData = await api.uploadAnalysis(data, setUploadProgress);

      setFormData({ patientId: '', doctor: '', protocol: '' });
      setFileR1(null);
      setFileR2(null);
      setSex('');

      navigate('/monitor', { state: { activeUuid: responseData.uuid } });

    } catch (error) {
      alert("Erro de rede. Falha ao enviar os arquivos.");
      setIsUploading(false);
    }
  };

  const fileInputClass = "w-full border border-slate-200 rounded-lg text-sm file:mr-4 file:py-2 file:px-4 file:border-0 file:text-sm file:font-semibold file:bg-slate-50 file:text-brand-primary hover:file:bg-slate-100 disabled:opacity-50";

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Upload size={16} className="text-brand-primary" /> Iniciar Novo Sequenciamento
        </h3>
      </div>

      {!isDockerOnline && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700">
          <AlertTriangle size={20} className="mt-0.5 shrink-0" />
          <div>
            <h4 className="font-bold text-sm">Atenção: Infraestrutura Indisponível</h4>
            <p className="text-xs mt-1">O motor do Docker/WSL2 não está respondendo. Inicie o Docker Desktop.</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4 items-end">
        <div className="flex-1 w-full space-y-1">
          <label className="text-xs font-medium text-slate-500">ID Paciente</label>
          <input type="text" name="patientId" required value={formData.patientId} onChange={handleInputChange} disabled={!isDockerOnline || isUploading}
            className="w-full border border-slate-200 rounded-lg p-2 text-sm outline-none focus:border-brand-primary disabled:bg-slate-100 disabled:text-slate-400" />
        </div>

        <div className="flex-1 w-full space-y-1">
          <label className="text-xs font-medium text-slate-500">Médico</label>
          <input type="text" name="doctor" required value={formData.doctor} onChange={handleInputChange} disabled={!isDockerOnline || isUploading}
            className="w-full border border-slate-200 rounded-lg p-2 text-sm outline-none focus:border-brand-primary disabled:bg-slate-100 disabled:text-slate-400" />
        </div>

        <div className="flex-1 w-full space-y-1">
          <label className="text-xs font-medium text-slate-500">Protocolo</label>
          <select name="protocol" required value={formData.protocol} onChange={handleInputChange} disabled={!isDockerOnline || isUploading}
            className="w-full border border-slate-200 rounded-lg p-2 text-sm outline-none bg-white disabled:bg-slate-100 disabled:text-slate-400">
            <option value="" disabled>Selecione...</option>
            <option value="WES_V1">Exoma (WES) - V1</option>
            <option value="WGS_V1">Genoma (WGS) - V1</option>
            <option value="ONCOLOGY">Painel Oncológico</option>
          </select>
        </div>

        <div className="flex-1 w-full space-y-1">
          <label className="text-xs font-medium text-slate-500">Sexo Biológico</label>
          <select required value={sex} onChange={(e) => setSex(e.target.value)} disabled={!isDockerOnline || isUploading}
            className="w-full border border-slate-200 rounded-lg p-2 text-sm outline-none bg-white disabled:bg-slate-100 disabled:text-slate-400">
            <option value="" disabled>Selecione...</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
          </select>
        </div>

        <div className="flex-1 w-full space-y-1">
          <label className="text-xs font-medium text-slate-500">Arquivo R1 (Forward)</label>
          <input type="file" accept=".fastq,.fastq.gz,.fq,.fq.gz" required
            onChange={(e) => setFileR1(e.target.files[0] || null)}
            disabled={!isDockerOnline || isUploading}
            className={fileInputClass} />
        </div>

        <div className="flex-1 w-full space-y-1">
          <label className="text-xs font-medium text-slate-500">Arquivo R2 (Reverse)</label>
          <input type="file" accept=".fastq,.fastq.gz,.fq,.fq.gz" required
            onChange={(e) => setFileR2(e.target.files[0] || null)}
            disabled={!isDockerOnline || isUploading}
            className={fileInputClass} />
        </div>

        <button type="submit" disabled={isUploading || !isDockerOnline || !isFormValid}
          className={`px-6 py-2.5 rounded-lg text-sm font-bold text-white transition-all shadow-sm flex items-center gap-2
            ${isUploading || !isDockerOnline || !isFormValid ? 'bg-slate-400 cursor-not-allowed' : 'bg-brand-primary hover:bg-brand-secondary'}`}>
          {isUploading ? <Activity size={16} className="animate-spin" /> : <Play size={16} />}
          {isUploading ? 'Processando...' : 'Processar'}
        </button>
      </form>

      {uploadProgress > 0 && uploadProgress < 100 && (
        <div className="mt-4 flex items-center gap-3">
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div className="bg-brand-primary h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
          </div>
          <span className="text-xs font-bold text-slate-600 w-10">{uploadProgress}%</span>
        </div>
      )}
    </div>
  );
}

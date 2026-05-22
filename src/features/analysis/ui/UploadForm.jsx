import React, { useState, useEffect } from 'react';
import { Upload, Activity, Play, AlertTriangle, SlidersHorizontal, CheckCircle2, FolderOpen } from 'lucide-react';
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
    protocol: 'ONCOLOGY',
  });
  const [fileR1, setFileR1] = useState(null);
  const [fileR2, setFileR2] = useState(null);
  const [sex, setSex] = useState('');

  const [isCustomConfig, setIsCustomConfig] = useState(false);
  const [pipelineConfig, setPipelineConfig] = useState({ vaf: 0.05, minDp: 100 });

  const [refGenomeVersion,  setRefGenomeVersion]  = useState('hg38');
  const [targetBedVersion, setTargetBedVersion] = useState('twist');
  const [ponFileVersion,   setPonFileVersion]   = useState('gatk_1000g');

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
    data.append('config', JSON.stringify(pipelineConfig));

    data.append('ref_genome', refGenomeVersion);
    if (targetBedVersion !== 'none') data.append('target_bed', targetBedVersion);
    if (ponFileVersion   !== 'none') data.append('pon_file',   ponFileVersion);

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

  const inputClass = "w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-200 disabled:bg-slate-50 disabled:text-slate-400 transition-colors";
  const selectClass = `${inputClass} bg-white`;
  const fileInputClass = "w-full border border-slate-200 rounded-lg text-sm cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors disabled:opacity-50 file:mr-4 file:py-3 file:px-5 file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100";
  // fileInputClass mantido para os inputs FASTQ R1/R2

  return (
    <div className="w-full space-y-6">

      {/* Título — solto sobre o fundo cinza */}
      <div>
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <Upload size={20} className="text-violet-700" />
          Configuração da Pipeline Clínica
        </h3>
        <p className="text-sm text-slate-500 mt-1">Preencha os dados da amostra e selecione os arquivos FASTQ para iniciar o processamento.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {!isDockerOnline && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <h4 className="font-bold text-sm">Atenção: Infraestrutura Indisponível</h4>
              <p className="text-xs mt-1">O motor do Docker/WSL2 não está respondendo. Inicie o Docker Desktop.</p>
            </div>
          </div>
        )}

        {/* Seção 1 — Dados do Paciente */}
        <div className="bg-white border border-slate-200 rounded-md p-6 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">1. Dados do Paciente</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-600">ID do Paciente</label>
              <input type="text" name="patientId" required value={formData.patientId}
                onChange={handleInputChange} disabled={!isDockerOnline || isUploading}
                placeholder="Ex: PAC-2026-001"
                className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-600">Sexo</label>
              <select required value={sex} onChange={(e) => setSex(e.target.value)}
                disabled={!isDockerOnline || isUploading}
                className={selectClass}>
                <option value="" disabled>Selecione...</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
              </select>
            </div>
          </div>
        </div>

        {/* Seção 2 — Metadados Clínicos */}
        <div className="bg-white border border-slate-200 rounded-md p-6 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">2. Metadados Clínicos</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-600">Médico Solicitante</label>
              <input type="text" name="doctor" required value={formData.doctor}
                onChange={handleInputChange} disabled={!isDockerOnline || isUploading}
                placeholder="Ex: Dr. Silva"
                className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-600">Painel</label>
              <select name="protocol" required value={formData.protocol}
                onChange={handleInputChange} disabled={!isDockerOnline || isUploading}
                className={selectClass}>
                <option value="ONCOLOGY">Painel Oncológico Direcionado</option>
              </select>
            </div>
          </div>
        </div>

        {/* Seção 3 — Dados Brutos (FASTQ) */}
        <div className="bg-white border border-slate-200 rounded-md p-6 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">3. Arquivos de Sequenciamento (Paired-End)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-600">
                Arquivo R1 <span className="text-slate-400 font-normal">(Forward / Read 1)</span>
              </label>
              <input type="file" accept=".fastq,.fastq.gz,.fq,.fq.gz" required
                onChange={(e) => setFileR1(e.target.files[0] || null)}
                disabled={!isDockerOnline || isUploading}
                className={fileInputClass} />
              {fileR1 && <p className="text-xs text-violet-600 font-medium truncate">{fileR1.name}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-600">
                Arquivo R2 <span className="text-slate-400 font-normal">(Reverse / Read 2)</span>
              </label>
              <input type="file" accept=".fastq,.fastq.gz,.fq,.fq.gz" required
                onChange={(e) => setFileR2(e.target.files[0] || null)}
                disabled={!isDockerOnline || isUploading}
                className={fileInputClass} />
              {fileR2 && <p className="text-xs text-violet-600 font-medium truncate">{fileR2.name}</p>}
            </div>
          </div>
        </div>

        {/* Seção 5 — Arquivos de Referência Customizados */}
        <div className="bg-white border border-slate-200 rounded-md p-6 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">5. Arquivos de Referência</p>
          <div className="grid grid-cols-1 gap-5">

            {/* Genoma de Referência */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-600 flex items-center gap-1.5">
                <FolderOpen size={14} className="text-slate-400" />
                Genoma de Referência
              </label>
              <select
                value={refGenomeVersion}
                onChange={(e) => setRefGenomeVersion(e.target.value)}
                disabled={isUploading}
                className="w-full bg-white border border-slate-300 rounded-md p-2 text-sm text-slate-700 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-200 disabled:opacity-50 transition-colors"
              >
                <option value="hg38">Homo sapiens - GRCh38 / hg38 (Padrão)</option>
                <option value="hg19" disabled>Homo sapiens - GRCh37 / hg19 (Requer indexação prévia)</option>
              </select>
            </div>

            {/* Painel Alvo (BED) */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-600 flex items-center gap-1.5">
                <FolderOpen size={14} className="text-slate-400" />
                Painel Alvo
                <span className="text-slate-400 font-normal">(BED)</span>
              </label>
              <select
                value={targetBedVersion}
                onChange={(e) => setTargetBedVersion(e.target.value)}
                disabled={isUploading}
                className="w-full bg-white border border-slate-300 rounded-md p-2 text-sm text-slate-700 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-200 disabled:opacity-50 transition-colors"
              >
                <option value="twist">Painel Twist Bioscience (Padrão)</option>
                <option value="none">Nenhum (Whole Genome / Exoma)</option>
              </select>
            </div>

            {/* Panel of Normals (PoN) */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-600 flex items-center gap-1.5">
                <FolderOpen size={14} className="text-slate-400" />
                Panel of Normals
                <span className="text-slate-400 font-normal">(PoN)</span>
              </label>
              <select
                value={ponFileVersion}
                onChange={(e) => setPonFileVersion(e.target.value)}
                disabled={isUploading}
                className="w-full bg-white border border-slate-300 rounded-md p-2 text-sm text-slate-700 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-200 disabled:opacity-50 transition-colors"
              >
                <option value="gatk_1000g">GATK 1000 Genomes (Padrão)</option>
                <option value="none">Nenhum (Sem filtro de artefatos)</option>
              </select>
            </div>

          </div>
        </div>

        {/* Seção 4 — Configuração Avançada da Pipeline */}
        <div className="bg-white border border-slate-200 rounded-md p-6 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">4. Parâmetros da Pipeline</p>

          {/* Toggle: Modo de Processamento */}
          <div className="flex items-center justify-between p-4 rounded-lg border border-slate-200 bg-slate-50">
            <div className="flex items-center gap-3">
              <SlidersHorizontal size={18} className="text-slate-400" />
              <div>
                <p className="text-sm font-semibold text-slate-700">Modo de Processamento</p>
                {!isCustomConfig ? (
                  <p className="text-xs font-medium text-emerald-600 flex items-center gap-1 mt-0.5">
                    <CheckCircle2 size={12} /> Padrão Clínico GDC (Recomendado)
                  </p>
                ) : (
                  <p className="text-xs font-medium text-slate-500 mt-0.5">Configuração Customizada</p>
                )}
              </div>
            </div>

            {/* Switch */}
            <button
              type="button"
              onClick={() => setIsCustomConfig(v => !v)}
              disabled={isUploading}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-40
                ${isCustomConfig ? 'bg-slate-400' : 'bg-emerald-500'}`}
              aria-pressed={isCustomConfig}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200
                  ${isCustomConfig ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>

          {/* Painel expandido — só visível no modo customizado */}
          {isCustomConfig && (
            <div className="mt-3 p-5 rounded-md border border-slate-200 bg-slate-50 space-y-5">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    VAF Mínimo{' '}
                    <span className="text-slate-400 font-normal">(Variant Allele Frequency)</span>
                  </label>
                  <input
                    type="number"
                    min="0.01" max="0.50" step="0.01"
                    value={pipelineConfig.vaf}
                    onChange={(e) => setPipelineConfig(prev => ({ ...prev, vaf: parseFloat(e.target.value) || 0.05 }))}
                    disabled={isUploading}
                    className={inputClass}
                  />
                  <p className="text-xs text-slate-400">Padrão GDC: <span className="font-mono font-semibold">0.05</span> (5%)</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Profundidade Mínima{' '}
                    <span className="text-slate-400 font-normal">(Min DP)</span>
                  </label>
                  <input
                    type="number"
                    min="1" max="10000" step="1"
                    value={pipelineConfig.minDp}
                    onChange={(e) => setPipelineConfig(prev => ({ ...prev, minDp: parseInt(e.target.value, 10) || 100 }))}
                    disabled={isUploading}
                    className={inputClass}
                  />
                  <p className="text-xs text-slate-400">Padrão GDC: <span className="font-mono font-semibold">100×</span></p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Barra de progresso */}
        {uploadProgress > 0 && uploadProgress < 100 && (
          <div className="flex items-center gap-3">
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div className="bg-violet-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
            <span className="text-xs font-bold text-slate-600 w-10 shrink-0">{uploadProgress}%</span>
          </div>
        )}

        {/* Botão de ação */}
        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button type="submit" disabled={isUploading || !isDockerOnline || !isFormValid}
            className={`flex items-center gap-2.5 px-8 py-3 rounded-lg font-bold text-white text-sm shadow-sm transition-all
              ${isUploading || !isDockerOnline || !isFormValid
                ? 'bg-slate-300 cursor-not-allowed'
                : 'bg-violet-700 hover:bg-violet-800 shadow-violet-200 shadow-md'}`}>
            {isUploading ? <Activity size={16} className="animate-spin" /> : <Play size={16} />}
            {isUploading ? 'Enviando Amostra...' : 'Iniciar Processamento'}
          </button>
        </div>

      </form>
    </div>
  );
}

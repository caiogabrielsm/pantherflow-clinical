import React, { useState, useEffect } from 'react';
import { Upload, Activity, Play, AlertTriangle, FolderOpen } from 'lucide-react';
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
  const [fileBam, setFileBam] = useState(null);
  const [sex, setSex] = useState('');

  const [ingestMode, setIngestMode] = useState('upload');
  const [pathR1, setPathR1] = useState('');
  const [pathR2, setPathR2] = useState('');

  const [pipelineConfig, setPipelineConfig] = useState({ vaf: 0.05, minDp: 100 });

  const [refGenomeVersion,  setRefGenomeVersion]  = useState('hg38');
  const [targetBedVersion, setTargetBedVersion] = useState('twist');
  const [ponFileVersion,   setPonFileVersion]   = useState('gatk_1000g');

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

  const isFormValid = ingestMode === 'bam'
    ? formData.patientId && formData.doctor && formData.protocol && sex && fileBam
    : ingestMode === 'upload'
      ? formData.patientId && formData.doctor && formData.protocol && sex && fileR1 && fileR2
      : formData.patientId && formData.doctor && formData.protocol && sex && pathR1.trim();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isDockerOnline) return alert("Ligue o Docker antes de processar!");

    if (ingestMode === 'upload' && (!fileR1 || !fileR2))
      return alert("Selecione os arquivos R1 e R2 antes de processar!");
    if (ingestMode === 'path' && !pathR1.trim())
      return alert("Informe o caminho do arquivo R1.");
    if (ingestMode === 'bam' && !fileBam)
      return alert("Selecione o arquivo BAM antes de processar!");

    setIsUploading(true);
    setUploadProgress(0);

    const data = new FormData();
    data.append('patientId', formData.patientId);
    data.append('doctor', formData.doctor);
    data.append('protocol', formData.protocol);
    data.append('sex', sex);
    data.append('config', JSON.stringify(pipelineConfig));
    data.append('ref_genome', refGenomeVersion);
    if (targetBedVersion !== 'none') data.append('target_bed', targetBedVersion);
    if (ponFileVersion   !== 'none') data.append('pon_file',   ponFileVersion);

    if (ingestMode === 'upload') {
      data.append('files', fileR1);
      data.append('files', fileR2);
    } else if (ingestMode === 'bam') {
      data.append('bam_file', fileBam);
    } else {
      data.append('fastq_r1_path', pathR1.trim());
      if (pathR2.trim()) data.append('fastq_r2_path', pathR2.trim());
    }

    try {
      const responseData = await api.uploadAnalysis(data, ingestMode === 'upload' ? setUploadProgress : null);

      setFormData({ patientId: '', doctor: '', protocol: '' });
      setFileR1(null);
      setFileR2(null);
      setFileBam(null);
      setSex('');

      navigate(`/monitor/${responseData.uuid}`);

    } catch (error) {
      const detalhe =
        error?.response?.data?.detail ||
        error?.response?.data?.message ||
        error?.message ||
        'Erro desconhecido';
      const status = error?.response?.status ? ` (HTTP ${error.response.status})` : '';
      alert(`Falha ao enviar arquivos${status}:\n\n${detalhe}\n\nVerifique se o WSL2 está ativo e tente novamente.`);
      setIsUploading(false);
    }
  };

  const inputClass = "w-full border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500 focus:ring-0 disabled:bg-slate-50 disabled:text-slate-400 transition-colors bg-white";
  const selectClass = `${inputClass}`;
  const fileInputClass = "w-full border border-slate-300 text-sm cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors disabled:opacity-50 file:mr-4 file:py-3 file:px-5 file:border-0 file:border-r file:border-slate-300 file:text-sm file:font-semibold file:bg-white file:text-slate-600 hover:file:bg-slate-50";

  return (
    <div className="w-full pb-10">

      {/* Título */}
      <div className="border-b border-slate-300 pb-3 mb-0">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Nova Análise</h2>
        <p className="text-sm text-slate-500 mt-0.5">Configure os parâmetros da amostra e inicie o processamento genômico.</p>
      </div>

      <form onSubmit={handleSubmit}>

        {!isDockerOnline && (
          <div className="p-4 bg-red-50 border-b border-red-300 flex items-start gap-3 text-red-700">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-sm uppercase tracking-wide">Infraestrutura Indisponível</p>
              <p className="text-xs mt-0.5 text-red-600">O motor do Docker/WSL2 não está respondendo. Inicie o Docker Desktop.</p>
            </div>
          </div>
        )}

        {/* Seção 1 — Dados do Paciente */}
        <div className="bg-white border-b border-slate-200">
          <div className="px-6 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">1. Dados do Paciente</p>
          </div>
          <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ID do Paciente</label>
              <input type="text" name="patientId" required value={formData.patientId}
                onChange={handleInputChange} disabled={!isDockerOnline || isUploading}
                placeholder="Ex: PAC-2026-001"
                className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sexo</label>
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
        <div className="bg-white border-b border-slate-200">
          <div className="px-6 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">2. Metadados Clínicos</p>
          </div>
          <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Médico Solicitante</label>
              <input type="text" name="doctor" required value={formData.doctor}
                onChange={handleInputChange} disabled={!isDockerOnline || isUploading}
                placeholder="Ex: Dr. Silva"
                className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Painel</label>
              <select name="protocol" required value={formData.protocol}
                onChange={handleInputChange} disabled={!isDockerOnline || isUploading}
                className={selectClass}>
                <option value="ONCOLOGY">Painel Oncológico Direcionado</option>
              </select>
            </div>
          </div>
        </div>

        {/* Seção 3 — Arquivos de Sequenciamento */}
        <div className="bg-white border-b border-slate-200">
          <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">3. Arquivos de Sequenciamento</p>
            <div className="flex border border-slate-300 overflow-hidden text-xs font-semibold">
              {[
                { key: 'upload', label: 'Upload FASTQ' },
                { key: 'bam',    label: 'Upload BAM' },
                { key: 'path',   label: 'Caminho Local' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIngestMode(key)}
                  disabled={isUploading}
                  className={`px-3 py-1.5 transition-colors border-r border-slate-300 last:border-r-0 ${
                    ingestMode === key
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            {ingestMode === 'bam' ? (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 px-4 py-2.5 text-xs text-blue-800">
                  <strong>Modo BAM:</strong> envie um arquivo <code>.bam</code> pré-alinhado. O pipeline irá ordenar,
                  indexar e prosseguir diretamente para a chamada de variantes (Mutect2 + VarScan2 + LoFreq).
                  O BAM deve ter sido alinhado ao mesmo genoma de referência selecionado abaixo.
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Arquivo BAM <span className="text-red-500">*</span></label>
                  <input type="file" accept=".bam"
                    onChange={(e) => setFileBam(e.target.files[0] || null)}
                    disabled={!isDockerOnline || isUploading}
                    className={fileInputClass} />
                  {fileBam && <p className="text-xs text-slate-600 font-mono font-medium truncate">{fileBam.name}</p>}
                </div>
              </div>
            ) : ingestMode === 'upload' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Arquivo R1 <span className="normal-case font-normal">(Forward / Read 1)</span>
                  </label>
                  <input type="file" accept=".fastq,.fastq.gz,.fq,.fq.gz"
                    onChange={(e) => setFileR1(e.target.files[0] || null)}
                    disabled={!isDockerOnline || isUploading}
                    className={fileInputClass} />
                  {fileR1 && <p className="text-xs text-slate-600 font-mono font-medium truncate">{fileR1.name}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Arquivo R2 <span className="normal-case font-normal">(Reverse / Read 2)</span>
                  </label>
                  <input type="file" accept=".fastq,.fastq.gz,.fq,.fq.gz"
                    onChange={(e) => setFileR2(e.target.files[0] || null)}
                    disabled={!isDockerOnline || isUploading}
                    className={fileInputClass} />
                  {fileR2 && <p className="text-xs text-slate-600 font-mono font-medium truncate">{fileR2.name}</p>}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-slate-50 border border-slate-200 px-4 py-2.5 text-xs text-slate-600">
                  <strong>Modo Caminho Local:</strong> informe o caminho absoluto dos FASTQs já presentes no disco.
                  O backend criará um hardlink instantâneo (sem copiar) se os arquivos estiverem no WSL2,
                  ou copiará automaticamente se estiverem em um drive Windows.
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Caminho R1 <span className="normal-case font-normal">(obrigatório)</span>
                  </label>
                  <input type="text" value={pathR1} onChange={(e) => setPathR1(e.target.value)}
                    disabled={!isDockerOnline || isUploading}
                    placeholder="Ex: /home/ubuntu/data/HCC1395_R1.fastq.gz"
                    className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Caminho R2 <span className="normal-case font-normal">(opcional para Single-End)</span>
                  </label>
                  <input type="text" value={pathR2} onChange={(e) => setPathR2(e.target.value)}
                    disabled={!isDockerOnline || isUploading}
                    placeholder="Ex: /home/ubuntu/data/HCC1395_R2.fastq.gz"
                    className={inputClass} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Seção 4 — Arquivos de Referência */}
        <div className="bg-white border-b border-slate-200">
          <div className="px-6 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">4. Arquivos de Referência</p>
          </div>
          <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <FolderOpen size={12} />
                Genoma de Referência
              </label>
              <select value={refGenomeVersion} onChange={(e) => setRefGenomeVersion(e.target.value)}
                disabled={isUploading} className={selectClass}>
                <option value="hg38">GRCh38 / hg38 (Padrão)</option>
                <option value="hg19">GRCh37 / hg19</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <FolderOpen size={12} />
                Painel Alvo (BED)
              </label>
              <select value={targetBedVersion} onChange={(e) => setTargetBedVersion(e.target.value)}
                disabled={isUploading} className={selectClass}>
                <option value="twist">Twist Bioscience (Illumina)</option>
                <option value="oncomine">Oncomine Comprehensive Plus v1.5</option>
                <option value="none">Nenhum (WGS / Exoma)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <FolderOpen size={12} />
                Panel of Normals (PoN)
              </label>
              <select value={ponFileVersion} onChange={(e) => setPonFileVersion(e.target.value)}
                disabled={isUploading} className={selectClass}>
                <option value="gatk_1000g">GATK 1000 Genomes (Padrão)</option>
                <option value="none">Nenhum (sem filtro de artefatos)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Seção 5 — Parâmetros da Pipeline */}
        <div className="bg-white border-b border-slate-200">
          <div className="px-6 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">5. Parâmetros da Pipeline</p>
          </div>
          <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                VAF Mínimo <span className="normal-case font-normal">(Variant Allele Frequency)</span>
              </label>
              <input type="number" min="0.01" max="0.50" step="0.01"
                value={pipelineConfig.vaf}
                onChange={(e) => setPipelineConfig(prev => ({ ...prev, vaf: parseFloat(e.target.value) || 0.05 }))}
                disabled={isUploading} className={inputClass} />
              <p className="text-xs text-slate-400">Padrão GDC: <span className="font-mono font-semibold">0.05</span> (5%)</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Profundidade Mínima <span className="normal-case font-normal">(Min DP)</span>
              </label>
              <input type="number" min="1" max="10000" step="1"
                value={pipelineConfig.minDp}
                onChange={(e) => setPipelineConfig(prev => ({ ...prev, minDp: parseInt(e.target.value, 10) || 100 }))}
                disabled={isUploading} className={inputClass} />
              <p className="text-xs text-slate-400">Padrão GDC: <span className="font-mono font-semibold">100×</span></p>
            </div>
          </div>
        </div>

        {/* Barra de progresso */}
        {ingestMode === 'upload' && uploadProgress > 0 && uploadProgress < 100 && (
          <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-slate-200">
            <div className="w-full bg-slate-100 h-1.5 overflow-hidden">
              <div className="bg-slate-700 h-1.5 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
            <span className="text-xs font-bold text-slate-600 w-10 shrink-0 font-mono">{uploadProgress}%</span>
          </div>
        )}

        {/* Botão de ação */}
        <div className="flex justify-end bg-white px-6 py-4 border-b border-slate-200">
          <button type="submit" disabled={isUploading || !isDockerOnline || !isFormValid}
            className={`flex items-center gap-2.5 px-8 py-2.5 font-bold text-white text-sm transition-colors
              ${isUploading || !isDockerOnline || !isFormValid
                ? 'bg-slate-300 cursor-not-allowed'
                : 'bg-slate-900 hover:bg-slate-700'}`}>
            {isUploading ? <Activity size={15} className="animate-spin" /> : <Play size={15} />}
            {isUploading
              ? (ingestMode === 'path' ? 'Vinculando Arquivos...' : 'Enviando Amostra...')
              : 'Iniciar Processamento'}
          </button>
        </div>

      </form>
    </div>
  );
}

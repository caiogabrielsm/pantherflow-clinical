import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom'; // IMPORTADO PARA NAVEGAÇÃO
import { UploadCloud, FileCode, ArrowRight, User, Stethoscope, Settings2, FileType, CheckCircle2 } from 'lucide-react';

export default function NewAnalysis() {
  const navigate = useNavigate(); // INICIALIZADO
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false); // NOVO ESTADO PARA UI

  const [formData, setFormData] = useState({
    patientId: '',
    doctor: '',
    protocol: 'wgs-t2t',
  });

  // FUNÇÃO DE ENVIO INTEGRADA
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
      // Ajustado para o endpoint Linux padrão
      const response = await fetch('http://localhost:8000/api/upload', {
        method: 'POST',
        body: data
      });

      if (response.ok) {
        const result = await response.json();
        
        // Pequeno delay para feedback visual antes de mudar de tela
        setTimeout(() => {
          setUploading(false);
          // Redireciona para Results passando os dados recebidos do Python
          navigate('/results', { 
            state: { 
              result: result,
              patientInfo: formData 
            } 
          });
        }, 800);
      } else {
        throw new Error("Erro no servidor");
      }
    } catch (error) {
      console.error("Erro na conexão com o Engine:", error);
      alert("Erro ao conectar com o Backend PantherFlow. Verifique se o Python está rodando.");
      setUploading(false);
    }
  };

  // Manipuladores de Drag-and-Drop
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
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
      
      {/* Cabeçalho */}
      <div className="px-1">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Nova Sequência</h2>
        <p className="text-slate-500 mt-1">Configure os parâmetros e inicie o pipeline de análise.</p>
      </div>

      {/* O MONOLITO: Bloco Único de Configuração */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col lg:flex-row min-h-[600px]">
        
        {/* COLUNA ESQUERDA: Dados e Arquivos */}
        <div className="flex-1 flex flex-col divide-y divide-slate-100">
          
          {/* Seção 1: Dados Clínicos */}
          <div className="p-8">
            <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
              <div className="p-1.5 bg-violet-50 text-brand-primary rounded-lg">
                <User size={18} />
              </div>
              Identificação Clínica
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">ID do Paciente / Amostra</label>
                <input 
                  type="text" 
                  placeholder="Ex: PF-2026-X99"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-all font-mono text-sm"
                  value={formData.patientId}
                  onChange={(e) => setFormData({...formData, patientId: e.target.value})}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Médico Responsável</label>
                <div className="relative">
                  <Stethoscope size={16} className="absolute left-3 top-3.5 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Dr. Nome Sobrenome"
                    className="w-full p-3 pl-10 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-brand-primary transition-all text-sm"
                    value={formData.doctor}
                    onChange={(e) => setFormData({...formData, doctor: e.target.value})}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Seção 2: Área de Upload */}
          <div className="flex-1 p-8 flex flex-col bg-slate-50/30">
             <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
              <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
                <FileCode size={18} />
              </div>
              Dados Brutos (FASTQ)
            </h3>

            <div 
              className={`flex-1 relative rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center text-center p-10
                ${dragActive 
                  ? 'border-brand-primary bg-violet-50/50 scale-[0.99]' 
                  : 'border-slate-300 bg-white hover:border-brand-primary hover:shadow-sm'
                }
              `}
              onDragEnter={handleDrag} 
              onDragLeave={handleDrag} 
              onDragOver={handleDrag} 
              onDrop={handleDrop}
            >
              <input 
                type="file" 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleFileChange}
                accept=".fastq,.fastq.gz,.bam"
                disabled={uploading}
              />

              {selectedFile ? (
                <div className="flex flex-col items-center animate-fade-in">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ring-4 ${uploading ? 'bg-violet-50 text-brand-primary animate-pulse ring-violet-50' : 'bg-emerald-50 text-emerald-600 ring-emerald-50'}`}>
                    {uploading ? <UploadCloud size={32} /> : <CheckCircle2 size={32} />}
                  </div>
                  <p className="font-bold text-lg text-slate-800">{selectedFile.name}</p>
                  <p className="text-sm text-slate-500 font-mono mt-1">
                    {(selectedFile.size / (1024*1024)).toFixed(2)} MB • {uploading ? 'Enviando...' : 'Pronto para envio'}
                  </p>
                  {!uploading && (
                    <button 
                      onClick={(e) => {e.preventDefault(); setSelectedFile(null)}} 
                      className="mt-6 text-xs font-bold text-red-500 hover:text-red-700 hover:bg-red-50 px-4 py-2 rounded transition-colors z-10 relative"
                    >
                      Remover e Trocar
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-4 group-hover:bg-brand-primary/10 group-hover:text-brand-primary transition-colors">
                    <UploadCloud size={32} />
                  </div>
                  <p className="font-bold text-lg text-slate-700">Arraste o arquivo .fastq aqui</p>
                  <p className="text-sm text-slate-400 mt-2 max-w-xs">Suporta .fastq, .gz e .bam.</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* COLUNA DIREITA: Pipeline Settings */}
        <div className="lg:w-[400px] border-l border-slate-200 bg-slate-50 flex flex-col">
          <div className="p-8 flex-1">
            <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
              <div className="p-1.5 bg-slate-200 text-slate-700 rounded-lg">
                <Settings2 size={18} />
              </div>
              Parâmetros
            </h3>
            
            <div className="space-y-8">
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-500 uppercase">Protocolo</label>
                <div className="space-y-2">
                  {['wgs', 'exome', 'cancer'].map((p) => (
                    <label key={p} className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer">
                      <input 
                        type="radio" 
                        name="protocol" 
                        checked={formData.protocol === p}
                        onChange={() => setFormData({...formData, protocol: p})}
                        className="mt-1 text-brand-primary" 
                      />
                      <span className="text-sm font-bold text-slate-700 uppercase">{p}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* BOTÃO ATUALIZADO COM O SUBMIT */}
          <div className="p-8 border-t border-slate-200 bg-white">
            <button 
              onClick={handleSubmit}
              disabled={!selectedFile || uploading}
              className={`w-full font-bold py-4 px-6 rounded-xl shadow-lg transition-all flex items-center justify-center gap-3 transform active:scale-[0.98]
                ${!selectedFile || uploading 
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' 
                  : 'bg-brand-primary hover:bg-violet-700 text-white shadow-violet-200 hover:shadow-xl'
                }`}
            >
              <span>{uploading ? 'PROCESSANDO...' : 'INICIAR SEQUENCIAMENTO'}</span>
              <ArrowRight size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
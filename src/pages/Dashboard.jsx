// 1. IMPORTAÇÕES
// React: Biblioteca principal. useState (memória do componente) e useEffect (efeitos colaterais/ações automáticas).
import React, { useState, useEffect } from 'react';
// Axios: Biblioteca excelente para fazer requisições HTTP (conversar com o FastAPI) e medir progresso de upload.
import axios from 'axios';
// Recharts: Biblioteca para desenhar os gráficos na tela.
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
// Lucide-React: Biblioteca de ícones. Cada importação (HardDrive, Activity...) é um ícone diferente.
import { HardDrive, Activity, CheckCircle, AlertCircle, Clock, TrendingUp, MoreHorizontal, Upload, Trash2, FileText, Play } from 'lucide-react';

// URL base do nosso backend FastAPI
const API_URL = 'http://localhost:8000/api';

// --- DADOS FALSOS (MOCK) ---
// Como o gráfico ainda não está conectado à API, usamos estes dados para ele não ficar em branco.
const serverStorageData = [
  { time: '08:00', usage: 45 }, { time: '10:00', usage: 52 },
  { time: '12:00', usage: 78 }, { time: '14:00', usage: 65 },
  { time: '16:00', usage: 55 }, { time: '18:00', usage: 48 },
];

// --- COMPONENTE AUXILIAR: StatusBadge ---
// Um mini-componente que recebe a palavra de status ("completed", "failed", etc) 
// e devolve uma "etiqueta" colorida bonitinha para a tabela.
const StatusBadge = ({ status }) => {
  if (status === 'completed') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20">Concluído</span>;
  }
  if (status === 'failed') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-red-50 text-red-700 ring-1 ring-red-600/20">Falha</span>;
  }
  // Se não for sucesso nem falha, assumimos que está processando. Adicionamos a bolinha que pisca (animate-pulse).
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-600/20">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 animate-pulse"/>
      {status === 'processing' ? 'Iniciando...' : status}
    </span>
  );
};

// ==========================================
// COMPONENTE PRINCIPAL: Dashboard
// É aqui que a mágica principal acontece.
// ==========================================
export default function Dashboard() {
  
  // --- 1. ESTADOS (A "memória" da nossa tela) ---
  // useState cria variáveis que, quando alteradas, fazem a tela se redesenhar automaticamente.
  
  // Armazena a lista de sequenciamentos vindos do banco de dados
  const [runs, setRuns] = useState([]);
  // Armazena a saúde do sistema (CPU, RAM, Disco) vindos do servidor
  const [sysHealth, setSysHealth] = useState(null);
  
  // Controles do Formulário de Upload
  const [isUploading, setIsUploading] = useState(false); // Diz se o botão deve ficar girando/bloqueado
  const [uploadProgress, setUploadProgress] = useState(0); // Vai de 0 a 100 para a barra de progresso
  
  // Guarda o que o usuário digita nos campos de texto e o arquivo selecionado
  const [formData, setFormData] = useState({ 
    patientId: '', 
    doctor: '', 
    protocol: '', 
    file: null 
  });

  // --- 2. COMUNICAÇÃO COM A API ---
  // Esta função vai no FastAPI, pega o histórico e a saúde do PC, e salva nas "memórias" (useState) acima.
  const fetchData = async () => {
    try {
      // Promise.all faz as duas requisições ao mesmo tempo para ser mais rápido
      const [historyRes, healthRes] = await Promise.all([
        axios.get(`${API_URL}/history`),
        axios.get(`${API_URL}/health`)
      ]);
      setRuns(historyRes.data);
      setSysHealth(healthRes.data);
    } catch (error) {
      console.error("Erro ao buscar dados da API:", error);
    }
  };

  // useEffect roda coisas automaticamente em momentos específicos.
  // Como passamos um array vazio [] no final, ele roda apenas 1 vez quando a tela abre.
  useEffect(() => {
    fetchData(); // Busca os dados logo de cara
    
    // Configura o "Radar" (Polling). A cada 5000 milissegundos (5 seg), ele roda a fetchData de novo.
    const interval = setInterval(fetchData, 5000); 
    
    // A função de retorno limpa o radar se o usuário fechar a tela, poupando memória do navegador.
    return () => clearInterval(interval);
  }, []);

  // --- 3. FUNÇÕES DE INTERAÇÃO DO USUÁRIO ---
  
  // Quando o usuário digita algo num campo ou seleciona um arquivo, esta função atualiza o formData
  const handleInputChange = (e) => {
    const { name, value, files } = e.target;
    // Se for arquivo (files), salva o arquivo. Se for texto, salva o valor do texto.
    setFormData(prev => ({ ...prev, [name]: files ? files[0] : value }));
  };

  // Disparada quando o usuário clica em "Processar" (Enviar o formulário)
  const handleSubmit = async (e) => {
    e.preventDefault(); // Evita que a página recarregue (comportamento padrão de formulários HTML)
    
    if (!formData.file) return alert("Selecione um arquivo FASTQ!");

    setIsUploading(true); // Trava o botão
    setUploadProgress(0); // Zera a barra de progresso

    // Para enviar arquivos pesados junto com texto, precisamos envelopar tudo num "FormData"
    const data = new FormData();
    data.append('file', formData.file);
    data.append('patientId', formData.patientId);
    data.append('doctor', formData.doctor);
    data.append('protocol', formData.protocol);

    try {
      // Envia os dados via POST para a rota de upload
      await axios.post(`${API_URL}/upload`, data, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // Esta função nativa do Axios calcula o progresso real do envio dos bytes do arquivo
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        }
      });
      
      // Se deu certo, limpa os campos para o próximo uso
      setFormData({ patientId: '', doctor: '', protocol: '', file: null });
      fetchData(); // Atualiza a tabela na mesma hora para mostrar o novo arquivo
      
    } catch (error) {
      alert("Erro no upload: Confira se o backend está rodando.");
    } finally {
      setIsUploading(false); // Destrava o botão
      setTimeout(() => setUploadProgress(0), 2000); // Esconde a barra de progresso após 2 segundos
    }
  };

  // Disparada ao clicar na lixeirinha da tabela
  const handleDelete = async (id) => {
    // window.confirm abre aquela caixinha padrão do navegador perguntando "OK ou Cancelar"
    if (!window.confirm("Apagar esta análise e destruir os arquivos no servidor?")) return;
    try {
      await axios.delete(`${API_URL}/analysis/${id}`);
      fetchData(); // Se apagou, pede os dados atualizados para a tabela sumir com a linha
    } catch (error) {
      console.error("Erro ao deletar:", error);
    }
  };

  // --- 4. O VISUAL DA TELA (HTML/JSX) ---
  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-10">
      
      {/* CABEÇALHO BÁSICO */}
      <div className="flex justify-between items-end px-1">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Visão Geral</h2>
          <p className="text-slate-500 mt-1">Status operacional da unidade de sequenciamento.</p>
        </div>
      </div>

      {/* BLOCO 1: O FORMULÁRIO DE UPLOAD */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Upload size={16} className="text-violet-700" /> Iniciar Novo Sequenciamento
        </h3>
        
        {/* onSubmit={handleSubmit} liga o clique do botão processar à nossa lógica Axios */}
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

        {/* MÁGICA DA BARRA DE PROGRESSO: Só aparece se o progresso for maior que 0 */}
        {uploadProgress > 0 && (
          <div className="mt-4 flex items-center gap-3">
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div className="bg-violet-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
            </div>
            <span className="text-xs font-bold text-slate-600 w-10">{uploadProgress}%</span>
          </div>
        )}
      </div>

      {/* BLOCO 2: O QUADRO GERAL (Gráficos, Hardware e Tabela) */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        
        {/* FAIXA DE RESUMO NO TOPO DO QUADRO */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/30">
          
          <div className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Corridas Históricas</p>
              {/* Mostra a quantidade de itens que existem dentro da lista 'runs' */}
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{runs.length}</span>
              </div>
            </div>
            <div className="h-10 w-10 bg-white border border-slate-100 rounded-full flex items-center justify-center text-violet-700 shadow-sm">
              <Activity size={20} />
            </div>
          </div>

          <div className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Armazenamento (SSD)</p>
              {/* Usa o ternário (condição ? se_verdade : se_falso) para não quebrar a tela enquanto o sysHealth for null */}
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{sysHealth ? sysHealth.disk.label.split(' ')[0] : '--'}</span>
                <span className="text-xs text-slate-400">GB livres</span>
              </div>
            </div>
            <div className="h-10 w-10 bg-white border border-slate-100 rounded-full flex items-center justify-center text-amber-500 shadow-sm">
              <HardDrive size={20} />
            </div>
          </div>
        </div>

        {/* ÁREA INFERIOR DIVIDIDA EM DUAS COLUNAS: Esquerda (Tabela) e Direita (Hardware) */}
        <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-slate-100 min-h-[500px]">
          
          {/* --- COLUNA ESQUERDA: A TABELA DE RESULTADOS --- */}
          <div className="flex-1 flex flex-col bg-white">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
              <h3 className="font-bold text-slate-800">Filas de Sequenciamento</h3>
              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-mono">Total: {runs.length}</span>
            </div>
            
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-3 font-medium">Paciente</th>
                    <th className="px-6 py-3 font-medium">Médico</th>
                    <th className="px-6 py-3 font-medium">Protocolo</th>
                    <th className="px-6 py-3 font-medium text-right">Status</th>
                    <th className="px-6 py-3 font-medium text-center">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  
                  {/* O .map pega a nossa lista do backend e transforma cada item numa linha <tr> de tabela */}
                  {runs.map((run) => (
                    <tr key={run.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs font-medium text-slate-600 flex items-center gap-2">
                        <FileText size={14} className="text-slate-400" /> {run.patient_id}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900">{run.doctor}</td>
                      <td className="px-6 py-4 text-slate-500">{run.protocol}</td>
                      <td className="px-6 py-4 text-right">
                        {/* Chamamos aquele nosso componente auxiliar lá do topo! */}
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-6 py-4 text-center">
                         {/* Botão de deletar */}
                         <button onClick={() => handleDelete(run.id)} className="text-slate-400 hover:text-red-500 transition-colors p-1">
                           <Trash2 size={16} />
                         </button>
                      </td>
                    </tr>
                  ))}

                  {/* Mostra mensagem se a tabela estiver vazia */}
                  {runs.length === 0 && (
                    <tr><td colSpan="5" className="p-8 text-center text-slate-400">Nenhum sequenciamento na fila.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* --- COLUNA DIREITA: STATUS DO SERVIDOR/PC --- */}
          <div className="lg:w-[380px] bg-slate-50/50 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 bg-white lg:bg-transparent">
              <h3 className="font-bold text-slate-800">Carga do Sistema</h3>
            </div>

            <div className="p-6 flex-1 flex flex-col gap-6 overflow-y-auto">
              
              {/* Gráfico do Recharts (Mantido igual ao seu original) */}
              <div className="h-48 bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={serverStorageData}>
                    <defs>
                      <linearGradient id="colorUsage" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8'}} />
                    <YAxis hide />
                    <Tooltip contentStyle={{borderRadius:'8px', fontSize:'12px'}} />
                    <Area type="monotone" dataKey="usage" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorUsage)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* BARRAS DE HARDWARE COM DADOS REAIS DO PYTHON */}
              <div className="space-y-5">
                
                {/* Memória RAM */}
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-500 font-medium">Memória RAM</span>
                    <span className="font-bold text-slate-700">{sysHealth ? sysHealth.ram.label : 'Carregando...'}</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5">
                    {/* A largura (width) do preenchimento azul escuro vem direto da % do Python */}
                    <div className="bg-violet-600 h-1.5 rounded-full transition-all" style={{ width: `${sysHealth ? sysHealth.ram.percent : 0}%` }}></div>
                  </div>
                </div>
                
                {/* Processador (CPU) */}
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-500 font-medium">Uso de CPU ({sysHealth?.cpu?.threads || '...'})</span>
                    <span className="font-bold text-slate-700">{sysHealth ? `${sysHealth.cpu.percent}%` : 'Carregando...'}</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5">
                    <div className="bg-emerald-500 h-1.5 rounded-full transition-all" style={{ width: `${sysHealth ? sysHealth.cpu.percent : 0}%` }}></div>
                  </div>
                </div>

                {/* Disco */}
                 <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-500 font-medium">Disco C: (Sistema)</span>
                    <span className="font-bold text-amber-600">{sysHealth ? `${sysHealth.disk.percent}% Utilizado` : 'Carregando...'}</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5">
                    <div className="bg-amber-500 h-1.5 rounded-full transition-all" style={{ width: `${sysHealth ? sysHealth.disk.percent : 0}%` }}></div>
                  </div>
                </div>

              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
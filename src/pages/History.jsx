import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom'; // IMPORTAÇÃO NECESSÁRIA PARA O BOTÃO FUNCIONAR
import { 
  Database, Search, RefreshCw, Clock, 
  CheckCircle2, AlertCircle, FileText, User 
} from 'lucide-react';

// Mini-componente do Cronômetro (CORRIGIDO)
const LiveTimer = ({ startTime }) => {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const updateTimer = () => {
      // Adicionamos o 'Z' para forçar o JavaScript a ler como UTC (Horário Universal)
      const safeStartTime = startTime.endsWith('Z') ? startTime : `${startTime}Z`;
      const start = new Date(safeStartTime).getTime();
      const now = new Date().getTime();
      
      let diff = Math.floor((now - start) / 1000);
      
      // Trava de segurança contra números negativos
      if (diff < 0) diff = 0; 
      
      const h = Math.floor(diff / 3600).toString().padStart(2, '0');
      const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
      const s = (diff % 60).toString().padStart(2, '0');
      
      setElapsed(h !== '00' ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
    };

    updateTimer(); 
    const interval = setInterval(updateTimer, 1000); 
    return () => clearInterval(interval);
  }, [startTime]);

  return <div className="text-[10px] text-slate-400 font-mono mt-1 flex items-center gap-1">⏱️ {elapsed}</div>;
};

export default function History() {
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // NECESSÁRIO PARA REDIRECIONAR PARA A TELA DE RESULTADOS
  const navigate = useNavigate();

  // --- FUNÇÃO 1: BUSCA OS DADOS NO PYTHON ---
  const fetchHistory = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/history');
      if (response.ok) {
        const data = await response.json();
        setAnalyses(data);
      }
    } catch (error) {
      console.error("Erro ao carregar histórico:", error);
    } finally {
      setLoading(false);
    }
  };

  // --- FUNÇÃO 2: DELETA A ANÁLISE DO BANCO ---
  const handleDelete = async (id) => {
    if (window.confirm("Tem certeza que deseja excluir esta análise e os arquivos do servidor?")) {
      try {
        const response = await fetch(`http://localhost:8000/api/analysis/${id}`, {
          method: 'DELETE',
        });
        if (response.ok) {
          setAnalyses(analyses.filter(item => item.id !== id));
        }
      } catch (error) {
        console.error("Erro ao eliminar:", error);
      }
    }
  }

  // --- FUNÇÃO 3: ATUALIZA A TELA SOZINHA (A CADA 5 SEGS) ---
  useEffect(() => {
    fetchHistory(); 
    const interval = setInterval(() => {
      fetchHistory(); 
    }, 5000);
    return () => clearInterval(interval);
  }, []); 

  // --- INTERFACE DE USUÁRIO (O QUE APARECE NA TELA) ---
  return (
    <div className="max-w-[1600px] mx-auto pb-10 space-y-6">
      
      {/* --- CABEÇALHO --- */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-1">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Histórico de Análises</h2>
          <p className="text-slate-500 mt-1">Status em tempo real das amostras no cluster WSL2.</p>
        </div>
        
        <button 
          onClick={fetchHistory}
          className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Sincronizar
        </button>
      </div>

      {/* --- BARRA DE BUSCA --- */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-2.5 text-slate-400" />
          <input 
            type="text" 
            placeholder="Buscar por paciente ou médico..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-lg focus:outline-none focus:border-violet-500 transition-all text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* --- INÍCIO DA TABELA --- */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider w-[250px]">Status da Pipeline</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Paciente</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Médico</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Protocolo</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Data</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Ações</th>
            </tr>
          </thead>
          
          <tbody className="divide-y divide-slate-100">
            {/* O .map percorre as análises no banco e cria uma linha (<tr>) para cada uma */}
            {analyses.filter(item => 
              item.patient_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
              item.doctor?.toLowerCase().includes(searchTerm.toLowerCase())
            ).map((item) => (
              
              <tr key={item.patient_uuid} className="hover:bg-slate-50/50 transition-colors group">
                
                {/* COLUNA 1: STATUS E BARRA DE PROGRESSO */}
                <td className="p-4">
                  {item.status === 'completed' ? (
                    <div className="flex items-center gap-2 text-emerald-600 font-bold text-[10px] uppercase">
                      <CheckCircle2 size={16} /> Finalizado
                    </div>
                  ) : item.status === 'failed' ? (
                    <div className="flex items-center gap-2 text-red-600 font-bold text-[10px] uppercase">
                      <AlertCircle size={16} /> Erro na Pipeline
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 text-violet-600 font-bold text-[10px] uppercase animate-pulse">
                        <Clock size={14} /> {item.status}
                      </div>
                      <div className="w-32 bg-slate-100 h-1 rounded-full overflow-hidden">
                        <div className="bg-violet-400 h-full w-full animate-pulse"></div>
                      </div>
                      <LiveTimer startTime={item.date} />
                    </div>
                  )}
                </td>

                {/* COLUNA 2: PACIENTE */}
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                      <User size={16} />
                    </div>
                    <div>
                      <div className="font-bold text-slate-800 text-sm">{item.patient_id}</div>
                      <div className="text-[10px] font-mono text-slate-400">{item.patient_uuid}</div>
                    </div>
                  </div>
                </td>

                {/* COLUNA 3: MÉDICO */}
                <td className="p-4 text-sm text-slate-600 font-medium">{item.doctor}</td>
                
                {/* COLUNA 4: PROTOCOLO */}
                <td className="p-4">
                   <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded text-[10px] font-bold uppercase">
                     {item.protocol}
                   </span>
                </td>

                {/* COLUNA 5: DATA */}
                <td className="p-4 text-sm text-slate-500">
                  {new Date(item.date).toLocaleString('pt-BR')}
                </td>

                {/* COLUNA 6: AÇÕES (O CÓDIGO QUE VOCÊ ENVIOU FOI COLADO AQUI) */}
                <td className="p-4 text-right flex justify-end gap-2">
                  
                  {/* Botão de Ver Resultados (Ícone Roxo) */}
                  <button 
                    disabled={item.status !== 'completed'}
                    onClick={() => navigate('/results', { state: { analysisData: item } })}
                    className={`p-2 rounded-lg transition-all ${
                      item.status === 'completed' 
                        ? 'bg-violet-50 text-violet-600 hover:bg-violet-100 shadow-sm' 
                        : 'bg-slate-50 text-slate-300 cursor-not-allowed'
                    }`}
                    title="Ver Resultados"
                  >
                    <FileText size={18} />
                  </button>

                  {/* Botão de Excluir (Ícone Vermelho) */}
                  <button 
                    onClick={() => handleDelete(item.id)}
                    className="p-2 rounded-lg transition-all bg-red-50 text-red-500 hover:bg-red-100 shadow-sm"
                    title="Excluir Análise"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                  </button>

                </td>
                {/* FIM DA COLUNA DE AÇÕES */}

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
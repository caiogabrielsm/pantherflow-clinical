import React, { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { Terminal, Cpu, Server, Pause, Play, Wifi, WifiOff, HardDrive, Zap } from 'lucide-react';

export default function Monitor() {
  const [isRunning, setIsRunning] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  
  // Estado inicial mais completo
  const [stats, setStats] = useState({
    cpu: { percent: 0, freq: '0.0 GHz', threads: '0 Threads' },
    ram: { percent: 0, label: '0 / 0 GB' },
    disk: { percent: 0, label: '0 GB Livres', total: '0 GB' }
  });

  const [hwHistory, setHwHistory] = useState(Array(20).fill({ cpu: 0, ram: 0 }));
  const [logs, setLogs] = useState([
    { type: 'info', text: 'Inicializando monitor avançado...' },
    { type: 'info', text: 'Conectando ao PantherFlow Engine...' },
  ]);
  
  const terminalEndRef = useRef(null);

  const fetchSystemStats = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/health');
      if (!response.ok) throw new Error('Falha');
      const data = await response.json();
      setIsConnected(true);
      return data;
    } catch (error) {
      setIsConnected(false);
      return null;
    }
  };

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(async () => {
      const realData = await fetchSystemStats();

      if (realData) {
        // Atualiza os dados detalhados
        setStats(realData);

        // Atualiza o gráfico
        setHwHistory(prev => [...prev.slice(1), {
          cpu: realData.cpu.percent,
          ram: realData.ram.percent
        }]);

        // Log de conexão recuperada
        if (!isConnected) {
            setLogs(prev => [...prev.slice(-15), { type: 'success', text: 'Conexão restabelecida: Dados detalhados recebidos.' }]);
        }

      } else {
        // Log de erro
        if (isConnected) {
            setLogs(prev => [...prev.slice(-15), { type: 'warning', text: 'Perda de sinal com o Backend...' }]);
        }
      }

    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, isConnected]);

  // Auto-scroll
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [logs]);

  return (
    <div className="max-w-[1600px] mx-auto pb-10 space-y-6">
      
      {/* Cabeçalho */}
      <div className="flex justify-between items-end px-1">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Monitor de Execução</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border 
              ${isConnected ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
              {isConnected ? <Wifi size={12}/> : <WifiOff size={12}/>}
              {isConnected ? 'ONLINE' : 'OFFLINE'}
            </span>
            <p className="text-slate-500 text-sm">Telemetria de Hardware Detalhada</p>
          </div>
        </div>
        <div className="flex gap-2">
           <button 
             onClick={() => setIsRunning(!isRunning)}
             className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded border transition-all shadow-sm
               ${isRunning 
                 ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50' 
                 : 'bg-emerald-500 border-emerald-600 text-white hover:bg-emerald-600'
               }`}
           >
             {isRunning ? <><Pause size={14} /> PAUSAR</> : <><Play size={14} /> RETOMAR</>}
           </button>
        </div>
      </div>

      <div className="h-[650px] bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col lg:flex-row">
        
        {/* LADO ESQUERDO: Terminal */}
        <div className="flex-1 bg-[#1e1e1e] p-0 flex flex-col font-mono relative min-w-0">
          <div className="bg-[#2d2d2d] px-4 py-2 flex items-center justify-between border-b border-[#3e3e3e] shrink-0">
            <div className="flex items-center gap-2 text-slate-400 text-xs">
              <Terminal size={14} />
              <span>root@pantherflow-server:~/telemetry</span>
            </div>
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/50"></div>
            </div>
          </div>

          <div className="flex-1 p-6 overflow-y-auto text-sm space-y-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            {logs.map((log, index) => (
              <div key={index} className="flex gap-3 animate-fade-in">
                <span className="text-slate-500 shrink-0">[{new Date().toLocaleTimeString()}]</span>
                <span className={`break-all
                  ${log.type === 'success' ? 'text-emerald-400' : ''}
                  ${log.type === 'warning' ? 'text-red-400' : ''}
                  ${log.type === 'info' ? 'text-blue-400' : ''}
                `}>
                  {log.text}
                </span>
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>
        </div>

        {/* LADO DIREITO: Telemetria Real Detalhada */}
        <div className="lg:w-[420px] bg-slate-50 border-l border-slate-200 flex flex-col divide-y divide-slate-200 overflow-y-auto">
          
          {/* CPU CARD */}
          <div className="p-6 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-slate-700 flex items-center gap-2">
                <Cpu size={18} className="text-slate-400" /> Processador
              </h3>
              <span className="text-2xl font-bold text-slate-900">{Math.round(stats.cpu.percent)}%</span>
            </div>
            
            {/* Detalhes Extras CPU */}
            <div className="flex gap-4 text-xs font-mono text-slate-500 mb-4 bg-white p-2 rounded border border-slate-100 shadow-sm">
                <div className="flex items-center gap-1"><Zap size={12}/> {stats.cpu.freq}</div>
                <div className="flex items-center gap-1"><Server size={12}/> {stats.cpu.threads}</div>
            </div>

            <div className="h-20">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hwHistory}>
                   <defs>
                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="cpu" stroke="#8b5cf6" strokeWidth={2} fill="url(#colorCpu)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RAM CARD */}
          <div className="p-6 shrink-0">
             <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-slate-700 flex items-center gap-2">
                <Server size={18} className="text-slate-400" /> Memória RAM
              </h3>
              <span className="text-2xl font-bold text-emerald-600">{Math.round(stats.ram.percent)}%</span>
            </div>
            
            {/* Detalhes Extras RAM */}
            <div className="flex justify-between text-xs font-mono text-slate-500 mb-4 bg-white p-2 rounded border border-slate-100 shadow-sm">
                <span>Uso: {stats.ram.label}</span>
            </div>

            <div className="h-20">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hwHistory}>
                   <defs>
                    <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#059669" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="ram" stroke="#059669" strokeWidth={2} fill="url(#colorRam)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* DISK CARD (Novo!) */}
          <div className="p-6 shrink-0">
             <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-slate-700 flex items-center gap-2">
                <HardDrive size={18} className="text-slate-400" /> Disco Principal
              </h3>
              <span className="text-2xl font-bold text-amber-500">{Math.round(stats.disk.percent)}%</span>
            </div>

            {/* Detalhes Extras Disco */}
             <div className="flex justify-between text-xs font-mono text-slate-500 mb-4 bg-white p-2 rounded border border-slate-100 shadow-sm">
                <span className="text-emerald-600 font-bold">{stats.disk.label}</span>
                <span>{stats.disk.total}</span>
            </div>

            <div className="w-full bg-slate-200 rounded-full h-2 mt-2">
                <div 
                    className="bg-amber-500 h-2 rounded-full transition-all duration-1000" 
                    style={{ width: `${stats.disk.percent}%` }}
                ></div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
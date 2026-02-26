import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { HardDrive, Activity, CheckCircle, AlertCircle, Clock, ChevronRight, TrendingUp, MoreHorizontal } from 'lucide-react';

// Dados (Mantidos iguais)
const serverStorageData = [
  { time: '08:00', usage: 45 },
  { time: '10:00', usage: 52 },
  { time: '12:00', usage: 78 },
  { time: '14:00', usage: 65 },
  { time: '16:00', usage: 55 },
  { time: '18:00', usage: 48 },
];

const recentRuns = [
  { id: 'RUN_240115_A01', patient: 'PF-0042', protocol: 'WGS - T2T', status: 'completed', date: '15/01 10:30' },
  { id: 'RUN_240115_A02', patient: 'PF-0043', protocol: 'Exome V2', status: 'processing', date: '15/01 13:15' },
  { id: 'RUN_240114_B99', patient: 'PF-0039', protocol: 'Panel Cancer', status: 'failed', date: '14/01 16:45' },
  { id: 'RUN_240114_B98', patient: 'PF-0038', protocol: 'WGS - GRCh38', status: 'completed', date: '14/01 09:00' },
  { id: 'RUN_240114_C01', patient: 'PF-0045', protocol: 'WGS - T2T', status: 'completed', date: '14/01 11:20' },
  { id: 'RUN_240113_X99', patient: 'PF-0012', protocol: 'Exome V2', status: 'completed', date: '13/01 14:10' },
];

const StatusBadge = ({ status }) => {
  const styles = {
    completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20',
    processing: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20',
    failed: 'bg-red-50 text-red-700 ring-1 ring-red-600/20',
  };
  const labels = { completed: 'Concluído', processing: 'Processando', failed: 'Falha QC' };
  
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium ${styles[status]}`}>
      {status === 'processing' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 animate-pulse"/>}
      {labels[status]}
    </span>
  );
};

export default function Dashboard() {
  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-10">
      
      {/* Cabeçalho Refinado: Botões removidos para simplificação visual */}
      <div className="flex justify-between items-end px-1">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Visão Geral</h2>
          <p className="text-slate-500 mt-1">Status operacional da unidade de sequenciamento.</p>
        </div>
        {/* O bloco de botões que ficava aqui foi removido conforme solicitado */}
      </div>

      {/* O MONOLITO: Um único container para tudo */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        
        {/* PARTE 1: FAIXA DE MÉTRICAS (Topo) */}
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/30">
          
          <div className="p-6 flex items-center justify-between group hover:bg-white transition-colors">
            <div>
              <p className="text-sm font-medium text-slate-500">Corridas Hoje</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">12</span>
                <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center">
                  <TrendingUp size={10} className="mr-1" /> +2
                </span>
              </div>
            </div>
            <div className="h-10 w-10 bg-white border border-slate-100 rounded-full flex items-center justify-center text-brand-primary shadow-sm">
              <Activity size={20} />
            </div>
          </div>

          <div className="p-6 flex items-center justify-between group hover:bg-white transition-colors">
            <div>
              <p className="text-sm font-medium text-slate-500">Taxa de Sucesso</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">98.5%</span>
              </div>
            </div>
            <div className="h-10 w-10 bg-white border border-slate-100 rounded-full flex items-center justify-center text-emerald-600 shadow-sm">
              <CheckCircle size={20} />
            </div>
          </div>

          <div className="p-6 flex items-center justify-between group hover:bg-white transition-colors">
            <div>
              <p className="text-sm font-medium text-slate-500">Armazenamento (SSD)</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">1.2 TB</span>
                <span className="text-xs text-slate-400">livres</span>
              </div>
            </div>
            <div className="h-10 w-10 bg-white border border-slate-100 rounded-full flex items-center justify-center text-amber-500 shadow-sm">
              <HardDrive size={20} />
            </div>
          </div>

        </div>

        {/* PARTE 2: ÁREA DE TRABALHO (Tabela + Gráficos) */}
        <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-slate-100 min-h-[500px]">
          
          {/* Lado Esquerdo: Tabela Principal */}
          <div className="flex-1 flex flex-col bg-white">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-800">Filas de Sequenciamento</h3>
                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-mono">Total: 24</span>
              </div>
              <button className="p-1 hover:bg-slate-100 rounded text-slate-400 transition-colors">
                <MoreHorizontal size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-3 font-medium">Run ID</th>
                    <th className="px-6 py-3 font-medium">Paciente</th>
                    <th className="px-6 py-3 font-medium">Protocolo</th>
                    <th className="px-6 py-3 font-medium">Início</th>
                    <th className="px-6 py-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {recentRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-violet-50/50 transition-colors group cursor-default">
                      <td className="px-6 py-4 font-mono text-xs font-medium text-slate-600 group-hover:text-brand-primary transition-colors">
                        {run.id}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900">{run.patient}</td>
                      <td className="px-6 py-4 text-slate-500">{run.protocol}</td>
                      <td className="px-6 py-4 text-slate-400 flex items-center gap-1.5">
                        <Clock size={14} /> {run.date}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <StatusBadge status={run.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/30 flex justify-center">
               <button className="text-xs font-medium text-brand-primary hover:underline">Carregar mais resultados</button>
            </div>
          </div>

          {/* Lado Direito: Hardware Stats */}
          <div className="lg:w-[380px] bg-slate-50/50 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white lg:bg-transparent">
              <h3 className="font-bold text-slate-800">Carga do Sistema</h3>
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                <AlertCircle size={10} />
                High Load
              </div>
            </div>

            <div className="p-6 flex-1 flex flex-col gap-6 overflow-y-auto">
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

              <div className="space-y-5">
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-500 font-medium">Memória RAM</span>
                    <span className="font-bold text-slate-700">12.4 / 32 GB</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5">
                    <div className="bg-brand-primary h-1.5 rounded-full" style={{ width: '42%' }}></div>
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-500 font-medium">Swap (Virtual)</span>
                    <span className="font-bold text-slate-700">5%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5">
                    <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: '5%' }}></div>
                  </div>
                </div>

                 <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-500 font-medium">Temperatura (CPU)</span>
                    <span className="font-bold text-amber-600">72°C</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5">
                    <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: '65%' }}></div>
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
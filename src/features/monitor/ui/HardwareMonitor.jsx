// src/features/dashboard/ui/HardwareMonitor.jsx
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { serverStorageData } from "../../../common/data/mockData";

export default function HardwareMonitor({ sysHealth }) {
  return (
    <div className="lg:w-[380px] bg-slate-50/50 flex flex-col">
      <div className="px-6 py-4 border-b border-slate-100 bg-white lg:bg-transparent">
        <h3 className="font-bold text-slate-800">Carga do Sistema</h3>
      </div>

      <div className="p-6 flex-1 flex flex-col gap-6 overflow-y-auto">
        
        {/* GRÁFICO DO RECHARTS */}
        <div className="h-48 bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
          <ResponsiveContainer width="100%" height="100%">
            {/* Usando o mockData que importamos lá do topo */}
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

        {/* BARRAS DE HARDWARE DINÂMICAS */}
        <div className="space-y-5">
          
          {/* Memória RAM */}
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-500 font-medium">Memória RAM</span>
              <span className="font-bold text-slate-700">
                {sysHealth ? sysHealth.ram.label : 'Carregando...'}
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div 
                className="bg-violet-600 h-1.5 rounded-full transition-all duration-500" 
                style={{ width: `${sysHealth ? sysHealth.ram.percent : 0}%` }}>
              </div>
            </div>
          </div>
          
          {/* CPU */}
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-500 font-medium">Uso de CPU ({sysHealth?.cpu?.threads || '...'})</span>
              <span className="font-bold text-slate-700">
                {sysHealth ? `${sysHealth.cpu.percent}%` : 'Carregando...'}
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div 
                className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" 
                style={{ width: `${sysHealth ? sysHealth.cpu.percent : 0}%` }}>
              </div>
            </div>
          </div>

          {/* Disco */}
           <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-500 font-medium">Disco C: (Sistema)</span>
              <span className="font-bold text-amber-600">
                {sysHealth ? `${sysHealth.disk.percent}% Utilizado` : 'Carregando...'}
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div 
                className="bg-amber-500 h-1.5 rounded-full transition-all duration-500" 
                style={{ width: `${sysHealth ? sysHealth.disk.percent : 0}%` }}>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
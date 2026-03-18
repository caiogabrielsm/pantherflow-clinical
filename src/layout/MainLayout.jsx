import React from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { 
  Activity, 
  PlusSquare,
  List,
  Monitor,
  ClipboardList,
  Sliders,
  Dna 
} from 'lucide-react';

const SidebarItem = ({ to, icon: Icon, label }) => (
  <NavLink 
    to={to} 
    className={({ isActive }) => 
      `flex items-center gap-3 p-3 rounded-lg transition-all mb-1
      ${isActive 
        ? 'bg-brand-primary text-white shadow-md' 
        : 'text-slate-600 hover:bg-slate-200'
      }`
    }
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </NavLink>
);

export default function MainLayout() {
  return (
    // Adicionado print:bg-white e print:h-auto para evitar cortes e fundo cinza no PDF
    <div className="flex h-screen w-full bg-slate-50 text-slate-800 print:bg-white print:h-auto">
      
      {/* Sidebar - print:hidden esconde o menu na impressão */}
      <aside className="print:hidden w-64 bg-white border-r border-slate-200 flex flex-col shadow-sm">
        <div className="p-6 border-b border-slate-100 flex items-center gap-2">
          <Dna className="text-brand-accent" size={28} />
          <div>
            <h1 className="font-bold text-lg leading-tight text-slate-900">PantherFlow</h1>
            <p className="text-xs text-brand-primary font-semibold tracking-wider">CLINICAL</p>
          </div>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          <div className="space-y-1">
            <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Principal</p>
            <SidebarItem to="/" icon={Activity} label="Dashboard" />
            <SidebarItem to="/new-analysis" icon={PlusSquare} label="Nova Análise" />
            <SidebarItem to="/monitor" icon={Monitor} label="Monitoramento" />
          </div>

          <div className="space-y-1 mt-6">
            <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Dados Clínicos</p>
            <SidebarItem to="/results" icon={ClipboardList} label="Laudos & Resultados" />
          </div>
        </nav>

        <div className="p-4 border-t border-slate-100">
          <SidebarItem to="/settings" icon={Sliders} label="Configurações" />
        </div>
      </aside>

      {/* Área Principal - print:overflow-visible impede que o PDF corte no meio */}
      <main className="flex-1 flex flex-col overflow-hidden print:overflow-visible">
        
        {/* Header - print:hidden esconde o topo na impressão */}
        <header className="print:hidden h-14 bg-white border-b border-slate-200 flex items-center px-6 justify-between">
           <span className="text-slate-500 text-sm font-medium">Ambiente Operacional Clínico</span>
           <span className="text-slate-500 text-sm">Bem-vindo, Dr. Geneticista</span>
        </header>

        {/* Container do Outlet - print:p-0 tira as margens da tela para aproveitar a folha */}
        <div className="flex-1 overflow-auto p-6 relative print:p-0 print:overflow-visible">
           <Outlet />
        </div>
      </main>
    </div>
  );
}
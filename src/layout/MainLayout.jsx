import React from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { 
  Activity, 
  Microscope,
  Cpu,
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
    <div className="flex h-screen w-full bg-bg-main text-slate-800">
      
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shadow-sm">
        <div className="p-6 border-b border-slate-100 flex items-center gap-2">
          <Dna className="text-brand-accent" size={28} />
          <div>
            <h1 className="font-bold text-lg leading-tight text-slate-900">PantherFlow</h1>
            <p className="text-xs text-brand-primary font-semibold tracking-wider">CLINICAL</p>
          </div>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          <SidebarItem to="/" icon={Activity} label="Dashboard" />
          <SidebarItem to="/new-analysis" icon={Microscope} label="Nova Análise" />
          <SidebarItem to="/monitor" icon={Cpu} label="Monitor Hardware" />
          <SidebarItem to="/results" icon={ClipboardList} label="Laudos & Resultados" />
        </nav>

        <div className="p-4 border-t border-slate-100">
          <SidebarItem to="/settings" icon={Sliders} label="Configurações" />
        </div>
      </aside>

      {/* Área Principal - O footer foi removido daqui */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center px-6 justify-between">
           <span className="text-slate-500 text-sm">Bem-vindo, Dr. Geneticista</span>
        </header>

        <div className="flex-1 overflow-auto p-6 relative">
           <Outlet />
        </div>

        {/* A barra azul (footer) foi removida para simplificar a interface clínica.
          As informações de v1.0.0 e Pantherion Dx podem ser movidas para 'Configurações' 
          ou 'Sobre' futuramente.
        */}
      </main>
    </div>
  );
}
import React, { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import {
  Activity,
  PlusSquare,
  Monitor,
  ClipboardList,
  Sliders,
  Dna,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';

const SidebarItem = ({ to, icon: Icon, label, collapsed }) => (
  <NavLink
    to={to}
    title={label}
    className={({ isActive }) =>
      `flex items-center gap-3 p-3 rounded-lg transition-all mb-1
      ${collapsed ? 'justify-center' : ''}
      ${isActive
        ? 'bg-brand-primary text-white shadow-md'
        : 'text-slate-600 hover:bg-slate-200'
      }`
    }
  >
    <Icon size={20} className="shrink-0" />
    {!collapsed && <span className="font-medium whitespace-nowrap">{label}</span>}
  </NavLink>
);

export default function MainLayout() {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-800 print:bg-white print:h-auto">

      {/* Sidebar */}
      <aside className={`print:hidden bg-white border-r border-slate-200 flex flex-col shadow-sm
        transition-all duration-300 ease-in-out
        ${isCollapsed ? 'w-[72px]' : 'w-64'}`}>

        {/* Logo + botão toggle */}
        <div className="border-b border-slate-100 flex items-center justify-between px-4 py-5">
          {!isCollapsed && (
            <div className="flex items-center gap-2 overflow-hidden">
              <Dna className="text-brand-accent shrink-0" size={26} />
              <div>
                <h1 className="font-bold text-base leading-tight text-slate-900 whitespace-nowrap">PantherFlow</h1>
                <p className="text-xs text-brand-primary font-semibold tracking-wider">CLINICAL</p>
              </div>
            </div>
          )}
          {isCollapsed && <Dna className="text-brand-accent mx-auto" size={26} />}
          <button
            onClick={() => setIsCollapsed(prev => !prev)}
            title={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
            className={`p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors shrink-0
              ${isCollapsed ? 'mx-auto mt-2 block' : ''}`}
          >
            {isCollapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </div>

        {/* Navegação */}
        <nav className="flex-1 p-3 overflow-y-auto overflow-x-hidden">
          <div className="space-y-0.5">
            {!isCollapsed && (
              <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Principal</p>
            )}
            {isCollapsed && <div className="h-5" />}
            <SidebarItem to="/"            icon={Activity}      label="Dashboard"           collapsed={isCollapsed} />
            <SidebarItem to="/new-analysis" icon={PlusSquare}   label="Nova Análise"         collapsed={isCollapsed} />
            <SidebarItem to="/monitor"      icon={Monitor}      label="Monitoramento"        collapsed={isCollapsed} />
          </div>

          <div className="space-y-0.5 mt-5">
            {!isCollapsed && (
              <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Dados Clínicos</p>
            )}
            {isCollapsed && <div className="h-5" />}
            <SidebarItem to="/" icon={ClipboardList} label="Laudos & Resultados" collapsed={isCollapsed} />
          </div>
        </nav>

        {/* Rodapé */}
        <div className="p-3 border-t border-slate-100">
          <SidebarItem to="/settings" icon={Sliders} label="Configurações" collapsed={isCollapsed} />
        </div>
      </aside>

      {/* Área Principal */}
      <main className="flex-1 flex flex-col overflow-hidden print:overflow-visible">

        <header className="print:hidden h-14 bg-white border-b border-slate-200 flex items-center px-6 justify-between">
          <span className="text-slate-500 text-sm font-medium">Ambiente Operacional Clínico</span>
          <span className="text-slate-500 text-sm">Bem-vindo, Dr. Geneticista</span>
        </header>

        <div className="flex-1 overflow-auto p-6 relative print:p-0 print:overflow-visible">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

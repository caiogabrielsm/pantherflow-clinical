import React, { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import {
  Activity, PlusSquare, Monitor, Sliders,
  Dna, TrendingUp,
} from 'lucide-react';
import { GiPawPrint } from 'react-icons/gi';

const SidebarItem = ({ to, icon: Icon, label, collapsed }) => (
  <NavLink
    to={to}
    title={label}
    className={({ isActive }) =>
      `flex items-center gap-3 px-3 py-2.5 text-sm transition-colors border-l-2
      ${collapsed ? 'justify-center' : ''}
      ${isActive
        ? 'border-l-slate-900 bg-slate-100 text-slate-900 font-semibold'
        : 'border-l-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
      }`
    }
  >
    <Icon size={17} className="shrink-0" />
    {!collapsed && <span className="whitespace-nowrap">{label}</span>}
  </NavLink>
);

export default function MainLayout() {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-800">

      {/* Sidebar */}
      <aside className={`print:hidden bg-white border-r border-slate-200 flex flex-col
        transition-all duration-200 ease-in-out
        ${isCollapsed ? 'w-[56px]' : 'w-56'}`}>

        {/* Logo — clicável para recolher/expandir */}
        <button
          onClick={() => setIsCollapsed(prev => !prev)}
          title={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
          className={`border-b border-slate-200 flex items-center px-3 py-4 gap-2.5 w-full
            hover:bg-slate-50 transition-colors cursor-pointer
            ${isCollapsed ? 'justify-center' : ''}`}
        >
          <GiPawPrint size={20} className="text-slate-700 shrink-0" />
          {!isCollapsed && (
            <div className="overflow-hidden text-left">
              <div className="font-bold text-sm text-slate-900 leading-tight tracking-tight">PantherFlow</div>
              <div className="text-[10px] font-semibold text-slate-400 tracking-widest uppercase">Clinical</div>
            </div>
          )}
        </button>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
          {!isCollapsed && (
            <p className="px-3 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Principal</p>
          )}
          <SidebarItem to="/"             icon={Activity}   label="Dashboard"             collapsed={isCollapsed} />
          <SidebarItem to="/new-analysis" icon={PlusSquare} label="Nova Análise"           collapsed={isCollapsed} />
          <SidebarItem to="/monitor"      icon={Monitor}    label="Monitoramento"          collapsed={isCollapsed} />

          <div className="my-3 border-t border-slate-100" />

          {!isCollapsed && (
            <p className="px-3 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ferramentas</p>
          )}
          <SidebarItem to="/benchmarking" icon={TrendingUp} label="Benchmarking Analítico" collapsed={isCollapsed} />
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-200">
          <SidebarItem to="/settings" icon={Sliders} label="Configurações" collapsed={isCollapsed} />
        </div>
      </aside>

      {/* Área principal */}
      <main className="flex-1 flex flex-col overflow-hidden print:overflow-visible">

        <header className="print:hidden h-11 bg-white border-b border-slate-200 flex items-center px-6 shrink-0" />

        <div className="flex-1 overflow-auto print:overflow-visible">
          <div className="px-3 py-4 print:p-0">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

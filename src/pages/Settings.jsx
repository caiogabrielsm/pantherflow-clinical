import React, { useState } from 'react';
import { Save, Server, Shield, Database, Layout, Bell, UserCog } from 'lucide-react';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('pipeline');

  // Componente interno para o Menu Lateral
  const TabButton = ({ id, label, icon: Icon }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors rounded-lg mb-1
        ${activeTab === id 
          ? 'bg-violet-50 text-brand-primary' 
          : 'text-slate-600 hover:bg-slate-50'
        }`}
    >
      <Icon size={18} />
      {label}
    </button>
  );

  return (
    <div className="max-w-[1600px] mx-auto pb-10 space-y-6">
      
      {/* Cabeçalho */}
      <div className="flex justify-between items-end px-1">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Configurações do Sistema</h2>
          <p className="text-slate-500 mt-1">Gerencie parâmetros do motor de processamento e preferências de interface.</p>
        </div>
        <button className="flex items-center gap-2 text-sm font-bold bg-slate-900 text-white px-6 py-2.5 rounded-lg hover:bg-slate-800 transition-all shadow-sm">
          <Save size={16} /> SALVAR ALTERAÇÕES
        </button>
      </div>

      {/* O MONOLITO: Configurações com Abas */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col lg:flex-row min-h-[600px]">
        
        {/* LADO ESQUERDO: Menu de Abas (20% width) */}
        <div className="w-full lg:w-64 bg-white border-r border-slate-200 p-4 flex flex-col gap-1">
          <p className="px-4 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Geral</p>
          <TabButton id="pipeline" label="Pipeline & Docker" icon={Server} />
          <TabButton id="database" label="Banco de Dados" icon={Database} />
          <TabButton id="interface" label="Interface" icon={Layout} />
          
          <div className="my-2 border-t border-slate-100"></div>
          
          <p className="px-4 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Administração</p>
          <TabButton id="users" label="Usuários e Permissões" icon={UserCog} />
          <TabButton id="security" label="Segurança & Logs" icon={Shield} />
          <TabButton id="notifications" label="Notificações" icon={Bell} />
        </div>

        {/* LADO DIREITO: Conteúdo da Aba (80% width) */}
        <div className="flex-1 bg-slate-50/30 p-8 lg:p-12 overflow-y-auto">
          
          {/* CONTEÚDO: PIPELINE (Exemplo) */}
          {activeTab === 'pipeline' && (
            <div className="max-w-3xl space-y-8 animate-fade-in">
              
              <div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">Recursos de Hardware</h3>
                <p className="text-sm text-slate-500 mb-6">Defina quanto do seu computador o PantherFlow pode usar.</p>
                
                <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-6">
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-sm font-medium text-slate-700">Threads da CPU (Alinhamento)</label>
                      <span className="text-sm font-bold text-brand-primary">12 Threads</span>
                    </div>
                    <input type="range" min="2" max="32" defaultValue="12" className="w-full accent-brand-primary cursor-pointer"/>
                    <p className="text-xs text-slate-400 mt-1">Recomendado: Deixe pelo menos 2 threads livres para o sistema operacional.</p>
                  </div>

                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-sm font-medium text-slate-700">Limite de Memória RAM</label>
                      <span className="text-sm font-bold text-brand-primary">24 GB</span>
                    </div>
                    <input type="range" min="4" max="64" defaultValue="24" className="w-full accent-brand-primary cursor-pointer"/>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">Caminhos do Executável</h3>
                <p className="text-sm text-slate-500 mb-6">Localização das ferramentas externas.</p>
                
                <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Caminho do Docker Socket</label>
                    <input type="text" defaultValue="//./pipe/docker_engine" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono text-slate-600 focus:outline-none focus:border-brand-primary"/>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Pasta de Genomas de Referência</label>
                    <div className="flex gap-2">
                      <input type="text" defaultValue="C:\PantherFlow\References" className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono text-slate-600 focus:outline-none focus:border-brand-primary"/>
                      <button className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200">Browser...</button>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* CONTEÚDO: BANCO DE DADOS (Placeholder) */}
          {activeTab === 'database' && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 animate-fade-in">
              <Database size={48} className="mb-4 opacity-20"/>
              <p className="font-medium">Configurações de conexão SQL virão aqui.</p>
            </div>
          )}

           {/* CONTEÚDO: INTERFACE (Placeholder) */}
           {activeTab === 'interface' && (
            <div className="max-w-3xl animate-fade-in">
               <h3 className="text-lg font-bold text-slate-800 mb-6">Personalização</h3>
               <div className="bg-white p-6 rounded-xl border border-slate-200">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="font-medium text-slate-700">Modo Escuro (Experimental)</span>
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 relative">
                      <div className="absolute top-[2px] left-[2px] bg-white border border-gray-300 w-5 h-5 rounded-full transition-all"></div>
                    </div>
                  </label>
               </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
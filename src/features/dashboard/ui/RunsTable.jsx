// src/features/dashboard/ui/RunsTable.jsx
import React from 'react';
import { Trash2, FileText, Clock } from 'lucide-react';
import StatusBadge from '../shared/StatusBadge'; // Importando da camada Shared!
import { api } from '../data/api'; // Importando da camada Data!

export default function RunsTable({ runs, onRunDeleted }) {

  // Lógica de exclusão que usa a nossa camada de API limpa
  const handleDelete = async (id) => {
    if (!window.confirm("Apagar esta análise e destruir os arquivos no servidor?")) return;
    try {
      await api.deleteAnalysis(id);
      
      // Avisa o componente "Pai" (Dashboard) que apagou, para ele buscar a lista nova
      if (onRunDeleted) {
        onRunDeleted();
      }
    } catch (error) {
      console.error("Erro ao deletar:", error);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Cabeçalho da Tabela */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
        <h3 className="font-bold text-slate-800">Filas de Sequenciamento</h3>
        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-mono">
          Total: {runs.length}
        </span>
      </div>
      
      {/* Corpo da Tabela */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
            <tr>
              <th className="px-6 py-3 font-medium">Paciente</th>
              <th className="px-6 py-3 font-medium">Médico</th>
              <th className="px-6 py-3 font-medium">Protocolo</th>
              <th className="px-6 py-3 font-medium">Início</th>
              <th className="px-6 py-3 font-medium text-right">Status</th>
              <th className="px-6 py-3 font-medium text-center">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {/* Iterando sobre os dados passados pelo componente Pai */}
            {runs.map((run) => (
              <tr key={run.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 font-mono text-xs font-medium text-slate-600 flex items-center gap-2">
                  <FileText size={14} className="text-slate-400" /> {run.patient_id}
                </td>
                <td className="px-6 py-4 font-medium text-slate-900">{run.doctor}</td>
                <td className="px-6 py-4 text-slate-500">{run.protocol}</td>
                <td className="px-6 py-4 text-slate-400 flex items-center gap-1.5">
                  <Clock size={14} /> {new Date(run.date).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-6 py-4 text-right">
                  {/* Nosso mini-componente reutilizável entra aqui! */}
                  <StatusBadge status={run.status} />
                </td>
                <td className="px-6 py-4 text-center">
                  <button onClick={() => handleDelete(run.id)} className="text-slate-400 hover:text-red-500 transition-colors p-1">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}

            {runs.length === 0 && (
              <tr>
                <td colSpan="6" className="p-8 text-center text-slate-400">
                  Nenhum sequenciamento na fila.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
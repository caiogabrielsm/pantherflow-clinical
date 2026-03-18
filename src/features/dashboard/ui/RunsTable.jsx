import React from 'react';
import { Trash2, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import StatusBadge from '../../../common/ui/StatusBadge';
import { api } from '../../../common/data/api'; // Caso você chame a deleção por aqui

export default function RunsTable({ runs, onRunDeleted }) {
  const navigate = useNavigate();

  // Função para deletar (mantendo a sua lógica original)
  const handleDelete = async (id) => {
    if (window.confirm("Tem certeza que deseja apagar esta análise e os arquivos do WSL2?")) {
      try {
        await api.deleteAnalysis(id);
        if (onRunDeleted) onRunDeleted();
      } catch (error) {
        alert("Erro ao deletar análise.");
      }
    }
  };

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 border-y border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
            <th className="p-4 font-semibold">Paciente (UUID)</th>
            <th className="p-4 font-semibold">Médico</th>
            <th className="p-4 font-semibold">Protocolo</th>
            <th className="p-4 font-semibold">Status</th>
            <th className="p-4 font-semibold text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {runs.length === 0 ? (
            <tr>
              <td colSpan="5" className="p-8 text-center text-slate-400">
                Nenhuma corrida encontrada no histórico.
              </td>
            </tr>
          ) : (
            runs.map((run) => (
              <tr key={run.id} className="hover:bg-slate-50 transition-colors">
                <td className="p-4">
                  <div className="font-medium text-slate-900">{run.patientId}</div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">{run.patient_uuid}</div>
                </td>
                <td className="p-4 text-sm text-slate-600">{run.doctor}</td>
                <td className="p-4 text-sm text-slate-600">
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-semibold">
                    {run.protocol}
                  </span>
                </td>
                <td className="p-4">
                  <StatusBadge status={run.status} />
                </td>
                <td className="p-4 flex items-center justify-end gap-2">
                  
                  {/* O NOVO BOTÃO DE LAUDO (Só aparece se concluído) */}
                  {run.status === 'completed' && (
                    <button 
                      onClick={() => navigate('/results', { state: { runData: run } })}
                      className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors flex items-center gap-1 font-semibold text-xs"
                      title="Ver Laudo Clínico"
                    >
                      <FileText size={18} />
                      <span className="hidden sm:inline">Resultado</span>
                    </button>
                  )}

                  <button 
                    onClick={() => handleDelete(run.id)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Excluir Análise"
                  >
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
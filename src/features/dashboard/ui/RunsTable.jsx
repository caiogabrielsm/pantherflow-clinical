import React from 'react';
import { Trash2, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import StatusBadge from '../../../common/ui/StatusBadge';
import { api } from '../../../common/data/api';

export default function RunsTable({ runs, onRunDeleted }) {
  const navigate = useNavigate();

  const handleDelete = async (id) => {
    if (window.confirm('Tem certeza que deseja apagar esta análise e os arquivos do WSL2?')) {
      try {
        await api.deleteAnalysis(id);
        if (onRunDeleted) onRunDeleted();
      } catch {
        alert('Erro ao deletar análise.');
      }
    }
  };

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-left border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-300">
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Paciente</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Médico</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Protocolo</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Data de Criação</th>
            <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">
                Nenhuma corrida encontrada no histórico.
              </td>
            </tr>
          ) : (
            runs.map((run, i) => (
              <tr
                key={run.id}
                className={`border-b border-slate-100 transition-colors hover:bg-slate-50 ${i % 2 === 0 ? '' : 'bg-slate-50/40'}`}
              >
                {/* Paciente */}
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{run.patient_id}</div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5 tracking-wide">{run.patient_uuid}</div>
                </td>

                {/* Médico */}
                <td className="px-4 py-3 text-slate-600">{run.doctor}</td>

                {/* Protocolo */}
                <td className="px-4 py-3">
                  <span className="text-xs font-mono font-semibold text-slate-600 border border-slate-300 px-2 py-0.5">
                    {run.protocol}
                  </span>
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <StatusBadge status={run.status} />
                </td>

                {/* Data */}
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap font-mono text-xs">
                  {run.date
                    ? new Date(run.date.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })
                    : '—'}
                </td>

                {/* Ações */}
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    {run.status === 'completed' && (
                      <button
                        onClick={() => navigate(`/results/${run.patient_uuid}`)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors border-b border-transparent hover:border-slate-900"
                        title="Ver Resultado"
                      >
                        <FileText size={14} />
                        Resultado
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(run.id)}
                      className="text-slate-300 hover:text-red-500 transition-colors"
                      title="Excluir Análise"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

import { useEffect, useState } from 'react';

const History = () => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  // --- COLOQUE O HANDLE DELETE AQUI ---
  const handleDelete = async (id) => {
    if (window.confirm("Tem certeza que deseja excluir esta análise?")) {
      try {
        const response = await fetch(`http://localhost:8000/api/analysis/${id}`, {
          method: 'DELETE',
        });
        
        if (response.ok) {
          // Atualiza a lista removendo o item deletado sem precisar recarregar a página
          setHistory(history.filter(item => item.id !== id));
        }
      } catch (error) {
        console.error("Erro ao eliminar:", error);
      }
    }
  };
  // ------------------------------------

  useEffect(() => {
    fetch('http://localhost:8000/api/history')
      .then(response => response.json())
      .then(data => {
        setHistory(data);
        setLoading(false);
      })
      .catch(error => {
        console.error("Erro ao carregar histórico:", error);
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Histórico de Análises</h2>
      
      {loading ? (
        <p>Carregando histórico...</p>
      ) : (
        <table className="min-w-full bg-white border border-gray-200">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-4 py-2 border">Data</th>
              <th className="px-4 py-2 border">Paciente</th>
              <th className="px-4 py-2 border">Médico</th>
              <th className="px-4 py-2 border">Protocolo</th>
              <th className="px-4 py-2 border">Status</th>
              <th className="px-4 py-2 border">Ações</th> {/* Nova coluna */}
            </tr>
          </thead>
          <tbody>
            {history.map((item) => (
              <tr key={item.id} className="text-center">
                <td className="px-4 py-2 border">
                  {new Date(item.date).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-4 py-2 border font-mono">{item.patient_id}</td>
                <td className="px-4 py-2 border">{item.doctor}</td>
                <td className="px-4 py-2 border">{item.protocol}</td>
                <td className="px-4 py-2 border">
                  <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">
                    {item.status}
                  </span>
                </td>
                {/* BOTÃO DE EXCLUIR ABAIXO */}
                <td className="px-4 py-2 border">
                  <button 
                    onClick={() => handleDelete(item.id)}
                    className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-xs transition-colors"
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default History;
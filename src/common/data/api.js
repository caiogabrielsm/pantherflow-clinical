// src/features/dashboard/data/api.js
import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

// Exportamos um objeto 'api' que contém todas as funções de comunicação com o Python
export const api = {
  
  // 1. Busca o histórico de sequenciamentos na fila
  getHistory: async () => {
    const response = await axios.get(`${API_URL}/history`);
    return response.data;
  },

  // 2. Busca o status do hardware (CPU, RAM, Disco)
  getHealth: async () => {
    const response = await axios.get(`${API_URL}/health`);
    return response.data;
  },

  // 3. Faz o upload do FASTQ e calcula o progresso
  uploadAnalysis: async (formData, onProgressCallback) => {
    const response = await axios.post(`${API_URL}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        // Calcula a porcentagem e envia de volta para quem chamou a função
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        if (onProgressCallback) {
          onProgressCallback(percentCompleted);
        }
      }
    });
    return response.data;
  },

  // 4. Deleta uma análise do banco e do Linux
  deleteAnalysis: async (id) => {
    const response = await axios.delete(`${API_URL}/analysis/${id}`);
    return response.data;
  },

  // Adicione junto com as outras funções (getHistory, getHealth, etc)
  checkDockerHealth: async () => {
    try {
      const response = await fetch('http://localhost:8000/api/health/docker');
      const data = await response.json();
      return data.status === 'online';
    } catch (error) {
      // Se a própria API estiver offline, assumimos que o Docker também está inalcançável
      return false; 
    }
  }
};
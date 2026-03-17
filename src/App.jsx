import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './layout/MainLayout';
import Dashboard from './features/dashboard/DashboardFeature';
import NewAnalysis from './pages/NewAnalysis';
import History from './pages/History'; // 1. TROQUE Monitor por History
import Results from './pages/Results';
import Settings from './pages/Settings';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="new-analysis" element={<NewAnalysis />} />
          
          {/* 2. AQUI: Aponte a rota 'monitor' para o componente History */}
          <Route path="monitor" element={<History />} /> 
          
          <Route path="results" element={<Results />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<div>Página em construção</div>} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
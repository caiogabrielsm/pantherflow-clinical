import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './layout/MainLayout';
import Dashboard from './pages/Dashboard';
import NewAnalysis from './pages/NewAnalysis';
import Monitor from './pages/Monitor';
import Results from './pages/Results';
import Settings from './pages/Settings'; // <--- ÚLTIMA IMPORTAÇÃO

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="new-analysis" element={<NewAnalysis />} />
          <Route path="monitor" element={<Monitor />} />
          <Route path="results" element={<Results />} />
          <Route path="settings" element={<Settings />} /> {/* <--- ROTA FINAL */}
          <Route path="*" element={<div>Página em construção</div>} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
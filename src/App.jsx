import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './layout/MainLayout';
import Dashboard from './pages/Dashboard';
import NewAnalysis from './pages/NewAnalysis';
import Monitor from './pages/Monitor';
import Results from './pages/Results';
import Settings from './pages/Settings';
import BenchmarkingDashboard from './pages/BenchmarkingDashboard';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="new-analysis" element={<NewAnalysis />} />
          <Route path="monitor" element={<Monitor />} />
          <Route path="monitor/:uuid" element={<Monitor />} />
          <Route path="results/:uuid" element={<Results />} />
          <Route path="settings" element={<Settings />} />
          <Route path="benchmarking"   element={<BenchmarkingDashboard />} />
          <Route path="*" element={<div className="p-6 text-slate-500">Página em construção</div>} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
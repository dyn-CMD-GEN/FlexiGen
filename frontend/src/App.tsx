import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { ExperimentProvider } from './context/ExperimentContext';
import { AppLayout } from './components/layout/AppLayout';

import { DashboardPage } from './pages/DashboardPage';
import { ProteinTargetsPage } from './pages/ProteinTargetsPage';
import { PocketAnalysisPage } from './pages/PocketAnalysisPage';
import { MolecularGenerationPage } from './pages/MolecularGenerationPage';
import { MoleculeLibraryPage } from './pages/MoleculeLibraryPage';
import { ValidationPage } from './pages/ValidationPage';
import { DockingRescoringPage } from './pages/DockingRescoringPage';
import { CdiRankingPage } from './pages/CdiRankingPage';
import { ResultsReportsPage } from './pages/ResultsReportsPage';
import { ExperimentsPage } from './pages/ExperimentsPage';
import { SettingsPage } from './pages/SettingsPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ExperimentProvider>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="targets" element={<ProteinTargetsPage />} />
              <Route path="pockets" element={<PocketAnalysisPage />} />
              <Route path="generation" element={<MolecularGenerationPage />} />
              <Route path="library" element={<MoleculeLibraryPage />} />
              <Route path="validation" element={<ValidationPage />} />
              <Route path="docking" element={<DockingRescoringPage />} />
              <Route path="cdi" element={<CdiRankingPage />} />
              <Route path="results" element={<ResultsReportsPage />} />
              <Route path="experiments" element={<ExperimentsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ExperimentProvider>
      </ToastProvider>
    </BrowserRouter>
  );
};

export default App;

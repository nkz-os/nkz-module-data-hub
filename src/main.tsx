import React from 'react';
import ReactDOM from 'react-dom/client';
import { MockProvider } from '@nekazari/module-kit/mock';
import DataHubPage from './DataHubPage';
import './lib-overrides.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MockProvider fixtures={{ moduleId: 'datahub' }}>
      <DataHubPage />
    </MockProvider>
  </React.StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('overnight-runner: #root container is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);

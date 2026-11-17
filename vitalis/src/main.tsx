import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/manrope';
import './styles/app.css';
import { App } from './App';
import { AppProvider } from './state';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
);

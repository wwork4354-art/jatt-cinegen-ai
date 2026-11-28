import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import {SecurityGate} from './components/SecurityGate.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <SecurityGate>
      <App />
    </SecurityGate>
  </ErrorBoundary>
);

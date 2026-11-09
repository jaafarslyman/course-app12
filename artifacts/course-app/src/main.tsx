import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { enableScreenProtection } from '@/lib/privacy-screen';

import './index.css';

try {
  void enableScreenProtection().catch((error: unknown) => {
    console.warn('Could not enable native screen protection.', error);
  });
} catch (error) {
  console.warn('Could not enable native screen protection.', error);
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

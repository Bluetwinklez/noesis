import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { boot } from './app/boot';
import { App } from './app/App';
import { Spinner } from './components/ui';
import { RecoveryScreen } from './app/RecoveryScreen';
import { ErrorBoundary } from './components/ErrorBoundary';

function Root() {
  const [state, setState] = useState<'loading' | 'ready' | Error>('loading');
  useEffect(() => {
    boot().then(
      () => setState('ready'),
      (e) => setState(e instanceof Error ? e : new Error(String(e))),
    );
  }, []);
  if (state === 'loading')
    return (
      <div className="flex h-full items-center justify-center gap-3 text-muted">
        <Spinner /> Noesis
      </div>
    );
  if (state instanceof Error)
    return <RecoveryScreen error={state} />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary scope="app"><Root /></ErrorBoundary>
  </StrictMode>,
);

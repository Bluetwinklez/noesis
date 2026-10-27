import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { boot } from './app/boot';
import { App } from './app/App';
import { Spinner } from './components/ui';

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
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-lg font-semibold">Noesis could not open its database</div>
        <pre className="max-w-xl whitespace-pre-wrap rounded-lg bg-inset p-3 text-left text-xs text-danger">{state.message}</pre>
        <p className="max-w-md text-sm text-muted">
          Your data has not been modified. Restart the app; if this persists, restore a backup from Settings or contact support with the message above.
        </p>
      </div>
    );
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

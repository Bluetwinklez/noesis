import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { useT } from '../i18n';

export function errorDetails(error: Error, componentStack = '') {
  return `Noesis ${import.meta.env.VITE_APP_VERSION ?? 'development'}\n${error.stack || error.message}\n${componentStack}`;
}

function Failure({ error, stack, scope, retry }: { error: Error; stack: string; scope: 'app' | 'view'; retry: () => void }) {
  const t = useT();
  const [copyError, setCopyError] = useState(false);
  return <section role="alert" className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
    <h1 className="text-xl font-semibold">{t(scope === 'app' ? 'recovery.appFailed' : 'recovery.viewFailed')}</h1>
    <p className="text-sm text-muted">{t('recovery.viewHelp')}</p>
    <pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-inset p-3 text-xs text-danger">{error.message}</pre>
    <div className="flex flex-wrap gap-3">
      <button className="rounded-lg bg-accent px-4 py-2 text-sm text-white" onClick={retry}>{t('recovery.reloadView')}</button>
      <button className="rounded-lg border border-line px-4 py-2 text-sm" onClick={() => void Promise.resolve().then(() => navigator.clipboard.writeText(errorDetails(error, stack))).catch(() => setCopyError(true))}>{t('recovery.copyDetails')}</button>
    </div>
    {copyError && <textarea aria-label={t('recovery.copyDetails')} readOnly value={errorDetails(error, stack)} className="h-40 w-full rounded border border-line p-2 text-xs" />}
  </section>;
}

/** A new key remounts the failed subtree without rebooting storage or the sidebar. */
export class ErrorBoundary extends Component<{ children: ReactNode; scope?: 'app' | 'view' }, { error: Error | null; stack: string; generation: number }> {
  state = { error: null as Error | null, stack: '', generation: 0 };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error : new Error(String(error)) }; }
  componentDidCatch(_error: Error, info: ErrorInfo) { this.setState({ stack: info.componentStack ?? '' }); }
  render() {
    if (this.state.error) return <Failure error={this.state.error} stack={this.state.stack} scope={this.props.scope ?? 'view'} retry={() => this.setState(({ generation }) => ({ error: null, stack: '', generation: generation + 1 }))} />;
    return <div key={this.state.generation} className="contents">{this.props.children}</div>;
  }
}

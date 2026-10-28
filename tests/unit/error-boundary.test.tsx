// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { useApp } from '../../src/app/state';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('view error boundary', () => {
  it('keeps sibling navigation alive, copies diagnostics and retries the failed view', async () => {
    useApp.setState({ lang: 'en' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    let broken = true;
    function View() { if (broken) throw new Error('Synthetic render failure'); return <p>Recovered view</p>; }
    const navigate = vi.fn();
    render(<><button onClick={navigate}>Sidebar navigation</button><ErrorBoundary><View /></ErrorBoundary></>);
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic render failure');
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar navigation' }));
    expect(navigate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Synthetic render failure')));
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reload view' }));
    expect(await screen.findByText('Recovered view')).toBeVisible();
  });
});

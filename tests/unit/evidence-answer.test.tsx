// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EvidenceAnswer } from '../../src/features/notebooks/EvidenceAnswer';
import type { Citation } from '../../src/core/types';

afterEach(cleanup);
const citation: Citation = { n: 1, sourceId: 'source', sourceTitle: 'Field notes', pageNumber: 2, chunkId: 3, charStart: 0, charEnd: 20, excerpt: 'RuBisCO fixes carbon.' };
describe('rendered evidence', () => {
  it('preserves Markdown formatting and citation click-through while marking an uncited sentence', () => {
    const onOpen = vi.fn();
    const { container } = render(<EvidenceAnswer text="**RuBisCO** fixes carbon. [1] This is unsupported." citations={[citation]} onOpen={onOpen} />);
    expect(container.querySelector('strong')?.textContent).toBe('RuBisCO');
    expect(container.querySelector('[data-evidence="uncited"]')?.textContent).toContain('This is unsupported.');
    fireEvent.click(screen.getByRole('button', { name: 'Field notes · p. 2' }));
    expect(onOpen).toHaveBeenCalledWith(citation);
  });
  it('sanitizes model HTML and leaves code references as literal text', () => {
    const { container } = render(<EvidenceAnswer text={'<img src=x onerror="alert(1)"><button data-citation="1">Fake</button>\n\n`literal [1]`'} citations={[citation]} onOpen={() => {}} />);
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('literal [1]');
  });
});

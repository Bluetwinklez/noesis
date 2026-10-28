import { describe, expect, it } from 'vitest';
import { scoreEvidence } from '../eval/scoring';
import { evidenceCases } from '../eval/cases';

describe('evidence evaluation scoring', () => {
  it('rejects a valid citation number whose chunk lacks the expected claim terms', () => {
    const score = scoreEvidence(evidenceCases[1], {
      text: 'The excavation recovered 731 artefacts [1].', insufficient: false,
      citations: [{ n: 1, sourceId: 's', sourceTitle: 'S', chunkId: 1, pageNumber: null, charStart: 0, charEnd: 10, excerpt: 'A different project.' }],
      retrieved: [{ sourceId: 's', sourceTitle: 'S', chunkId: 1, text: 'A different project.', pageNumber: null, charStart: 0, charEnd: 10, score: 1 }],
    });
    expect(score.citationPresent).toBe(true);
    expect(score.citationSupported).toBe(false);
  });
  it('does not mistake an uncited factual answer for a refusal', () => {
    const score = scoreEvidence(evidenceCases[3], { text: 'London hosted the 2012 Olympics.', insufficient: true, citations: [], retrieved: [] });
    expect(score.refusalCorrect).toBe(false);
    expect(score.answerCorrect).toBe(false);
  });
  it('rejects an answer that omits the expected number even when a source is cited', () => {
    const score = scoreEvidence(evidenceCases[1], { text: 'Many artefacts [1].', insufficient: false, citations: [], retrieved: [] });
    expect(score.answerCorrect).toBe(false);
    expect(score.citationPresent).toBe(false);
  });
});

import type { GroundedAnswer } from '../../src/ai/rag';
import type { EvidenceCase } from './cases';

const normalized = (s: string) => s.toLocaleLowerCase('tr').normalize('NFKC');
export function scoreEvidence(test: EvidenceCase, answer: Pick<GroundedAnswer, 'text' | 'citations' | 'insufficient' | 'retrieved'>) {
  const refusal = answer.insufficient && /do not contain|does not (?:contain|provide)|cannot (?:answer|determine)|not enough information|bilgi içermiyor|yeterli bilgi yok/i.test(answer.text);
  if (test.refusal) return { answerCorrect: refusal, citationPresent: true, citationSupported: true, refusalCorrect: refusal };
  const answerCorrect = test.expectedTerms.every((term) => normalized(answer.text).includes(normalized(term)));
  const citationSupported = answer.citations.length > 0 && answer.citations.every((c) => {
    const chunk = answer.retrieved.find((r) => r.chunkId === c.chunkId && r.sourceId === c.sourceId);
    return !!chunk && test.expectedTerms.every((term) => normalized(chunk.text).includes(normalized(term)));
  });
  return { answerCorrect, citationPresent: answer.citations.length > 0, citationSupported, refusalCorrect: !refusal && !answer.insufficient };
}

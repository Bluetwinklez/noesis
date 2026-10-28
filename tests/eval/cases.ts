export interface EvidenceCase {
  id: string;
  question: string;
  source: string;
  expectedTerms: string[];
  refusal?: boolean;
  lang: 'en' | 'tr';
  mockReply: string;
}

export const evidenceCases: EvidenceCase[] = [
  { id: 'enzyme', lang: 'en', question: 'Which enzyme fixes carbon?', source: 'RuBisCO fixes carbon in the Calvin cycle.', expectedTerms: ['RuBisCO', 'carbon'], mockReply: 'RuBisCO fixes carbon [1].' },
  { id: 'excavation-number', lang: 'en', question: 'How many artefacts did the Izmir excavation recover?', source: 'The Izmir excavation recovered exactly 731 artefacts in 2026.', expectedTerms: ['731', 'artefacts'], mockReply: 'The excavation recovered 731 artefacts [1].' },
  { id: 'turkish-count', lang: 'tr', question: 'Deneyde kaç örnek incelendi?', source: 'Deneyde toplam 48 örnek incelendi. Araştırmacıların ölçümleri kaydedildi.', expectedTerms: ['48', 'örnek'], mockReply: 'Deneyde 48 örnek incelendi [1].' },
  { id: 'unsupported-olympics', lang: 'en', question: 'Which city hosted the 2012 Olympics?', source: 'RuBisCO fixes carbon in the Calvin cycle.', expectedTerms: [], refusal: true, mockReply: 'The selected sources do not contain information that answers this question.' },
];

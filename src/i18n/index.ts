import { useApp } from '../app/state';
import { en } from './en';
import { tr } from './tr';

export type Lang = 'en' | 'tr';
export type MessageKey = keyof typeof en;

/** Add a language by adding a dictionary with the same keys. */
export const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, tr };
export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'tr', label: 'Türkçe' },
];

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  let s = dictionaries[lang]?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function useT() {
  const lang = useApp((s) => s.lang);
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
}

export function t(key: MessageKey, vars?: Record<string, string | number>) {
  return translate(useApp.getState().lang, key, vars);
}

import { displayLanguage, LANGUAGES, type LanguageCode } from '@/lib/languages';
import { en, type Dict, type DictKey } from './en';
import { hi } from './hi';
import { ta } from './ta';

export type { Dict, DictKey };

/** Languages with a complete dictionary. Everything else is shown in English. */
export const DICTIONARIES: Partial<Record<LanguageCode, Dict>> = { en, hi, ta };

export interface I18n {
  /** The language the user picked. */
  selected: LanguageCode;
  /** The language the interface text is actually in. Use this for `lang`. */
  uiLanguage: LanguageCode;
  uiDir: 'ltr' | 'rtl';
  t(key: DictKey, vars?: Record<string, string | number>): string;
}

export function createI18n(selected: LanguageCode): I18n {
  const uiLanguage = displayLanguage(selected);
  const dict = DICTIONARIES[uiLanguage] ?? en;
  return {
    selected,
    uiLanguage,
    uiDir: LANGUAGES[uiLanguage].dir,
    t(key, vars) {
      const template = dict[key] ?? en[key];
      return vars
        ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
        : template;
    },
  };
}

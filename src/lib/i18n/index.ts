import { displayLanguage, LANGUAGES, type LanguageCode } from '@/lib/languages';
import { as } from './as';
import { bn } from './bn';
import { en, type Dict, type DictKey } from './en';
import { gu } from './gu';
import { hi } from './hi';
import { kn } from './kn';
import { ml } from './ml';
import { mr } from './mr';
import { or } from './or';
import { pa } from './pa';
import { ta } from './ta';
import { te } from './te';
import { ur } from './ur';

export type { Dict, DictKey };

/**
 * Languages with a complete dictionary. A language without one is shown in
 * English and labelled as a preview.
 */
export const DICTIONARIES: Partial<Record<LanguageCode, Dict>> = { as, bn, en, gu, hi, kn, ml, mr, or, pa, ta, te, ur };

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

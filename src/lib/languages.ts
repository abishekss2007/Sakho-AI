/**
 * Language configuration for Sakho.
 *
 * Four capabilities are tracked separately because one never implies another:
 * interface text, speech recognition, speech synthesis and AI replies.
 */

export const LANGUAGE_CODES = [
  'hi',
  'bn',
  'mr',
  'te',
  'ta',
  'gu',
  'ur',
  'kn',
  'or',
  'ml',
  'pa',
  'as',
  'en',
] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

/**
 * - `complete`: full interface text, written in the source language.
 * - `complete-unreviewed`: full interface text, not yet checked by a fluent speaker.
 * - `preview`: no interface translation; screens are shown in English.
 */
export type UiSupport = 'complete' | 'complete-unreviewed' | 'preview';

/** Recognition is provided by the user's browser; Sakho cannot guarantee it. */
export type RecognitionSupport = 'browser-dependent';

/**
 * Cloud voices are requested by language code only. Availability has not been
 * verified against the provider for this build; run `npm run check:providers`.
 */
export type SynthesisSupport = 'provider-unverified';

/** `unreviewed`: the model is asked to reply in the language; quality is not reviewed. */
export type AiSupport = 'supported' | 'unreviewed';

export interface LanguageConfig {
  code: LanguageCode;
  englishName: string;
  nativeName: string;
  /** BCP 47 tag used for speech recognition, synthesis and `lang` attributes. */
  bcp47: string;
  dir: 'ltr' | 'rtl';
  /** A short spoken greeting in the language itself. */
  greeting: string;
  ui: UiSupport;
  recognition: RecognitionSupport;
  synthesis: SynthesisSupport;
  ai: AiSupport;
}

function lang(
  code: LanguageCode,
  englishName: string,
  nativeName: string,
  greeting: string,
  ui: UiSupport,
  dir: 'ltr' | 'rtl' = 'ltr',
): LanguageConfig {
  return {
    code,
    englishName,
    nativeName,
    bcp47: `${code}-IN`,
    dir,
    greeting,
    ui,
    recognition: 'browser-dependent',
    synthesis: 'provider-unverified',
    ai: code === 'en' ? 'supported' : 'unreviewed',
  };
}

export const LANGUAGES: Readonly<Record<LanguageCode, LanguageConfig>> = {
  hi: lang('hi', 'Hindi', 'हिन्दी', 'नमस्ते', 'complete-unreviewed'),
  bn: lang('bn', 'Bengali', 'বাংলা', 'নমস্কার', 'complete-unreviewed'),
  mr: lang('mr', 'Marathi', 'मराठी', 'नमस्कार', 'complete-unreviewed'),
  te: lang('te', 'Telugu', 'తెలుగు', 'నమస్కారం', 'complete-unreviewed'),
  ta: lang('ta', 'Tamil', 'தமிழ்', 'வணக்கம்', 'complete-unreviewed'),
  gu: lang('gu', 'Gujarati', 'ગુજરાતી', 'નમસ્તે', 'complete-unreviewed'),
  ur: lang('ur', 'Urdu', 'اردو', 'آداب', 'complete-unreviewed', 'rtl'),
  kn: lang('kn', 'Kannada', 'ಕನ್ನಡ', 'ನಮಸ್ಕಾರ', 'complete-unreviewed'),
  or: lang('or', 'Odia', 'ଓଡ଼ିଆ', 'ନମସ୍କାର', 'complete-unreviewed'),
  ml: lang('ml', 'Malayalam', 'മലയാളം', 'നമസ്കാരം', 'complete-unreviewed'),
  pa: lang('pa', 'Punjabi', 'ਪੰਜਾਬੀ', 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'complete-unreviewed'),
  as: lang('as', 'Assamese', 'অসমীয়া', 'নমস্কাৰ', 'complete-unreviewed'),
  en: lang('en', 'English', 'English', 'Hello', 'complete'),
};

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (LANGUAGE_CODES as readonly string[]).includes(value);
}

/**
 * The language the interface text is actually displayed in. Preview languages
 * fall back to English, so `lang`/`dir` on the page must say English.
 */
export function displayLanguage(code: LanguageCode): LanguageCode {
  return LANGUAGES[code].ui === 'preview' ? 'en' : code;
}

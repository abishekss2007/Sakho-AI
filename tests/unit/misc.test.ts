import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { boundHistory } from '@/components/types';
import { LIMITS } from '@/lib/api/contracts';
import { EMERGENCY_SERVICES, looksUrgent, resolveSosMode } from '@/lib/emergency';
import { createI18n, DICTIONARIES } from '@/lib/i18n';
import { en } from '@/lib/i18n/en';
import { displayLanguage, isLanguageCode, LANGUAGE_CODES, LANGUAGES } from '@/lib/languages';
import { buildQrValue, QR_PREFIX, shareText } from '@/lib/share';
import { DEFAULT_PREFS, LEGACY_TUTORIAL_KEYS, loadPrefs, PREFS_KEY, savePrefs } from '@/lib/storage';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('languages', () => {
  it('configures all 13 languages', () => {
    expect([...LANGUAGE_CODES].sort()).toEqual(['as', 'bn', 'en', 'gu', 'hi', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te', 'ur']);
    for (const code of LANGUAGE_CODES) {
      expect(LANGUAGES[code].nativeName.length).toBeGreaterThan(0);
      expect(LANGUAGES[code].greeting.length).toBeGreaterThan(0);
      expect(LANGUAGES[code].bcp47).toBe(`${code}-IN`);
    }
  });

  it('labels support honestly: only English is reviewed, every other language says it needs review', () => {
    const byUi = (ui: string) => LANGUAGE_CODES.filter((c) => LANGUAGES[c].ui === ui);
    expect(byUi('complete')).toEqual(['en']);
    expect(byUi('complete-unreviewed')).toHaveLength(12);
    expect(byUi('preview')).toHaveLength(0);
  });

  it('a dictionary exists exactly for the languages marked complete', () => {
    for (const code of LANGUAGE_CODES) {
      expect(DICTIONARIES[code] !== undefined).toBe(LANGUAGES[code].ui !== 'preview');
    }
  });

  it('tracks capabilities separately and does not overclaim', () => {
    for (const code of LANGUAGE_CODES) {
      expect(LANGUAGES[code].recognition).toBe('browser-dependent');
      expect(LANGUAGES[code].synthesis).toBe('provider-unverified');
      expect(LANGUAGES[code].ai).toBe(code === 'en' ? 'supported' : 'unreviewed');
    }
  });

  it('only Urdu is right-to-left', () => {
    expect(LANGUAGE_CODES.filter((c) => LANGUAGES[c].dir === 'rtl')).toEqual(['ur']);
  });

  it('validates codes', () => {
    expect(isLanguageCode('ta')).toBe(true);
    expect(isLanguageCode('fr')).toBe(false);
    expect(isLanguageCode(5)).toBe(false);
  });
});

describe('translations', () => {
  const keys = Object.keys(en).sort();
  const translated = LANGUAGE_CODES.filter((code) => code !== 'en');

  it.each(translated)('%s has every key, non-empty, with the same placeholders', (code) => {
    const dict = DICTIONARIES[code];
    expect(dict).toBeDefined();
    expect(Object.keys(dict ?? {}).sort()).toEqual(keys);
    for (const key of keys as (keyof typeof en)[]) {
      const source = en[key];
      const translated = dict?.[key] ?? '';
      expect(translated.trim().length, key).toBeGreaterThan(0);
      expect((translated.match(/\{\w+\}/g) ?? []).sort(), key).toEqual((source.match(/\{\w+\}/g) ?? []).sort());
    }
  });

  it.each(translated)('%s is actually translated, not copied English', (code) => {
    const dict = DICTIONARIES[code];
    const same = (Object.keys(en) as (keyof typeof en)[]).filter((k) => dict?.[k] === en[k]);
    expect(same).toEqual(['appName']);
  });

  it('never promises eligibility in any language', () => {
    for (const dict of Object.values(DICTIONARIES)) {
      expect(JSON.stringify(dict)).not.toMatch(/you are eligible|आप पात्र हैं|நீங்கள் தகுதியானவர்/i);
    }
  });

  it('uses the product name everywhere and the old name nowhere', () => {
    for (const dict of Object.values(DICTIONARIES)) {
      expect(dict?.appName).toBe('Sakho');
      expect(JSON.stringify(dict)).not.toMatch(/thozhi|தோழி/i);
    }
  });

  it('interpolates variables', () => {
    expect(createI18n('en').t('questionOf', { n: 2, total: 4 })).toBe('Question 2 of 4');
    expect(createI18n('hi').t('questionOf', { n: 2, total: 4 })).toBe('सवाल 2 / 4');
  });

  it('the page language and direction follow the chosen language; Urdu is right-to-left', () => {
    const urdu = createI18n('ur');
    expect(urdu.uiLanguage).toBe('ur');
    expect(urdu.uiDir).toBe('rtl');
    expect(urdu.t('yes')).toBe('ہاں');
    expect(displayLanguage('ta')).toBe('ta');
    expect(createI18n('ta').t('yes')).toBe('ஆம்');
    expect(createI18n('as').t('questionOf', { n: 1, total: 3 })).toBe('প্ৰশ্ন 1 / 3');
  });

  it('keeps numbers, the helpline and the official address unchanged in every language', () => {
    for (const dict of Object.values(DICTIONARIES)) {
      expect(dict?.step3).toContain('14408');
      expect(dict?.step2).toContain('pmmvy.wcd.gov.in');
      expect(dict?.reason_not_pregnant_or_recent_birth).toMatch(/270|২৭০|२७०/);
    }
  });
});

describe('preferences storage', () => {
  it('returns defaults when storage is empty, corrupt or unavailable', () => {
    expect(loadPrefs(memoryStorage())).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(memoryStorage({ [PREFS_KEY]: '{broken' }))).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(memoryStorage({ [PREFS_KEY]: JSON.stringify({ language: 'xx' }) }))).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(undefined)).toEqual(DEFAULT_PREFS);
  });

  it('does not crash when storage throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(loadPrefs(blocked)).toEqual(DEFAULT_PREFS);
    expect(savePrefs(DEFAULT_PREFS, blocked)).toBe(false);
  });

  it('round-trips preferences under the new key', () => {
    const storage = memoryStorage();
    const prefs = { language: 'ta' as const, speed: 'slow' as const, autoRead: true, introSeen: true };
    expect(savePrefs(prefs, storage)).toBe(true);
    expect(loadPrefs(storage)).toEqual(prefs);
    expect([...storage.data.keys()]).toEqual(['sakho-ai:prefs:v1']);
  });

  it.each(LEGACY_TUTORIAL_KEYS)('migrates the legacy tutorial flag %s and removes it', (key) => {
    const storage = memoryStorage({ [key]: 'true' });
    expect(loadPrefs(storage).introSeen).toBe(true);
    expect(storage.data.has(key)).toBe(false);
    expect(JSON.parse(storage.data.get(PREFS_KEY) ?? '{}').introSeen).toBe(true);
  });

  it('stores only non-sensitive fields', () => {
    expect(Object.keys(DEFAULT_PREFS).sort()).toEqual(['autoRead', 'introSeen', 'language', 'speed']);
  });
});

describe('sharing', () => {
  it('reports success', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareText('t', 'body', { share })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 't', text: 'body' });
  });

  it('treats dismissing the share sheet as cancellation (regression: it used to open SMS)', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('dismissed'), { name: 'AbortError' }));
    const open = vi.spyOn(window, 'open');
    expect(await shareText('t', 'body', { share })).toBe('cancelled');
    expect(share).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('reports failure and missing support without trying anything else', async () => {
    expect(await shareText('t', 'body', { share: vi.fn().mockRejectedValue(new Error('boom')) })).toBe('failed');
    expect(await shareText('t', 'body', {})).toBe('unsupported');
    expect(await shareText('t', 'body', undefined)).toBe('unsupported');
  });

  it('has no SMS or other fallback channel in the share module', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/share.ts'), 'utf8');
    expect(source).not.toMatch(/sms:|mailto:|whatsapp|clipboard/i);
  });
});

describe('QR content', () => {
  const answers = { pregnant_or_recent_birth: 'yes', child_order: 'first' };
  it('contains only the official address by default', () => {
    const value = buildQrValue(false, answers, { aadhaar: 'have' });
    expect(value).toBe('https://pmmvy.wcd.gov.in/');
    expect(value).not.toMatch(/pregnant|aadhaar|yes/);
  });
  it('embeds answers only after opt-in, under the new prefix', () => {
    const value = buildQrValue(true, answers, { aadhaar: 'have', mobile: 'unknown' });
    expect(value.startsWith(`${QR_PREFIX}|pmmvy|pmmvy-draft-2026-10-01|`)).toBe(true);
    expect(QR_PREFIX).toBe('SAKHO1');
    expect(value).toContain('pregnant_or_recent_birth=yes');
    expect(value).toContain('aadhaar=have');
    expect(value).not.toContain('mobile');
  });
});

describe('emergency configuration', () => {
  it('is live only for the exact value "live"', () => {
    expect(resolveSosMode('live')).toBe('live');
    for (const value of [undefined, '', 'LIVE', 'true', 'demo', 'prod']) expect(resolveSosMode(value)).toBe('demo');
  });
  it('lists only verified services with an official source', () => {
    expect(EMERGENCY_SERVICES.map((s) => s.number)).toEqual(['112', '181', '1098']);
    for (const service of EMERGENCY_SERVICES) {
      expect(new URL(service.sourceUrl).hostname).toMatch(/\.gov\.in$/);
      expect(service.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it('spots some urgent phrases in three languages and stays quiet on ordinary text', () => {
    for (const text of ['Help me please', 'I am bleeding', 'बचाओ', 'खून बह रहा है', 'காப்பாற்று', 'அவசரம்']) {
      expect(looksUrgent(text), text).toBe(true);
    }
    for (const text of ['What documents do I need?', 'helpful', 'मुझे योजना के बारे में बताओ', 'எனக்கு உதவித்தொகை வேண்டும்']) {
      expect(looksUrgent(text), text).toBe(false);
    }
  });
});

describe('conversation context', () => {
  const item = (role: 'user' | 'assistant', text: string) => ({ role, text });
  it('keeps the most recent messages within the count limit, starting with the user', () => {
    const items = Array.from({ length: 30 }, (_, i) => item(i % 2 === 0 ? 'user' : 'assistant', `m${i}`));
    items.push(item('user', 'latest'));
    const history = boundHistory(items);
    expect(history.length).toBeLessThanOrEqual(LIMITS.chatMessages);
    expect(history[0]?.role).toBe('user');
    expect(history[history.length - 1]?.text).toBe('latest');
  });
  it('drops the oldest messages to stay within the size limit', () => {
    const items = Array.from({ length: 9 }, (_, i) => item(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(1000)));
    const history = boundHistory(items);
    expect(history.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(LIMITS.chatTotalChars);
    expect(history[0]?.role).toBe('user');
  });
  it('always keeps the newest message', () => {
    expect(boundHistory([item('user', 'only')])).toEqual([{ role: 'user', text: 'only' }]);
  });
});

describe('design tokens', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
  const token = (name: string): string => {
    const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!match?.[1]) throw new Error(`missing token ${name}`);
    return match[1];
  };
  const luminance = (hex: string) => {
    const channel = (i: number) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  // WCAG 2.2 AA: 4.5:1 for text.
  it.each([
    ['ink', 'surface'],
    ['ink', 'card'],
    ['ink', 'primary-soft'],
    ['ink', 'accent-soft'],
    ['ink', 'danger-soft'],
    ['muted', 'surface'],
    ['muted', 'card'],
    ['muted', 'primary-soft'],
    ['primary', 'surface'],
    ['primary', 'card'],
    ['accent', 'card'],
    ['card', 'primary'],
    ['card', 'primary-bright'],
    ['accent', 'accent-soft'],
    ['primary', 'primary-soft'],
    ['muted', 'accent-soft'],
    ['card', 'primary-strong'],
    ['card', 'danger'],
    ['card', 'danger-strong'],
  ])('text %s on %s meets 4.5:1', (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
  });

  // WCAG 2.2 AA: 3:1 for control boundaries and focus indicators.
  it.each([
    ['line', 'surface'],
    ['line', 'card'],
    ['primary', 'surface'],
    ['danger', 'surface'],
    ['accent', 'accent-soft'],
    ['ink', 'surface'],
  ])('boundary %s on %s meets 3:1', (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(3);
  });

  it('respects reduced motion and uses no web font downloads', () => {
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).not.toMatch(/@font-face|fonts\.googleapis/);
  });
});

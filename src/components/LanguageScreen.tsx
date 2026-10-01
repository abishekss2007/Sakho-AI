'use client';

import { useState } from 'react';
import { createI18n, type DictKey } from '@/lib/i18n';
import { LANGUAGE_CODES, LANGUAGES, type LanguageCode, type UiSupport } from '@/lib/languages';
import { Button } from './ui/Button';
import { Icon, IconBadge } from './ui/Icon';
import { Notice } from './ui/Notice';
import { useVoice } from './useVoice';

const SUPPORT: Record<UiSupport, { chip: DictKey; detail: DictKey; style: string }> = {
  complete: { chip: 'chipFull', detail: 'langComplete', style: 'bg-primary-soft text-primary' },
  'complete-unreviewed': { chip: 'chipReview', detail: 'langUnreviewed', style: 'bg-primary-soft text-primary' },
  preview: { chip: 'chipPreview', detail: 'langPreview', style: 'bg-accent-soft text-accent' },
};

/**
 * Language choice. Each language is shown in its own script with an honest
 * support label. The screen's own text follows the highlighted language, and
 * nothing is saved until the user confirms.
 */
export function LanguageScreen({
  current,
  onConfirm,
}: {
  current: LanguageCode;
  onConfirm(language: LanguageCode): void;
}) {
  const [choice, setChoice] = useState<LanguageCode>(current);
  const voice = useVoice();
  const preview = createI18n(choice);
  const { t } = preview;
  const chosen = LANGUAGES[choice];

  return (
    <section
      aria-labelledby="language-title"
      lang={preview.uiLanguage}
      dir={preview.uiDir}
      className="flex flex-col gap-5"
    >
      <div className="flex items-center gap-4">
        <IconBadge name="globe" size="lg" />
        <h1 id="language-title" className="min-w-0 flex-1 text-3xl font-bold tracking-tight">
          {t('chooseLanguage')}
        </h1>
      </div>

      {/* Messages sit above the list so the confirm bar below never grows over it. */}
      {chosen.ui === 'preview' && (
        <Notice tone="warning" live={false}>
          {t('previewNotice')}
        </Notice>
      )}
      {voice.notice && <Notice tone="warning">{t(voice.notice)}</Notice>}

      <ul className="grid grid-cols-2 gap-3">
        {LANGUAGE_CODES.map((code) => {
          const language = LANGUAGES[code];
          const selected = code === choice;
          const support = SUPPORT[language.ui];
          return (
            <li key={code}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => setChoice(code)}
                className={`relative flex h-full min-h-28 w-full flex-col items-start gap-1 rounded-3xl p-4 text-start shadow-card transition wrap-break-word ${
                  selected ? 'border-2 border-primary bg-primary-soft' : 'border border-line bg-card hover:bg-primary-soft'
                }`}
              >
                {selected && (
                  <span className="absolute end-3 top-3 inline-flex size-8 items-center justify-center rounded-full bg-primary text-white">
                    <Icon name="check" size={20} />
                  </span>
                )}
                <span lang={language.bcp47} dir={language.dir} className="pe-8 text-2xl leading-snug font-bold">
                  {language.nativeName}
                </span>
                {language.englishName !== language.nativeName && (
                  <span lang="en" className="text-base text-muted">
                    {language.englishName}
                  </span>
                )}
                <span className={`mt-auto rounded-full px-3 py-1 text-sm font-bold ${support.style}`}>
                  {t(support.chip)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Kept in view so the choice can be confirmed without scrolling past every language. */}
      <div
        className="sticky -bottom-6 z-10 -mx-4 flex flex-col gap-3 rounded-t-3xl border-t border-line-soft bg-card px-4 pt-4 pb-6 shadow-card"
      >
        <p aria-live="polite">
          <span lang={chosen.bcp47} dir={chosen.dir} className="font-bold">
            {chosen.nativeName}
          </span>
          {': '}
          {t(SUPPORT[chosen.ui].detail)}
        </p>
        <div className="flex flex-col gap-3">
          <Button variant="secondary" size="md" icon="speaker" onClick={() => void voice.speak(chosen.greeting, choice, true)}>
            {t('hearGreeting')}
            {': '}
            <span lang={chosen.bcp47} dir={chosen.dir}>
              {chosen.greeting}
            </span>
          </Button>
          <Button
            icon="next"
            onClick={() => {
              voice.stop();
              onConfirm(choice);
            }}
          >
            {t('confirmLanguage')}
          </Button>
        </div>
      </div>
    </section>
  );
}

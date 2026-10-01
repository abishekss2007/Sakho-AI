'use client';

import { useState } from 'react';
import { SPEEDS, type Speed } from '@/lib/api/contracts';
import type { DictKey } from '@/lib/i18n';
import { LANGUAGES } from '@/lib/languages';
import type { Prefs } from '@/lib/storage';
import { useApp } from './AppContext';
import type { Screen } from './types';
import { Button } from './ui/Button';
import { Icon, IconBadge, type IconName } from './ui/Icon';
import { Card } from './ui/Notice';

/** A compact entry card: icon tile, title and one short line. */
function Entry({
  icon,
  title,
  description,
  tone = 'primary',
  onClick,
}: {
  icon: IconName;
  title: string;
  description: string;
  tone?: 'primary' | 'accent' | 'danger';
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-20 w-full items-center gap-4 rounded-3xl border bg-card p-4 text-start shadow-card transition hover:bg-primary-soft active:scale-[0.99] ${
        tone === 'danger' ? 'border-danger' : 'border-line-soft'
      }`}
    >
      <IconBadge name={icon} tone={tone} />
      <span className="flex min-w-0 flex-1 flex-col wrap-break-word">
        <span className={`text-lg leading-snug font-bold ${tone === 'danger' ? 'text-danger-strong' : ''}`}>{title}</span>
        <span className="text-[0.95rem] leading-snug text-muted">{description}</span>
      </span>
      <span className="text-muted">
        <Icon name="next" size={22} />
      </span>
    </button>
  );
}

export function HomeScreen({
  go,
  onTalk,
  onPapers,
}: {
  go(screen: Screen): void;
  onTalk(): void;
  onPapers(): void;
}) {
  const { i18n, openSos } = useApp();
  const { t } = i18n;
  return (
    <section aria-labelledby="home-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 pt-2">
        <h1 id="home-title" className="text-3xl leading-tight font-bold tracking-tight">
          {t('homeGreeting')}
        </h1>
        <p className="text-lg text-muted">{t('homeSub')}</p>
      </div>

      {/* The main action: one large talk button. Its label is real text, not only an icon. */}
      <button
        type="button"
        onClick={onTalk}
        className="group mx-auto flex flex-col items-center gap-3 rounded-[2.5rem] px-6 py-2 text-center"
      >
        <span className="relative flex size-36 items-center justify-center rounded-full bg-linear-to-br from-primary-bright to-rose text-white shadow-float transition group-active:scale-95">
          <span aria-hidden="true" className="absolute -inset-3 rounded-full border-2 border-primary/20" />
          <span aria-hidden="true" className="absolute -inset-7 rounded-full border border-primary/10" />
          <Icon name="mic" size={56} />
        </span>
        <span className="pt-4 text-xl font-bold text-primary">{t('homeTalk')}</span>
      </button>

      <Entry icon="chat" title={t('homeAsk')} description={t('homeAskDesc')} onClick={() => go('chat')} />
      <Entry
        icon="shield"
        title={t('homeBenefits')}
        description={t('homeBenefitsDesc')}
        onClick={() => go('benefits')}
      />
      <Entry icon="benefits" tone="accent" title={t('docsTitle')} description={t('homePapersDesc')} onClick={onPapers} />
      <Entry icon="globe" title={t('setLanguage')} description={t('homeLanguageDesc')} onClick={() => go('language')} />
      <Entry icon="phone" tone="danger" title={t('getHelp')} description={t('homeHelpDesc')} onClick={openSos} />
    </section>
  );
}

const SPEED_TEXT: Record<Speed, DictKey> = { slow: 'speedSlow', normal: 'speedNormal', fast: 'speedFast' };

export function SettingsScreen({
  onPrefs,
  onChangeLanguage,
  onClear,
  onShowIntro,
}: {
  onPrefs(patch: Partial<Prefs>): void;
  onChangeLanguage(): void;
  onClear(): void;
  onShowIntro(): void;
}) {
  const { i18n, prefs } = useApp();
  const { t } = i18n;
  const [cleared, setCleared] = useState(false);
  const language = LANGUAGES[i18n.selected];

  return (
    <section aria-labelledby="settings-title" className="flex flex-col gap-4">
      <h1 id="settings-title" className="text-3xl font-bold tracking-tight">
        {t('settingsTitle')}
      </h1>

      <Card>
        <h2 className="text-xl font-bold">{t('setLanguage')}</h2>
        <p className="text-lg">
          <span lang={language.bcp47} dir={language.dir}>
            {language.nativeName}
          </span>{' '}
          <span lang="en" className="text-muted">
            ({language.englishName})
          </span>
        </p>
        <div className="mt-3">
          <Button variant="secondary" icon="globe" onClick={onChangeLanguage}>
            {t('changeLanguage')}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 id="speed-title" className="text-xl font-bold">
          {t('setSpeed')}
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-labelledby="speed-title">
          {SPEEDS.map((speed) => (
            <Button key={speed} size="md" pressed={prefs.speed === speed} onClick={() => onPrefs({ speed })}>
              {t(SPEED_TEXT[speed])}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <h2 id="autoread-title" className="text-xl font-bold">
          {t('setAutoRead')}
        </h2>
        <p id="autoread-hint" className="text-muted">
          {t('setAutoReadHint')}
        </p>
        <div className="mt-3">
          <button
            type="button"
            role="switch"
            aria-checked={prefs.autoRead}
            aria-labelledby="autoread-title"
            aria-describedby="autoread-hint"
            onClick={() => onPrefs({ autoRead: !prefs.autoRead })}
            className={`inline-flex min-h-14 items-center gap-3 rounded-2xl border-2 px-5 font-semibold ${
              prefs.autoRead ? 'border-4 border-primary bg-primary-soft' : 'border-line bg-card'
            }`}
          >
            <Icon name={prefs.autoRead ? 'check' : 'close'} />
            <span>{prefs.autoRead ? t('on') : t('off')}</span>
          </button>
        </div>
      </Card>

      <Card>
        <h2 className="text-xl font-bold">{t('privacyTitle')}</h2>
        <ul className="mt-2 list-disc ps-6">
          <li>{t('privacy1')}</li>
          <li>{t('privacy2')}</li>
          <li>{t('privacy3')}</li>
          <li>{t('privacy4')}</li>
        </ul>
        <div className="mt-4">
          <Button
            variant="danger"
            icon="close"
            onClick={() => {
              onClear();
              setCleared(true);
            }}
          >
            {t('clearSession')}
          </Button>
        </div>
        <p aria-live="polite" className="mt-2 font-semibold">
          {cleared ? t('cleared') : ''}
        </p>
      </Card>

      <Button variant="quiet" icon="hand" onClick={onShowIntro}>
        {t('showIntro')}
      </Button>
    </section>
  );
}

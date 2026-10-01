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

function EntryCard({
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
  const danger = tone === 'danger';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-24 w-full items-center gap-4 rounded-3xl p-4 text-start transition active:translate-y-px ${
        danger
          ? 'border-2 border-danger-strong bg-linear-to-b from-danger to-danger-strong text-white shadow-danger'
          : 'border-2 border-line bg-card shadow-card hover:bg-primary-soft'
      }`}
    >
      <IconBadge name={icon} tone={danger ? 'onDark' : tone} />
      <span className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]">
        <span className="text-xl font-extrabold">{title}</span>
        <span className={danger ? '' : 'text-muted'}>{description}</span>
      </span>
      <Icon name="next" />
    </button>
  );
}

export function HomeScreen({ go }: { go(screen: Screen): void }) {
  const { i18n, openSos } = useApp();
  const { t } = i18n;
  return (
    <section aria-labelledby="home-title" className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-[2rem] bg-linear-to-br from-primary-bright to-primary-strong p-6 text-white shadow-float">
        <span aria-hidden="true" className="absolute -end-10 -top-12 size-44 rounded-full bg-white/10" />
        <span aria-hidden="true" className="absolute end-16 -bottom-14 size-32 rounded-full bg-white/10" />
        <div className="relative flex flex-col gap-4">
          <h1 id="home-title" className="text-3xl leading-tight font-extrabold tracking-tight">
            {t('homeGreeting')}
          </h1>
          <p className="text-lg">{t('homeSub')}</p>
          <button
            type="button"
            onClick={() => go('chat')}
            className="flex min-h-20 w-full items-center gap-4 rounded-3xl border-2 border-white bg-card p-4 text-start text-ink shadow-card transition hover:bg-primary-soft active:translate-y-px"
          >
            <IconBadge name="mic" />
            <span className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]">
              <span className="text-xl font-extrabold">{t('homeAsk')}</span>
              <span className="text-muted">{t('homeAskDesc')}</span>
            </span>
            <Icon name="next" />
          </button>
        </div>
      </div>

      <EntryCard
        icon="benefits"
        tone="accent"
        title={t('homeBenefits')}
        description={t('homeBenefitsDesc')}
        onClick={() => go('benefits')}
      />
      <EntryCard icon="phone" tone="danger" title={t('getHelp')} description={t('homeHelpDesc')} onClick={openSos} />
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
      <h1 id="settings-title" className="text-3xl font-extrabold tracking-tight">
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

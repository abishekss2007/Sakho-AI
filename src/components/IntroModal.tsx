'use client';

import { useState } from 'react';
import type { DictKey } from '@/lib/i18n';
import { useApp } from './AppContext';
import { Button } from './ui/Button';
import { IconBadge, type IconName } from './ui/Icon';
import { Modal } from './ui/Modal';

const STEPS: readonly { icon: IconName; title: DictKey; body: DictKey }[] = [
  { icon: 'hand', title: 'intro1Title', body: 'intro1Body' },
  { icon: 'benefits', title: 'intro2Title', body: 'intro2Body' },
  { icon: 'phone', title: 'intro3Title', body: 'intro3Body' },
];

/** Optional introduction. Emergency help stays reachable from inside the dialog on every step. */
export function IntroModal({ onDone, inert }: { onDone(): void; inert: boolean }) {
  const { i18n, openSos } = useApp();
  const { t } = i18n;
  const [index, setIndex] = useState(0);
  const step = STEPS[index] ?? STEPS[0]!;
  const last = index === STEPS.length - 1;

  return (
    <Modal
      title={t('introTitle')}
      closeLabel={t('skip')}
      onClose={onDone}
      emergency={{ label: t('getHelp'), onOpen: openSos }}
      inert={inert}
    >
      <div className="flex flex-col gap-4">
        <p className="font-semibold text-muted" aria-live="polite">
          {t('introStep', { n: index + 1, total: STEPS.length })}
        </p>
        <div className="relative overflow-hidden rounded-3xl bg-linear-to-br from-primary-bright to-primary-strong p-6 text-white shadow-float">
          <span aria-hidden="true" className="absolute -end-8 -top-10 size-36 rounded-full bg-white/10" />
          <div className="relative flex items-center gap-4">
            <IconBadge name={step.icon} tone="onDark" size="lg" />
            <h3 className="min-w-0 flex-1 text-2xl leading-snug font-extrabold">{t(step.title)}</h3>
          </div>
        </div>
        <div className="flex gap-2" aria-hidden="true">
          {STEPS.map((item, i) => (
            <span key={item.title} className={`h-2 flex-1 rounded-full ${i <= index ? 'bg-primary' : 'bg-line-soft'}`} />
          ))}
        </div>
        <p className="text-lg">{t(step.body)}</p>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="quiet" icon="back" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            {t('back')}
          </Button>
          {last ? (
            <Button icon="check" onClick={onDone}>
              {t('introStart')}
            </Button>
          ) : (
            <Button icon="next" onClick={() => setIndex((i) => Math.min(STEPS.length - 1, i + 1))}>
              {t('next')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

'use client';

import { useState } from 'react';
import { EMERGENCY_SERVICES, type EmergencyServiceId } from '@/lib/emergency';
import type { DictKey } from '@/lib/i18n';
import { useApp } from './AppContext';
import { Button, buttonClass } from './ui/Button';
import { Icon, IconBadge } from './ui/Icon';
import { Modal } from './ui/Modal';
import { Card, Notice } from './ui/Notice';

const SERVICE_TEXT: Record<EmergencyServiceId, { name: DictKey; note: DictKey }> = {
  erss_112: { name: 'svc_erss_112', note: 'svc_erss_112_note' },
  women_181: { name: 'svc_women_181', note: 'svc_women_181_note' },
  child_1098: { name: 'svc_child_1098', note: 'svc_child_1098_note' },
};

/** Places a phone number into a translated sentence without letting RTL text reverse its digits. */
function NumberText({ template, number }: { template: string; number: string }) {
  const [before = '', after = ''] = template.split('{number}');
  return (
    <span className="min-w-0 [overflow-wrap:anywhere]">
      {before}
      <bdi dir="ltr">{number}</bdi>
      {after}
    </span>
  );
}

type LocationState =
  | { status: 'idle' | 'loading' | 'denied' | 'unavailable' }
  | { status: 'found'; latitude: string; longitude: string };

/**
 * Emergency help. Nothing here acts on its own: a call needs a tap on a
 * number (and usually a second confirmation in the dialer), and location is
 * requested only when the user presses its button. Coordinates stay on the
 * screen and are never sent or logged.
 */
export function SosDialog({ onClose }: { onClose(): void }) {
  const { i18n, sosMode } = useApp();
  const { t } = i18n;
  const [demoPressed, setDemoPressed] = useState<string | null>(null);
  const [location, setLocation] = useState<LocationState>({ status: 'idle' });

  const findLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocation({ status: 'unavailable' });
      return;
    }
    setLocation({ status: 'loading' });
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setLocation({
          status: 'found',
          latitude: position.coords.latitude.toFixed(5),
          longitude: position.coords.longitude.toFixed(5),
        }),
      (error) => setLocation({ status: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { timeout: 10_000, maximumAge: 60_000 },
    );
  };

  return (
    <Modal title={t('sosTitle')} closeLabel={t('close')} onClose={onClose} layer="top">
      <div className="flex flex-col gap-4" data-sos-mode={sosMode}>
        {sosMode === 'demo' ? (
          <Notice tone="warning" live={false}>
            <strong>{t('sosDemoBanner')}</strong>
          </Notice>
        ) : (
          <Notice tone="danger" live={false} icon="phone">
            <strong>{t('sosLiveBanner')}</strong>
          </Notice>
        )}

        <p>{t('sosIntro')}</p>

        <ul className="flex flex-col gap-3">
          {EMERGENCY_SERVICES.map((service) => {
            const text = SERVICE_TEXT[service.id];
            return (
              <li key={service.id}>
                <Card>
                  <div className="flex items-start gap-3">
                    <IconBadge name="phone" tone="danger" />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-extrabold">{t(text.name)}</h3>
                      <p className="text-muted">{t(text.note)}</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    {sosMode === 'live' ? (
                      <a href={`tel:${service.number}`} className={buttonClass('danger', 'lg', true)}>
                        <Icon name="phone" />
                        <NumberText template={t('sosCall')} number={service.number} />
                      </a>
                    ) : (
                      // Demo mode renders a plain button: no tel: link exists in the page at all.
                      <Button variant="secondary" icon="phone" block onClick={() => setDemoPressed(service.number)}>
                        <NumberText template={t('sosDemoCall')} number={service.number} />
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>

        <div aria-live="polite">
          {demoPressed && <Notice tone="info">{t('sosDemoPressed', { number: demoPressed })}</Notice>}
        </div>

        <Card>
          <h3 className="text-lg font-bold">{t('locTitle')}</h3>
          <p>{t('locExplain')}</p>
          <div className="mt-3">
            <Button variant="secondary" icon="location" disabled={location.status === 'loading'} onClick={findLocation}>
              {t('locButton')}
            </Button>
          </div>
          <div aria-live="polite" className="mt-3">
            {location.status === 'loading' && <p>{t('locLoading')}</p>}
            {location.status === 'denied' && <p>{t('locDenied')}</p>}
            {location.status === 'unavailable' && <p>{t('locUnavailable')}</p>}
            {location.status === 'found' && (
              <p className="text-xl font-bold">
                {t('locResult')}{' '}
                <bdi dir="ltr">
                  {location.latitude}, {location.longitude}
                </bdi>
              </p>
            )}
          </div>
        </Card>

        <p className="text-muted">{t('sosLimits')}</p>
      </div>
    </Modal>
  );
}

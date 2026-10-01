import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Tone = 'info' | 'warning' | 'danger';

const TONES: Record<Tone, { box: string; icon: IconName }> = {
  info: { box: 'bg-primary-soft border-primary text-ink', icon: 'speaker' },
  warning: { box: 'bg-accent-soft border-accent text-ink', icon: 'alert' },
  danger: { box: 'bg-danger-soft border-danger text-ink', icon: 'alert' },
};

/**
 * Status message. `role="status"` announces politely; `danger` uses
 * `role="alert"` so failures are announced straight away.
 */
export function Notice({
  tone = 'info',
  icon,
  children,
  live = true,
}: {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
  live?: boolean;
}) {
  const config = TONES[tone];
  return (
    <div
      role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}
      className={`flex items-start gap-3 rounded-3xl border-2 p-4 shadow-card ${config.box}`}
    >
      <Icon name={icon ?? config.icon} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-line-soft bg-card p-5 shadow-card ${className}`}>{children}</div>;
}

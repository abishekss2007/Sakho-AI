const PATHS = {
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm6-3a6 6 0 0 1-12 0M12 18v3',
  send: 'M4 12 20 4l-4 16-4-7-8-1Zm8 1 8-9',
  speaker: 'M4 10v4h4l5 4V6L8 10H4Zm12-1a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12',
  stop: 'M7 7h10v10H7z',
  home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z',
  chat: 'M4 5h16v11H9l-5 4V5Z',
  benefits: 'M7 3h8l4 4v14H7V3Zm8 0v4h4M10 12h6M10 16h6',
  settings: 'M5 7h9m4 0h1M5 12h2m4 0h8M5 17h11m4 0h-1M14 5v4M9 10v4M18 15v4',
  phone: 'M6 3h4l1 5-2 1a12 12 0 0 0 6 6l1-2 5 1v4a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2Z',
  alert: 'M12 4 2 20h20L12 4Zm0 6v5m0 2.5v.5',
  check: 'm5 12 5 5 9-10',
  back: 'M14 6 8 12l6 6',
  next: 'm10 6 6 6-6 6',
  close: 'M6 6l12 12M18 6 6 18',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  hand: 'M9 11V5a1.5 1.5 0 0 1 3 0v5m0-1V4.5a1.5 1.5 0 0 1 3 0V10m0-3a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7c-3 0-4-1-6-4l-2-4a1.5 1.5 0 0 1 2.6-1.5L9 14',
  location: 'M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.800 7 11 7 11Zm0-8.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5Z',
  question: 'M9.500 9.200a2.600 2.600 0 1 1 3.700 2.400c-.800.400-1.200 1-1.200 1.900M12 17v.400M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  sparkle: 'M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800L12 3Z',
  shield: 'M12 3 5 6v6c0 4.500 3 7.500 7 9 4-1.500 7-4.500 7-9V6l-7-3Zm-3 9 2.200 2.200L15.500 10',
  refresh: 'M5 12a7 7 0 0 1 12-5l2 2m0-5v5h-5m5 3a7 7 0 0 1-12 5l-2-2m0 5v-5h5',
} as const;

export type IconName = keyof typeof PATHS;

/** The Sakho mark: a speech bubble with a friendly face. Decorative. */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 64 64" className="shrink-0">
      <defs>
        <linearGradient id="sakho-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-primary-bright)" />
          <stop offset="1" stopColor="var(--color-rose)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="20" fill="url(#sakho-mark)" />
      <path d="M16 20h32v20H30l-10 8v-8h-4z" fill="#fff" />
      <circle cx="26" cy="30" r="3" fill="var(--color-primary)" />
      <circle cx="38" cy="30" r="3" fill="var(--color-primary)" />
    </svg>
  );
}

const BADGE_TONES = {
  primary: 'bg-primary-soft text-primary',
  accent: 'bg-accent-soft text-accent',
  danger: 'bg-danger text-white',
  onDark: 'bg-white/20 text-white',
} as const;

/** Icon inside a soft rounded tile: gives a card a clear visual anchor. Decorative. */
export function IconBadge({
  name,
  tone = 'primary',
  size = 'md',
}: {
  name: IconName;
  tone?: keyof typeof BADGE_TONES;
  size?: 'md' | 'lg';
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-2xl ${size === 'lg' ? 'size-16' : 'size-12'} ${BADGE_TONES[tone]}`}
    >
      <Icon name={name} size={size === 'lg' ? 34 : 26} />
    </span>
  );
}

/** Decorative icon. Always paired with visible text, so it is hidden from screen readers. */
export function Icon({ name, size = 28 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${name === 'next' || name === 'back' ? 'rtl:-scale-x-100' : ''}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

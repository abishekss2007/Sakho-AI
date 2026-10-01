import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'danger' | 'quiet';

const BASE =
  'inline-flex max-w-full items-center gap-3 rounded-2xl px-5 py-3 text-start font-semibold ' +
  'border-2 transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-linear-to-b from-primary-bright to-primary text-white border-primary shadow-float hover:from-primary hover:to-primary-strong',
  secondary: 'bg-card text-primary border-primary shadow-card hover:bg-primary-soft',
  danger:
    'bg-linear-to-b from-danger to-danger-strong text-white border-danger-strong shadow-danger hover:from-danger-strong',
  quiet: 'bg-card text-ink border-line hover:bg-primary-soft',
};

/** Selected state for toggle-style buttons; shape and a check mark carry it, not colour alone. */
const PRESSED = 'bg-primary-soft text-ink border-primary border-4 shadow-card';

export function buttonClass(
  variant: Variant = 'primary',
  size: 'lg' | 'md' = 'lg',
  block = false,
  align: 'center' | 'start' = 'center',
): string {
  return [
    BASE,
    VARIANTS[variant],
    size === 'lg' ? 'min-h-14 text-lg' : 'min-h-12',
    block ? 'w-full' : '',
    align === 'start' ? 'justify-start' : 'justify-center',
  ]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'lg' | 'md';
  icon?: IconName;
  block?: boolean;
  align?: 'center' | 'start';
  /** Renders as a toggle with `aria-pressed`. */
  pressed?: boolean;
  children: ReactNode;
}

/** The one button used across the app: large target, icon always paired with visible text. */
export function Button({
  variant = 'primary',
  size = 'lg',
  icon,
  block = false,
  align = 'center',
  pressed,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isToggle = pressed !== undefined;
  const classes = [buttonClass(isToggle ? 'quiet' : variant, size, block, align), pressed ? PRESSED : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} aria-pressed={isToggle ? pressed : undefined} {...rest}>
      {pressed ? <Icon name="check" /> : icon ? <Icon name={icon} /> : null}
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </button>
  );
}

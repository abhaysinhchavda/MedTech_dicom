import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'quiet' | 'ghost';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink border-accent hover:bg-accent-hi hover:border-accent-hi',
  quiet: 'bg-raised text-ink border-line hover:border-line-strong hover:bg-line',
  ghost: 'bg-transparent text-muted border-transparent hover:text-ink hover:bg-raised',
};

export function Button({
  active,
  variant = 'quiet',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; variant?: ButtonVariant }) {
  // `active` is a toggle state, not a separate variant: an engaged toggle
  // reads as the accent regardless of which variant it started from.
  const tone = active
    ? 'bg-accent-dim text-ink border-accent shadow-[inset_0_0_0_1px_var(--color-accent)]'
    : VARIANTS[variant];
  return (
    <button
      {...rest}
      aria-pressed={active}
      className={`press inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-sm leading-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${tone} ${className}`}
    />
  );
}

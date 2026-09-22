import type { ButtonHTMLAttributes } from 'react';
export function Button({
  active,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  const tone = active
    ? 'bg-sky-600 border-sky-400'
    : 'bg-neutral-800 border-neutral-700 hover:bg-neutral-700';
  return (
    <button
      {...rest}
      className={`rounded px-3 py-1 text-sm border disabled:opacity-40 ${tone} ${className}`}
    />
  );
}

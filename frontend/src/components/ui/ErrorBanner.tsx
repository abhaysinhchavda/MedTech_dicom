import { WarningOctagon } from '@phosphor-icons/react';
import { Button } from './Button';

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-surface border border-danger/40 bg-danger/10 p-3 text-sm text-ink"
    >
      <WarningOctagon aria-hidden className="mt-px shrink-0 text-danger" size={18} />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onRetry && (
        <Button variant="quiet" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

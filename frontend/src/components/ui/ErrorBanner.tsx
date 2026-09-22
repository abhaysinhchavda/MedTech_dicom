import { Button } from './Button';
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="m-4 rounded border border-red-700 bg-red-950 p-3 text-red-200 flex items-center gap-3"
    >
      <span>{message}</span>
      {onRetry && <Button onClick={onRetry}>Retry</Button>}
    </div>
  );
}

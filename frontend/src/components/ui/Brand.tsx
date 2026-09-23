import { Brain } from '@phosphor-icons/react';

/* The product name is unchanged; only its setting is. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <Brain aria-hidden size={compact ? 20 : 22} weight="duotone" className="text-accent" />
      <span className="text-[15px] font-semibold tracking-tight">
        DICOM 3D <span className="font-normal text-muted">Brain Viewer</span>
      </span>
    </span>
  );
}

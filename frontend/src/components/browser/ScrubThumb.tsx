import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type PointerEvent } from 'react';
import { getInstances, thumbnailUrl } from '../../api/dicomweb';

const SAMPLES = 14;

/*
 * Hovering a series card scrubs through it. The card fetches the series'
 * instance list the first time the pointer enters, samples a fixed number of
 * slices across the stack, and maps the pointer's horizontal position onto
 * that sample. It is the cheapest honest preview of a volume: a single
 * thumbnail cannot show whether a series covers the whole head or four
 * slices, and the scrub answers that before the volume is ever loaded.
 */
export function ScrubThumb({
  studyUid,
  seriesUid,
  thumbSopUid,
  size = 176,
}: {
  studyUid: string;
  seriesUid: string;
  thumbSopUid?: string;
  size?: number;
}) {
  const [armed, setArmed] = useState(false);
  const [pos, setPos] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const q = useQuery({
    queryKey: ['instances', seriesUid],
    queryFn: () => getInstances(studyUid, seriesUid),
    enabled: armed,
    staleTime: Infinity,
  });

  const all = q.data ?? [];
  const step = all.length > SAMPLES ? (all.length - 1) / (SAMPLES - 1) : 1;
  const frames =
    all.length > SAMPLES
      ? Array.from({ length: SAMPLES }, (_, i) => all[Math.round(i * step)]!)
      : all;

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!el || frames.length < 2) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width));
    setPos(Math.floor(f * frames.length));
  };

  const shown = pos !== null && frames[pos] ? frames[pos].sopUid : thumbSopUid;

  return (
    <div
      ref={box}
      onPointerEnter={() => setArmed(true)}
      onPointerMove={onMove}
      onPointerLeave={() => setPos(null)}
      className="relative aspect-square w-full bg-void"
    >
      {/* Every sampled slice is mounted at once and revealed by opacity, so
          scrubbing never waits on a network round trip after the first pass. */}
      {armed &&
        frames.map((f) => (
          <img
            key={f.sopUid}
            alt=""
            draggable={false}
            src={thumbnailUrl(studyUid, seriesUid, f.sopUid, size)}
            className="absolute inset-0 h-full w-full object-contain"
            style={{ opacity: shown === f.sopUid ? 1 : 0 }}
          />
        ))}
      {thumbSopUid && (
        <img
          alt=""
          draggable={false}
          loading="lazy"
          src={thumbnailUrl(studyUid, seriesUid, thumbSopUid, size)}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ opacity: pos === null ? 1 : 0 }}
        />
      )}
      {pos !== null && frames.length > 1 && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-line">
          <div
            className="h-full bg-accent"
            style={{ width: `${((pos + 1) / frames.length) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

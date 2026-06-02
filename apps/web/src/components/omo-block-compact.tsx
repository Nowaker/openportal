import type { OmoSegment } from "@/lib/omo-injection";

interface Props {
  header: string;
  summary?: string;
  segments?: OmoSegment[];
}

export function OmoBlockCompact({ header, summary, segments }: Props) {
  const items =
    segments && segments.length > 1
      ? segments.map((s, i) => ({ header: s.header, summary: s.summary, key: i }))
      : [{ header, summary, key: 0 }];
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {items.map((it) => (
        <span
          key={it.key}
          className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/30 px-1 py-0.5"
        >
          <span className="font-mono text-[10px] leading-tight">{it.header}</span>
          {it.summary && (
            <span className="text-muted-fg/70 text-[10px] leading-tight">
              {it.summary}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

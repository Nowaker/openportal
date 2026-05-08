import { useMemo } from "react";
import { minidenticon } from "minidenticons";

// Wrapper around `minidenticons` (639B gzip, MIT). The `seed` is the
// canonical project path (output of resolveProjectPath) so two sessions
// in the same directory render the same little 5x5 mosaic - giving each
// project a stable visual fingerprint in the rail layout.
//
// 95 = saturation, 45 = lightness; chosen to keep the palette muted
// enough to coexist with our muted sidebar surfaces but distinct enough
// to be hash-disambiguated at a 32-48px size.
export function ProjectIdenticon({
  seed,
  size = 32,
  className,
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const src = useMemo(
    () =>
      "data:image/svg+xml;utf8," + encodeURIComponent(minidenticon(seed, 95, 45)),
    [seed],
  );
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}

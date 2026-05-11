import type { DateFormat } from "@/stores/date-format-store";

// Compact message timestamp:
//   today           -> "2:23pm" / "14:23"
//   any other day   -> "4/3, 2:23pm" / "4/3, 14:23"
// The 12h variant strips the locale-default space ("2:23 PM" -> "2:23pm")
// so the badge stays compact in the floating right-side gutter.
export function formatMessageTime(ms: number, format: DateFormat): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const time =
    format === "12h"
      ? d
          .toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })
          .replace(/\s/g, "")
          .toLowerCase()
      : d.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });

  if (sameDay) return time;
  const date = `${d.getMonth() + 1}/${d.getDate()}`;
  return `${date}, ${time}`;
}

// Relative time for tooltips: "3 minutes ago", "yesterday", "2 days ago".
// Reads from now() at call time so consumers don't need to subscribe to a
// ticking clock - the tooltip is built fresh on hover, so a stale value is
// at most stale by the time between renders, which is fine for absolute-
// human-eye precision (nobody hovers long enough to notice 1m-vs-2m drift).
export function formatRelativeTime(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const future = diff < 0;
  const abs = Math.abs(diff);
  const sec = Math.round(abs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  const pluralize = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"}`;
  let out: string;
  if (sec < 5) out = "just now";
  else if (sec < 60) out = pluralize(sec, "second");
  else if (min < 60) out = pluralize(min, "minute");
  else if (hr < 24) out = pluralize(hr, "hour");
  else if (day < 30) out = pluralize(day, "day");
  else if (day < 365) out = pluralize(Math.round(day / 30), "month");
  else out = pluralize(Math.round(day / 365), "year");
  if (sec < 5) return out;
  return future ? `in ${out}` : `${out} ago`;
}

// Combined tooltip: "<absolute toLocaleString> - <relative>". Used for
// title= attributes on inline timestamps so a hover surfaces both the
// precise moment and the human-friendly relative phrasing.
export function formatAbsoluteAndRelative(ms: number | undefined): string | undefined {
  if (!ms || !Number.isFinite(ms)) return undefined;
  return `${new Date(ms).toLocaleString()} - ${formatRelativeTime(ms)}`;
}

import type { DateFormat } from "@/stores/date-format-store";

// Compact message timestamp:
//   today                   -> "2:23pm" / "14:23"
//   same year, other day    -> "4/3, 2:23pm" / "4/3, 14:23"
//   different year (past)   -> "4/3/2024, 2:23pm" / "4/3/2024, 14:23"
// The 12h variant strips the locale-default space ("2:23 PM" -> "2:23pm")
// so the badge stays compact in the floating right-side gutter. YYYY only
// appears when the message is from a previous year so the current-year
// stream stays terse.
export function formatMessageTime(ms: number, format: DateFormat): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const sameYear = d.getFullYear() === now.getFullYear();

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
      : format === "24h"
        ? d.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : d
            .toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })
            .replace(/\s+/g, " ");

  if (sameDay) return time;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const date = sameYear ? `${month}/${day}` : `${month}/${day}/${d.getFullYear()}`;
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

// Compact duration formatter, max two units of granularity from the
// largest non-zero unit downward. Examples:
//   45_000           -> "45s"
//   65_000           -> "1m 5s"
//   300_000          -> "5m"
//   3_900_000        -> "1h 5m"   (NO seconds once an hour is present)
//   90_000_000       -> "1d 1h"   (NO minutes once a day is present)
//   500              -> "<1s"     (sub-second processing)
//   0 / negative     -> "0s"
// Used by the message-meta line under final assistant responses to show
// the wall-clock time the AI spent on the turn.
export function formatDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec === 0) return "<1s";
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

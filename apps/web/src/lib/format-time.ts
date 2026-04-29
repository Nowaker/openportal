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

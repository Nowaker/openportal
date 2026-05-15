import { useTheme } from "@/providers/theme-provider";
import { type AccentColor } from "@/stores/accent-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";

const ACCENT_COLORS: { id: AccentColor; name: string; color: string }[] = [
  { id: "blue", name: "Blue", color: "oklch(0.546 0.245 262.881)" },
  { id: "zinc", name: "Zinc", color: "oklch(0.141 0.005 285.823)" },
  { id: "red", name: "Red", color: "oklch(0.577 0.245 27.325)" },
  { id: "orange", name: "Orange", color: "oklch(0.705 0.213 47.604)" },
  { id: "amber", name: "Amber", color: "oklch(0.828 0.189 84.429)" },
  { id: "yellow", name: "Yellow", color: "oklch(0.905 0.182 98.111)" },
  { id: "lime", name: "Lime", color: "oklch(0.897 0.196 126.665)" },
  { id: "green", name: "Green", color: "oklch(0.627 0.194 149.214)" },
  { id: "emerald", name: "Emerald", color: "oklch(0.596 0.145 163.225)" },
  { id: "custom", name: "Custom", color: "transparent" },
];

function ColorSwatch({ color, slot }: { color: string; slot?: boolean }) {
  return (
    <span
      data-slot={slot ? "icon" : undefined}
      className="inline-block size-4 rounded-sm inset-ring inset-ring-fg/15 dark:inset-ring-fg/5"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

export function AccentSelector() {
  const { accentColor, setAccentColor } = useTheme();
  
  const isCustom = accentColor.startsWith("#");
  const selectValue = isCustom ? "custom" : accentColor;
  
  const currentAccent = isCustom 
    ? { id: "custom", name: "Custom", color: accentColor }
    : ACCENT_COLORS.find((c) => c.id === accentColor);

  const [customHex, setCustomHex] = useState(isCustom ? accentColor : "#3b82f6");

  useEffect(() => {
    if (isCustom) {
      setCustomHex(accentColor);
    }
  }, [accentColor, isCustom]);

  const handleCustomChange = (hex: string) => {
    setCustomHex(hex);
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      setAccentColor(hex);
    }
  };

  return (
    <div className="space-y-3">
      <Select
        value={selectValue}
        onChange={(val) => {
          if (!val) return;
          if (val === "custom") {
            setAccentColor(customHex);
          } else {
            setAccentColor(val as AccentColor);
          }
        }}
      >
        <SelectTrigger
          className="max-w-sm capitalize"
          aria-label="Select accent color"
        >
          <span className="flex items-center gap-2">
            {currentAccent && <ColorSwatch color={currentAccent.color} />}
            <span className="truncate">{currentAccent?.name}</span>
          </span>
        </SelectTrigger>
        <SelectContent items={ACCENT_COLORS}>
          {(item) => (
            <SelectItem id={item.id} textValue={item.name} className="capitalize">
              {item.id !== "custom" && <ColorSwatch color={item.color} slot />}
              <SelectLabel>{item.name}</SelectLabel>
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      {isCustom && (
        <div className="flex max-w-sm items-center gap-2">
          <Input
            value={customHex}
            onChange={(e) => handleCustomChange(e.target.value)}
            placeholder="#rrggbb"
            className="font-mono"
            maxLength={7}
          />
          <div className="relative size-9 shrink-0 overflow-hidden rounded-md border border-border">
            <input
              type="color"
              value={customHex}
              onChange={(e) => handleCustomChange(e.target.value)}
              className="absolute -inset-2 size-14 cursor-pointer"
              aria-label="Choose custom color"
            />
          </div>
        </div>
      )}
    </div>
  );
}

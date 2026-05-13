import {
  BoltIcon,
  BoltSlashIcon,
  ChevronUpDownIcon,
  FireIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { FireIcon as FireIconSolid } from "@heroicons/react/24/solid";
import { Menu, MenuContent, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { useProviders } from "@/hooks/use-opencode";
import { useThinkingStore } from "@/stores/thinking-store";
import { useModelStore } from "@/stores/model-store";
import { useInstanceStore } from "@/stores/instance-store";

interface ThinkingSelectProps {
  sessionId: string | null;
}

const KNOWN_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

export function variantIcon(variant: string, size = "size-4") {
  if (!variant) return <BoltSlashIcon className={`${size} text-muted-fg/60`} />;
  const v = variant.toLowerCase();
  if (v === "low") return <BoltIcon className={`${size} text-fg/60`} />;
  if (v === "medium") return <BoltIcon className={`${size} text-fg`} />;
  if (v === "high") return <FireIcon className={`${size} text-fg`} />;
  if (v === "max" || v === "xhigh")
    return <FireIconSolid className={`${size} text-fg`} />;
  return <SparklesIcon className={`${size} text-fg`} />;
}

export function variantDisplayLabel(variant: string) {
  if (!variant) return "Default";
  return variant.charAt(0).toUpperCase() + variant.slice(1);
}

interface RawProvider {
  id: string;
  models?: Record<
    string,
    { id: string; variants?: Record<string, unknown> }
  >;
}

// Renders as a Menu-backed Button that visually mirrors the
// SelectTrigger pattern used by AgentSelect and ModelSelect: icon +
// label + chevron, same border, same hover, same size. Stays under
// Menu (not Select) so it doesn't pull in SelectTrigger's `w-full`
// cascade that would blow out the bar width.
export function ThinkingSelect({ sessionId }: ThinkingSelectProps) {
  const { data: providersData } = useProviders();
  const instance = useInstanceStore((s) => s.instance);
  const instanceId = instance?.id ?? null;
  const resolveModel = useModelStore((s) => s.resolveModel);
  const model = resolveModel(sessionId, instanceId);

  const variants = ((): string[] => {
    const raw = (providersData ?? null) as
      | { providers?: RawProvider[] }
      | null;
    const provider = raw?.providers?.find((p) => p.id === model.providerID);
    const m = provider?.models?.[model.modelID];
    const keys = Object.keys(m?.variants ?? {});
    return keys.sort((a, b) => {
      const ai = KNOWN_ORDER.indexOf(a as (typeof KNOWN_ORDER)[number]);
      const bi = KNOWN_ORDER.indexOf(b as (typeof KNOWN_ORDER)[number]);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  })();

  const current = useThinkingStore((s) => s.resolve(sessionId));
  const setForSession = useThinkingStore((s) => s.setForSession);

  if (variants.length === 0) return null;

  return (
    <Menu>
      <Button
        intent="outline"
        aria-label={`Thinking effort: ${variantDisplayLabel(current)}`}
        data-slot="control"
        className="shrink-0 min-h-0 rounded-lg border border-input gap-x-1 sm:gap-x-2 [&_svg]:!size-4"
      >
        {variantIcon(current, "")}
        <span className="hidden sm:inline">{variantDisplayLabel(current)}</span>
        <ChevronUpDownIcon className="hidden sm:inline-block -mr-1 text-muted-fg" />
      </Button>
      <MenuContent placement="bottom end" className="min-w-32">
        <MenuItem
          onAction={() => {
            if (sessionId) setForSession(sessionId, "");
          }}
        >
          <span className="flex items-center gap-2">
            {variantIcon("", "size-4")}
            <span>Default</span>
          </span>
        </MenuItem>
        {variants.map((v) => (
          <MenuItem
            key={v}
            onAction={() => {
              if (sessionId) setForSession(sessionId, v);
            }}
          >
            <span className="flex items-center gap-2">
              {variantIcon(v, "size-4")}
              <span>{variantDisplayLabel(v)}</span>
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

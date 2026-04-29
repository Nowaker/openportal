import {
  BoltIcon,
  BoltSlashIcon,
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

// Uses Menu (not Select) so the trigger is a plain Button without
// SelectTrigger's `w-full` cascade that was blowing out the picker bar
// width and crowding the Agent/Model dropdowns to invisibility.
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
        size="xs"
        aria-label={`Thinking effort: ${variantDisplayLabel(current)}`}
        data-slot="control"
        className="shrink-0 min-h-0 py-[calc(--spacing(1.5)-1px)] text-sm/6 px-2 [&_svg]:!size-4"
      >
        {variantIcon(current, "size-4")}
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

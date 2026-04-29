import {
  BoltIcon,
  BoltSlashIcon,
  FireIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import { useProviders } from "@/hooks/use-opencode";
import { useThinkingStore } from "@/stores/thinking-store";
import { useModelStore } from "@/stores/model-store";
import { useInstanceStore } from "@/stores/instance-store";

interface ThinkingSelectProps {
  sessionId: string | null;
}

const KNOWN_ORDER = ["low", "medium", "high", "max"] as const;

function variantIcon(variant: string, size = "size-4") {
  if (!variant) return <BoltSlashIcon className={`${size} text-muted-fg/60`} />;
  const v = variant.toLowerCase();
  if (v === "low") return <BoltIcon className={`${size} text-fg/60`} />;
  if (v === "medium") return <BoltIcon className={`${size} text-fg`} />;
  if (v === "high") return <FireIcon className={`${size} text-amber-500`} />;
  if (v === "max")
    return <FireIcon className={`${size} text-red-500 animate-pulse`} />;
  return <SparklesIcon className={`${size} text-fg`} />;
}

function variantLabel(variant: string) {
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
    <Select
      aria-label="Thinking effort"
      selectedKey={current || "default"}
      onSelectionChange={(key) => {
        if (!sessionId) return;
        const v = String(key);
        setForSession(sessionId, v === "default" ? "" : v);
      }}
    >
      <SelectTrigger className="shrink-0 w-9 h-7 px-1 justify-center">
        <span className="flex items-center justify-center">
          {variantIcon(current, "size-4")}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem id="default" textValue="Default">
          <span className="flex items-center gap-2">
            {variantIcon("", "size-4")}
            <SelectLabel>Default</SelectLabel>
          </span>
        </SelectItem>
        {variants.map((v) => (
          <SelectItem key={v} id={v} textValue={variantLabel(v)}>
            <span className="flex items-center gap-2">
              {variantIcon(v, "size-4")}
              <SelectLabel>{variantLabel(v)}</SelectLabel>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

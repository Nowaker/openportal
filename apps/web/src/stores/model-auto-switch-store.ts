import useSWR, { mutate as globalMutate } from "swr";

const KEY = "/api/model-auto-switch";

export type Rule =
  | "agent-default"
  | "specific"
  | "family-latest"
  | "previously-used-session"
  | "previously-used-global"
  | "no-change";

export interface AgentPref {
  modelRule: Rule;
  modelKey?: string;
  modelFamilyKey?: string;
  variantRule: Rule;
  variant?: string;
}

export interface ModelAutoSwitchConfig {
  enabled: boolean;
  perAgent: Record<string, AgentPref>;
}

export const EMPTY_CONFIG: ModelAutoSwitchConfig = {
  enabled: true,
  perAgent: {},
};

async function fetcher(url: string): Promise<ModelAutoSwitchConfig> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`model-auto-switch fetch failed: ${r.status}`);
  const raw = (await r.json()) as Partial<ModelAutoSwitchConfig>;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    perAgent:
      raw.perAgent && typeof raw.perAgent === "object" ? raw.perAgent : {},
  };
}

export function useModelAutoSwitchConfig(): {
  config: ModelAutoSwitchConfig;
  isLoading: boolean;
  error: Error | undefined;
} {
  const { data, isLoading, error } = useSWR<ModelAutoSwitchConfig>(
    KEY,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 2000, keepPreviousData: true },
  );
  return {
    config: data ?? EMPTY_CONFIG,
    isLoading: isLoading && !data,
    error: error as Error | undefined,
  };
}

// Family name = part of the OMO agent name before " - ". Non-OMO
// agents pass their full name through. The user explicitly wants
// the saved preference to follow OMO renames (Sisyphus - ultraworker
// -> Sisyphus - workhorse keeps the same Sisyphus preference).
export function familyName(agentName: string): string {
  if (!agentName) return agentName;
  const idx = agentName.indexOf(" - ");
  if (idx <= 0) return agentName;
  return agentName.slice(0, idx).trim();
}

export function getAgentPref(
  config: ModelAutoSwitchConfig,
  agentName: string,
): AgentPref {
  const fam = familyName(agentName);
  return (
    config.perAgent[fam] ?? {
      modelRule: "agent-default",
      variantRule: "agent-default",
    }
  );
}

async function pushConfig(next: ModelAutoSwitchConfig): Promise<void> {
  await globalMutate(KEY, next, { revalidate: false });
}

export async function setEnabled(value: boolean): Promise<void> {
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: value }),
  });
  if (!r.ok) throw new Error(`setEnabled failed: ${r.status}`);
  await pushConfig((await r.json()) as ModelAutoSwitchConfig);
}

export async function setAgentPref(
  agentName: string,
  pref: Partial<AgentPref>,
): Promise<void> {
  const fam = familyName(agentName);
  if (!fam) return;
  const body: Record<string, unknown> = { family: fam };
  if (pref.modelRule !== undefined) body.modelRule = pref.modelRule;
  if (pref.modelKey !== undefined) body.modelKey = pref.modelKey;
  if (pref.modelFamilyKey !== undefined) body.modelFamilyKey = pref.modelFamilyKey;
  if (pref.variantRule !== undefined) body.variantRule = pref.variantRule;
  if (pref.variant !== undefined) body.variant = pref.variant;
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`setAgentPref failed: ${r.status}`);
  await pushConfig((await r.json()) as ModelAutoSwitchConfig);
}

export async function removeAgentPref(agentName: string): Promise<void> {
  const fam = familyName(agentName);
  if (!fam) return;
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ family: fam, remove: true }),
  });
  if (!r.ok) throw new Error(`removeAgentPref failed: ${r.status}`);
  await pushConfig((await r.json()) as ModelAutoSwitchConfig);
}

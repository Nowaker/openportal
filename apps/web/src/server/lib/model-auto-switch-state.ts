import { getSettings, setSetting } from "./portal-state";

const NAMESPACE = "modelAutoSwitch";

// Three-way rule per dimension (model / variant), matches the user's
// settings matrix spec. "agent-default" is the current behaviour:
// when the agent is picked, copy agent.model / agent.variant from
// opencode's /agent response. "specific" pins an explicit value
// (modelKey / variant) regardless of what the agent says.
// "no-change" leaves the current model / variant alone.
export type Rule =
  | "agent-default"
  | "specific"
  | "previously-used-session"
  | "previously-used-global"
  | "no-change";

export interface AgentPref {
  modelRule: Rule;
  modelKey?: string;
  variantRule: Rule;
  variant?: string;
}

export interface ModelAutoSwitchConfig {
  // Master switch. When false, nothing auto-switches regardless of
  // per-agent rules — agent-select reverts to a no-op on agent pick.
  enabled: boolean;
  // Keyed by AGENT FAMILY NAME (the part before " - " — see
  // shortenOmoAgentName in lib/agent-name.ts). OMO sometimes renames
  // the mode suffix (Sisyphus - ultraworker -> Sisyphus - workhorse)
  // and we want the user's saved preference to follow that rename.
  perAgent: Record<string, AgentPref>;
}

const DEFAULTS: ModelAutoSwitchConfig = {
  enabled: true,
  perAgent: {},
};

const RULE_VALUES: Rule[] = [
  "agent-default",
  "specific",
  "previously-used-session",
  "previously-used-global",
  "no-change",
];

function isRule(value: unknown): value is Rule {
  return typeof value === "string" && RULE_VALUES.includes(value as Rule);
}

function validatePref(raw: unknown): AgentPref {
  const out: AgentPref = { modelRule: "agent-default", variantRule: "agent-default" };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Partial<AgentPref>;
  if (isRule(r.modelRule)) out.modelRule = r.modelRule;
  if (typeof r.modelKey === "string" && r.modelKey) out.modelKey = r.modelKey;
  if (isRule(r.variantRule)) out.variantRule = r.variantRule;
  if (typeof r.variant === "string") out.variant = r.variant;
  return out;
}

function readConfig(): ModelAutoSwitchConfig {
  const raw = getSettings()[NAMESPACE];
  if (!raw || typeof raw !== "object") return { ...DEFAULTS, perAgent: {} };
  const obj = raw as Partial<ModelAutoSwitchConfig>;
  const perAgent: Record<string, AgentPref> = {};
  if (obj.perAgent && typeof obj.perAgent === "object") {
    for (const [k, v] of Object.entries(obj.perAgent)) {
      if (typeof k === "string" && k) perAgent[k] = validatePref(v);
    }
  }
  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : DEFAULTS.enabled,
    perAgent,
  };
}

function writeConfig(config: ModelAutoSwitchConfig): ModelAutoSwitchConfig {
  setSetting(NAMESPACE, config);
  return config;
}

export function getModelAutoSwitchConfig(): ModelAutoSwitchConfig {
  return readConfig();
}

export function setEnabled(value: boolean): ModelAutoSwitchConfig {
  const config = readConfig();
  config.enabled = !!value;
  return writeConfig(config);
}

export function setAgentPref(
  family: string,
  pref: Partial<AgentPref>,
): ModelAutoSwitchConfig {
  if (!family) return readConfig();
  const config = readConfig();
  const current = config.perAgent[family] ?? {
    modelRule: "agent-default" as Rule,
    variantRule: "agent-default" as Rule,
  };
  config.perAgent[family] = validatePref({ ...current, ...pref });
  // If a rule reverts to "agent-default" and there's no specific data,
  // drop the entry entirely to keep the persisted JSON small and
  // make "follow opencode's defaults" the same as "no pref saved".
  const p = config.perAgent[family];
  const dropModel =
    p.modelRule === "agent-default" && !p.modelKey;
  const dropVariant =
    p.variantRule === "agent-default" && p.variant === undefined;
  if (dropModel && dropVariant) {
    delete config.perAgent[family];
  }
  return writeConfig(config);
}

export function removeAgentPref(family: string): ModelAutoSwitchConfig {
  const config = readConfig();
  delete config.perAgent[family];
  return writeConfig(config);
}

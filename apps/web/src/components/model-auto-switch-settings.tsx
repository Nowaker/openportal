import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { ModelPickerContent } from "@/components/model-picker-content";
import { Loader } from "@/components/ui/loader";
import { useAgents, useProviders } from "@/hooks/use-opencode";
import {
  type AgentPref,
  type ModelAutoSwitchConfig,
  type Rule,
  familyName,
  getAgentPref,
  removeAgentPref,
  setAgentPref,
  setEnabled,
  useModelAutoSwitchConfig,
} from "@/stores/model-auto-switch-store";
import { shortenModelName } from "@/lib/model-name";
import { variantsForModel } from "@/lib/variant-fallback";
import { compareModelVersion, groupByFamily, parseModelId } from "@/lib/model-version";

interface AgentRow {
  family: string;
  representative: {
    name: string;
    model?: { providerID?: string; modelID?: string } | null;
    variant?: string | null;
  };
}

function dedupeAgents(
  agents: ReadonlyArray<{
    name: string;
    model?: { providerID?: string; modelID?: string } | null;
    variant?: string | null;
  }>,
): AgentRow[] {
  const map = new Map<string, AgentRow>();
  for (const a of agents) {
    const fam = familyName(a.name);
    if (!map.has(fam)) map.set(fam, { family: fam, representative: a });
  }
  return Array.from(map.values()).sort((a, b) =>
    a.family.localeCompare(b.family),
  );
}

function isOmo(name: string): boolean {
  return name.includes(" - ");
}

export function ModelAutoSwitchSettings() {
  const { config, isLoading } = useModelAutoSwitchConfig();
  const { data: agentsData } = useAgents();
  const { data: providersData } = useProviders();

  const allAgents = (agentsData ?? []) as AgentRow["representative"][];
  const omoFamilies = useMemo(
    () => dedupeAgents(allAgents.filter((a) => isOmo(a.name))),
    [allAgents],
  );

  return (
    <div className="space-y-4">
      <MasterSwitch enabled={config.enabled} />
      {isLoading && omoFamilies.length === 0 ? (
        <div className="flex items-center justify-center py-4">
          <Loader className="size-5" />
        </div>
      ) : omoFamilies.length === 0 ? (
        <p className="text-xs text-muted-fg">No OMO agents found.</p>
      ) : (
        <div className="space-y-3">
          {omoFamilies.map((row) => (
            <AgentRowEditor
              key={row.family}
              row={row}
              config={config}
              providersData={providersData}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MasterSwitch({ enabled }: { enabled: boolean }) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        isSelected={enabled}
        isDisabled={saving}
        onChange={async (next) => {
          setSaving(true);
          try {
            await setEnabled(next);
          } finally {
            setSaving(false);
          }
        }}
      >
        Enable model + variant auto-switch on agent change
      </Checkbox>
      {saving && <Loader className="size-3" />}
    </div>
  );
}

function AgentRowEditor({
  row,
  config,
  providersData,
}: {
  row: AgentRow;
  config: ModelAutoSwitchConfig;
  providersData: unknown;
}) {
  const pref = getAgentPref(config, row.representative.name);
  const agentVendor = row.representative.model?.providerID ?? null;

  const allModels = useMemo(
    () => collectModels(providersData, agentVendor),
    [providersData, agentVendor],
  );
  const allFamilies = useMemo(
    () => collectFamilies(providersData, agentVendor),
    [providersData, agentVendor],
  );

  const selectedModelKey =
    pref.modelKey ??
    (row.representative.model?.providerID && row.representative.model.modelID
      ? `${row.representative.model.providerID}/${row.representative.model.modelID}`
      : "");

  const [pidForVariants, ...rest] = selectedModelKey.split("/");
  const midForVariants = rest.join("/");
  const availableVariants = variantsForModel(
    providersData as Parameters<typeof variantsForModel>[0],
    pidForVariants,
    midForVariants,
  );

  const isOmoAgent = row.representative.name.includes(" - ");
  const modelResolution = resolveModelPreview(pref, row, providersData);
  const variantResolution = resolveVariantPreview(pref, row);

  return (
    <div className="rounded-md border border-border bg-bg/40 p-3 space-y-2">
      <div className="text-sm font-medium">{row.representative.name}</div>
      <div className="text-[10px] text-muted-fg">
        Agent's preferred: {modelLabel(row.representative.model)}
        {row.representative.variant ? ` · ${row.representative.variant}` : ""}
      </div>

      <RuleRow
        label="Model"
        family={row.representative.name}
        currentRule={pref.modelRule}
        currentValue={pref.modelKey}
        options={allModels}
        ruleField="modelRule"
        valueField="modelKey"
        familyOptions={allFamilies}
        familyValue={pref.modelFamilyKey}
        providersDataForSpecific={providersData}
        vendorFilterForSpecific={agentVendor}
      />
      <ResolutionHint
        text={modelResolution}
        warn={pref.modelRule === "no-change" && isOmoAgent}
        warnText={
          pref.modelRule === "no-change" && isOmoAgent
            ? "Not recommended for OMO agents — opencode's own hook may force-switch the model after submission anyway."
            : null
        }
      />

      <RuleRow
        label="Variant"
        family={row.representative.name}
        currentRule={pref.variantRule}
        currentValue={pref.variant}
        options={availableVariants.map((v) => ({ key: v, label: v || "(none)" }))}
        ruleField="variantRule"
        valueField="variant"
      />
      <ResolutionHint
        text={variantResolution}
        warn={pref.variantRule === "no-change" && isOmoAgent}
        warnText={
          pref.variantRule === "no-change" && isOmoAgent
            ? "Not recommended for OMO agents — variant won't track the agent's preferred thinking effort."
            : null
        }
      />

      <ResetButton family={row.representative.name} pref={pref} />
    </div>
  );
}

interface ModelOption {
  key: string;
  label: string;
}

function collectModels(
  providersData: unknown,
  vendorFilter: string | null,
): ModelOption[] {
  const data = providersData as
    | { providers?: Array<{ id: string; name?: string; models?: Record<string, { id: string; name?: string }> }> }
    | null
    | undefined;
  if (!data?.providers) return [];
  const out: ModelOption[] = [];
  for (const p of data.providers) {
    if (vendorFilter && p.id !== vendorFilter) continue;
    if (!p.models) continue;
    for (const m of Object.values(p.models)) {
      const key = `${p.id}/${m.id}`;
      out.push({ key, label: shortenModelName(m.name ?? m.id) || m.id });
    }
  }
  return out.sort((a, b) => {
    const [aPid, ...aRest] = a.key.split("/");
    const [bPid, ...bRest] = b.key.split("/");
    const aParsed = parseModelId(aPid, aRest.join("/"));
    const bParsed = parseModelId(bPid, bRest.join("/"));
    if (aParsed.familyKey === bParsed.familyKey) {
      return compareModelVersion(aParsed, bParsed);
    }
    return aParsed.family.localeCompare(bParsed.family);
  });
}

function collectFamilies(
  providersData: unknown,
  vendorFilter: string | null,
): ModelOption[] {
  const groups = groupByFamily(
    providersData as Parameters<typeof groupByFamily>[0],
  );
  const out: ModelOption[] = [];
  for (const [familyKey, list] of groups) {
    if (list.length === 0) continue;
    const rep = list[0];
    if (vendorFilter && rep.providerID !== vendorFilter) continue;
    const latest = rep.versionDisplay
      ? ` (latest: ${rep.versionDisplay})`
      : "";
    out.push({ key: familyKey, label: `${rep.family}${latest}` });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function modelLabel(
  model: { providerID?: string; modelID?: string } | null | undefined,
): string {
  if (!model?.modelID) return "(none)";
  return `${model.providerID}/${model.modelID}`;
}

function ResolutionHint({
  text,
  warn,
  warnText,
}: {
  text: string | null;
  warn?: boolean;
  warnText?: string | null;
}) {
  if (warn && warnText) {
    return (
      <div className="text-[10px] text-warning pl-[5.5rem]">{warnText}</div>
    );
  }
  if (!text) return null;
  return (
    <div className="text-[10px] text-muted-fg/70 pl-[5.5rem]">{text}</div>
  );
}

function resolveModelPreview(
  pref: AgentPref,
  row: AgentRow,
  providersData: unknown,
): string | null {
  switch (pref.modelRule) {
    case "agent-default":
      return `Resolves to: ${modelLabel(row.representative.model)}`;
    case "specific":
      return pref.modelKey ? `Resolves to: ${pref.modelKey}` : "Pick a model on the right.";
    case "family-latest": {
      if (!pref.modelFamilyKey) return "Pick a family on the right.";
      const groups = groupByFamily(
        providersData as Parameters<typeof groupByFamily>[0],
      );
      const list = groups.get(pref.modelFamilyKey);
      if (!list || list.length === 0) return "(no models in this family)";
      const m = list[0];
      return `Resolves to: ${m.providerID}/${m.modelID} (${m.family} ${m.versionDisplay})`;
    }
    case "family-previously-used-session":
      return pref.modelFamilyKey
        ? "Resolves to: last pick in this family in this session → last pick in this family globally → latest in this family → agent's default."
        : "Pick a family on the right.";
    case "family-previously-used-global":
      return pref.modelFamilyKey
        ? "Resolves to: last pick in this family globally → latest in this family → agent's default."
        : "Pick a family on the right.";
    case "previously-used-session":
      return "Resolves to: last pick in this session → last pick globally → agent's default.";
    case "previously-used-global":
      return "Resolves to: last pick globally → agent's default.";
    case "no-change":
      return "Model won't change when this agent is picked.";
    default:
      return null;
  }
}

function resolveVariantPreview(pref: AgentPref, row: AgentRow): string | null {
  switch (pref.variantRule) {
    case "agent-default":
      return `Resolves to: ${row.representative.variant ?? "(closest available)"}`;
    case "specific":
      return pref.variant !== undefined
        ? `Resolves to: ${pref.variant || "(none)"}`
        : "Pick a variant on the right.";
    case "previously-used-session":
      return "Resolves to: last variant pick in this session → last variant pick globally → agent's default.";
    case "previously-used-global":
      return "Resolves to: last variant pick globally → agent's default.";
    case "no-change":
      return "Variant won't change when this agent is picked.";
    default:
      return null;
  }
}

function RuleRow({
  label,
  family,
  currentRule,
  currentValue,
  options,
  ruleField,
  valueField,
  familyOptions,
  familyValue,
  providersDataForSpecific,
  vendorFilterForSpecific,
}: {
  label: string;
  family: string;
  currentRule: Rule;
  currentValue: string | undefined;
  options: ModelOption[] | Array<{ key: string; label: string }>;
  ruleField: "modelRule" | "variantRule";
  valueField: "modelKey" | "variant";
  familyOptions?: ModelOption[];
  familyValue?: string;
  providersDataForSpecific?: unknown;
  vendorFilterForSpecific?: string | null;
}) {
  const [saving, setSaving] = useState(false);
  const apply = async (pref: Partial<AgentPref>) => {
    setSaving(true);
    try {
      await setAgentPref(family, pref);
    } finally {
      setSaving(false);
    }
  };
  const showFamilyLatest = familyOptions !== undefined;
  return (
    <div className="grid grid-cols-[5rem_1fr_1fr] items-center gap-2 text-xs">
      <span className="text-muted-fg">{label}</span>
      <Select
        aria-label={`${label} rule for ${family}`}
        selectedKey={currentRule}
        isDisabled={saving}
        onSelectionChange={(k) => {
          if (!k) return;
          void apply({ [ruleField]: String(k) as Rule });
        }}
      >
        <SelectTrigger />
        <SelectContent>
          <SelectItem id="agent-default" textValue="Agent decides">
            Agent decides
          </SelectItem>
          <SelectItem id="specific" textValue="Specific">
            Specific
          </SelectItem>
          {showFamilyLatest && (
            <SelectItem id="family-latest" textValue="Latest in family">
              Latest in family
            </SelectItem>
          )}
          {showFamilyLatest && (
            <SelectItem
              id="family-previously-used-session"
              textValue="Previously used in family (this session)"
            >
              Previously used in family (this session)
            </SelectItem>
          )}
          {showFamilyLatest && (
            <SelectItem
              id="family-previously-used-global"
              textValue="Previously used in family (global)"
            >
              Previously used in family (global)
            </SelectItem>
          )}
          <SelectItem
            id="previously-used-session"
            textValue="Previously used in this session"
          >
            Previously used (this session)
          </SelectItem>
          <SelectItem
            id="previously-used-global"
            textValue="Previously used globally"
          >
            Previously used (global)
          </SelectItem>
          <SelectItem id="no-change" textValue="No change">
            No change
          </SelectItem>
        </SelectContent>
      </Select>
      {currentRule === "specific" && providersDataForSpecific !== undefined ? (
        <Select
          aria-label={`${label} value for ${family}`}
          selectedKey={currentValue ?? ""}
          isDisabled={saving}
          onSelectionChange={(k) => {
            if (k === null || k === undefined) return;
            void apply({ [valueField]: String(k) });
          }}
        >
          <SelectTrigger />
          <ModelPickerContent
            providersData={providersDataForSpecific}
            vendorFilter={vendorFilterForSpecific ?? null}
            ariaLabel={`${label} model for ${family}`}
          />
        </Select>
      ) : currentRule === "specific" ? (
        <Select
          aria-label={`${label} value for ${family}`}
          selectedKey={currentValue ?? ""}
          isDisabled={saving || options.length === 0}
          onSelectionChange={(k) => {
            if (k === null || k === undefined) return;
            void apply({ [valueField]: String(k) });
          }}
        >
          <SelectTrigger />
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.key} id={opt.key} textValue={opt.label}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (currentRule === "family-latest" ||
          currentRule === "family-previously-used-session" ||
          currentRule === "family-previously-used-global") &&
        familyOptions ? (
        <Select
          aria-label={`${label} family for ${family}`}
          selectedKey={familyValue ?? ""}
          isDisabled={saving || familyOptions.length === 0}
          onSelectionChange={(k) => {
            if (k === null || k === undefined) return;
            void apply({ modelFamilyKey: String(k) });
          }}
        >
          <SelectTrigger />
          <SelectContent>
            {familyOptions.map((opt) => (
              <SelectItem key={opt.key} id={opt.key} textValue={opt.label}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : currentRule === "previously-used-session" ? (
        <span className="text-[10px] leading-tight text-muted-fg/80">
          Fallback to previously used globally, or agent's default.
        </span>
      ) : currentRule === "previously-used-global" ? (
        <span className="text-[10px] leading-tight text-muted-fg/80">
          Fallback to agent's default.
        </span>
      ) : (
        <span className="text-muted-fg/70">—</span>
      )}
    </div>
  );
}

function ResetButton({ family, pref }: { family: string; pref: AgentPref }) {
  const hasOverride =
    pref.modelRule !== "agent-default" ||
    pref.variantRule !== "agent-default" ||
    pref.modelKey !== undefined ||
    pref.variant !== undefined;
  const [saving, setSaving] = useState(false);
  if (!hasOverride) return null;
  return (
    <button
      type="button"
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        try {
          await removeAgentPref(family);
        } finally {
          setSaving(false);
        }
      }}
      className="text-[10px] text-muted-fg/70 hover:text-fg"
    >
      {saving ? "Resetting…" : "Reset to default"}
    </button>
  );
}

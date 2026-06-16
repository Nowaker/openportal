import { type SyntheticEvent, useMemo, useState } from "react";
import {
  Autocomplete,
  ListBox,
  Popover,
  useFilter,
} from "react-aria-components";
import { Dialog } from "@/components/ui/dialog";
import { SearchField, SearchInput } from "@/components/ui/search-field";
import { SelectItem, SelectLabel, SelectSection } from "@/components/ui/select";
import useMediaQuery from "@/hooks/use-media-query";
import { groupByFamily, type ParsedModel } from "@/lib/model-version";

interface RawProvider {
  id?: string;
  name?: string;
  models?: Record<string, RawModel>;
}

interface RawModel {
  id?: string;
  name?: string;
  providerID?: string;
  release_date?: string;
  status?: string;
  capabilities?: {
    reasoning?: boolean;
    input?: Record<string, boolean | undefined>;
  };
  limit?: { context?: number; output?: number };
}

interface ModelDetails {
  id: string;
  modelID: string;
  displayName: string;
  allows: string[];
  allowsReasoning: boolean;
  contextLimit: number | null;
  outputLimit: number | null;
  releaseDate: string | null;
  status: string | null;
}

export interface ModelPickerExtraEntry {
  id: string;
  label: string;
  trailing?: string;
}

export function ModelPickerContent({
  providersData,
  vendorFilter,
  defaultKey,
  extraEntries,
  ariaLabel,
  searchPlaceholder = "Search models...",
}: {
  providersData: unknown;
  vendorFilter?: string | null;
  defaultKey?: string | null;
  extraEntries?: ModelPickerExtraEntry[];
  ariaLabel: string;
  searchPlaceholder?: string;
}) {
  const { contains } = useFilter({ sensitivity: "base" });
  const { isMobile } = useMediaQuery();
  const [activeDetailsId, setActiveDetailsId] = useState<string | null>(null);

  const detailsById = useMemo(() => {
    const raw = providersData as { providers?: RawProvider[] } | null | undefined;
    const out = new Map<string, ModelDetails>();
    for (const provider of raw?.providers ?? []) {
      const providerID = provider.id ?? "";
      if (!providerID) continue;
      for (const model of Object.values(provider.models ?? {})) {
        const modelID = model.id ?? "";
        if (!modelID) continue;
        const parsed = parseModelDetails(providerID, provider.name, model);
        out.set(parsed.id, parsed);
      }
    }
    return out;
  }, [providersData]);

  const families = useMemo(() => {
    const groups = groupByFamily(
      providersData as Parameters<typeof groupByFamily>[0],
    );
    const out: Array<{
      familyKey: string;
      family: string;
      models: Array<{ id: string; label: string }>;
    }> = [];
    for (const [familyKey, list] of groups) {
      const filtered = vendorFilter
        ? list.filter((m) => m.providerID === vendorFilter)
        : list;
      if (filtered.length === 0) continue;
      out.push({
        familyKey,
        family: list[0].family,
        models: filtered.map((m) => ({
          id: `${m.providerID}/${m.modelID}`,
          label: modelRowLabel(m),
        })),
      });
    }
    return out.sort((a, b) => a.family.localeCompare(b.family));
  }, [detailsById, providersData, vendorFilter]);

  const activeDetails = activeDetailsId
    ? detailsById.get(activeDetailsId) ?? null
    : null;

  function activateDetailsFromEvent(event: SyntheticEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    const row = target?.closest<HTMLElement>("[data-model-details-id]");
    const next = row?.dataset.modelDetailsId ?? null;
    if (next && next !== activeDetailsId) setActiveDetailsId(next);
  }

  return (
    <Popover className="entering:fade-in exiting:fade-out flex max-h-[min(80vh,32rem)] min-w-(--trigger-width) w-screen max-w-[calc(100vw-1.5rem)] sm:max-w-3xl entering:animate-in exiting:animate-out overflow-hidden rounded-lg border bg-overlay">
      <Dialog aria-label={ariaLabel}>
        <Autocomplete filter={contains}>
          <div className="flex min-h-0 w-full">
            <div
              className="flex min-w-(--trigger-width) flex-1 flex-col overflow-hidden sm:max-w-md"
              onFocusCapture={activateDetailsFromEvent}
              onPointerMove={activateDetailsFromEvent}
            >
              <div className="border-b bg-muted p-2">
                <SearchField
                  className="rounded-lg bg-bg [&_input]:!text-sm"
                  autoFocus={!isMobile}
                >
                  <SearchInput placeholder={searchPlaceholder} />
                </SearchField>
              </div>
              <ListBox
                className="grid max-h-[min(70vh,28rem)] w-full grid-cols-[auto_1fr] flex-col gap-y-0.5 overflow-y-auto p-1 text-xs outline-hidden sm:text-sm *:[[role='group']+[role=group]]:mt-3 *:[[role='group']+[role=separator]]:mt-1 [&_[role=option]]:!text-xs sm:[&_[role=option]]:!text-sm [&_[role=option]]:!py-1 sm:[&_[role=option]]:!py-1 [&_[role=group]>[role=presentation]]:!text-xs"
              >
                {extraEntries?.map((e) => (
                  <SelectItem
                    key={e.id}
                    id={e.id}
                    textValue={`${e.label}${e.trailing ? ` ${e.trailing}` : ""}`}
                    className="font-medium"
                    data-model-details-id={defaultKey ?? undefined}
                  >
                    <SelectLabel>
                      {e.label}
                      {e.trailing && (
                        <span className="ml-1 text-muted-fg">{e.trailing}</span>
                      )}
                    </SelectLabel>
                  </SelectItem>
                ))}
                {families.map((fam) => (
                  <SelectSection
                    key={fam.familyKey}
                    title={fam.family}
                    items={fam.models}
                  >
                    {(model) => (
                      <SelectItem
                        id={model.id}
                        textValue={model.label}
                        data-model-details-id={model.id}
                      >
                        <SelectLabel>
                          {model.label}
                          {model.id === defaultKey && (
                            <span className="ml-1 text-muted-fg">(default)</span>
                          )}
                        </SelectLabel>
                      </SelectItem>
                    )}
                  </SelectSection>
                ))}
              </ListBox>
            </div>
            <ModelDetailsPanel details={activeDetails} />
          </div>
        </Autocomplete>
      </Dialog>
    </Popover>
  );
}

function modelRowLabel(m: ParsedModel): string {
  const base = m.versionDisplay || m.modelID;
  return m.betaStatus ? `${base} (${m.betaStatus})` : base;
}

function parseModelDetails(
  providerID: string,
  providerName: string | undefined,
  model: RawModel,
): ModelDetails {
  const modelID = model.id ?? "";
  const input = model.capabilities?.input ?? {};
  const allows = Object.entries(input)
    .filter(([, enabled]) => enabled)
    .map(([kind]) => kind)
    .sort((a, b) => inputKindOrder(a) - inputKindOrder(b));

  return {
    id: `${providerID}/${modelID}`,
    modelID,
    displayName: `${providerName ?? providerID} ${model.name ?? modelID}`,
    allows: allows.length ? allows : ["text"],
    allowsReasoning: Boolean(model.capabilities?.reasoning),
    contextLimit: positiveNumber(model.limit?.context),
    outputLimit: positiveNumber(model.limit?.output),
    releaseDate: model.release_date ?? null,
    status: model.status ?? null,
  };
}

function inputKindOrder(kind: string): number {
  const order = ["text", "image", "pdf", "audio", "video"].indexOf(kind);
  return order === -1
    ? 99
    : order;
}

function positiveNumber(value: number | undefined): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

function formatNumber(value: number | null): string {
  return value === null ? "unknown" : new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function ModelDetailsPanel({ details }: { details: ModelDetails | null }) {
  return (
    <aside
      aria-live="polite"
      className="hidden w-72 shrink-0 border-l bg-overlay px-4 py-3 text-sm text-overlay-fg sm:block"
      data-test="model-picker-details"
    >
      {details ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-base font-semibold leading-tight">
              {details.displayName}
            </h3>
            <p className="break-all text-xs text-muted-fg">{details.modelID}</p>
          </div>
          <div className="space-y-2 text-sm leading-6">
            <p>Allows: {details.allows.join(", ")}</p>
            <p>{details.allowsReasoning ? "Allows reasoning" : "No reasoning"}</p>
            <p>Context limit {formatNumber(details.contextLimit)}</p>
            {details.outputLimit !== null && (
              <p>Output limit {formatNumber(details.outputLimit)}</p>
            )}
            {details.releaseDate && (
              <p>Released {formatDate(details.releaseDate) ?? details.releaseDate}</p>
            )}
            {details.status && <p>Status {details.status}</p>}
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-32 items-center text-xs text-muted-fg">
          Hover a model to see capabilities.
        </div>
      )}
    </aside>
  );
}

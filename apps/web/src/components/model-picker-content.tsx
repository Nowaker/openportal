import { useMemo } from "react";
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
  }, [providersData, vendorFilter]);

  return (
    <Popover className="entering:fade-in exiting:fade-out flex max-h-[min(80vh,32rem)] min-w-(--trigger-width) w-screen max-w-[calc(100vw-1.5rem)] sm:max-w-md entering:animate-in exiting:animate-out flex-col overflow-hidden rounded-lg border bg-overlay">
      <Dialog aria-label={ariaLabel}>
        <Autocomplete filter={contains}>
          <div className="border-b bg-muted p-2">
            <SearchField
              className="rounded-lg bg-bg [&_input]:!text-sm"
              autoFocus={!isMobile}
            >
              <SearchInput placeholder={searchPlaceholder} />
            </SearchField>
          </div>
          <ListBox className="grid max-h-[min(70vh,28rem)] w-full grid-cols-[auto_1fr] flex-col gap-y-0.5 overflow-y-auto p-1 text-xs outline-hidden sm:text-sm *:[[role='group']+[role=group]]:mt-3 *:[[role='group']+[role=separator]]:mt-1 [&_[role=option]]:!text-xs sm:[&_[role=option]]:!text-sm [&_[role=option]]:!py-1 sm:[&_[role=option]]:!py-1 [&_[role=group]>[role=presentation]]:!text-xs">
            {extraEntries?.map((e) => (
              <SelectItem
                key={e.id}
                id={e.id}
                textValue={`${e.label}${e.trailing ? ` ${e.trailing}` : ""}`}
                className="font-medium"
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
                  <SelectItem id={model.id} textValue={model.label}>
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
        </Autocomplete>
      </Dialog>
    </Popover>
  );
}

function modelRowLabel(m: ParsedModel): string {
  const base = m.versionDisplay || m.modelID;
  return m.betaStatus ? `${base} (${m.betaStatus})` : base;
}

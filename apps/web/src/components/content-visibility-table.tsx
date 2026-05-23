import * as React from "react";
import {
  ALL_CONTENT_TYPES,
  ALL_VISIBILITIES,
  CONTENT_TYPE_LABELS,
  VISIBILITY_LABELS,
  resetContentSettings,
  setContentRule,
  useContentSettings,
  type ContentType,
  type Visibility,
} from "@/stores/content-settings-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { toast } from "@/components/ui/toast";

function visibilityHasBytes(v: Visibility): boolean {
  return v === "show-max-bytes" || v === "show-max-bytes-with-ajax";
}

function ContentRuleRow({ contentType }: { contentType: ContentType }) {
  const { settings, isLoading } = useContentSettings();
  const rule = settings.rules[contentType];
  const [draftKb, setDraftKb] = React.useState<string>(() =>
    rule.maxBytes === null ? "" : String(Math.round(rule.maxBytes / 1024)),
  );
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setDraftKb(rule.maxBytes === null ? "" : String(Math.round(rule.maxBytes / 1024)));
  }, [rule.maxBytes]);

  const showsBytes = visibilityHasBytes(rule.visibility);

  const commit = async (next: { visibility?: Visibility; maxBytes?: number | null }) => {
    setBusy(true);
    try {
      const visibility = next.visibility ?? rule.visibility;
      const maxBytes = next.maxBytes ?? rule.maxBytes;
      await setContentRule(contentType, { visibility, maxBytes });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update content rule",
      );
    } finally {
      setBusy(false);
    }
  };

  const onVisibilityChange = (next: Visibility) => {
    const nextNeedsBytes = visibilityHasBytes(next);
    const maxBytes =
      nextNeedsBytes && rule.maxBytes === null
        ? 64 * 1024
        : nextNeedsBytes
          ? rule.maxBytes
          : null;
    void commit({ visibility: next, maxBytes });
  };

  const onBytesBlur = () => {
    const trimmed = draftKb.trim();
    if (trimmed === "") {
      if (rule.maxBytes !== null) void commit({ maxBytes: null });
      return;
    }
    const kb = Number(trimmed);
    if (!Number.isFinite(kb) || kb <= 0) {
      toast.error("Enter a positive integer (KB) or leave blank.");
      setDraftKb(rule.maxBytes === null ? "" : String(Math.round(rule.maxBytes / 1024)));
      return;
    }
    const nextBytes = Math.floor(kb * 1024);
    if (nextBytes !== rule.maxBytes) void commit({ maxBytes: nextBytes });
  };

  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-3 text-sm align-middle">{CONTENT_TYPE_LABELS[contentType]}</td>
      <td className="py-2 pr-3 align-middle">
        <Select
          aria-label={`Visibility for ${CONTENT_TYPE_LABELS[contentType]}`}
          selectedKey={rule.visibility}
          onSelectionChange={(key) => {
            if (!key) return;
            onVisibilityChange(String(key) as Visibility);
          }}
          isDisabled={isLoading || busy}
        >
          <SelectTrigger className="max-w-[18rem]" />
          <SelectContent>
            {ALL_VISIBILITIES.map((v) => (
              <SelectItem key={v} id={v} textValue={VISIBILITY_LABELS[v]}>
                {VISIBILITY_LABELS[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="py-2 align-middle">
        {showsBytes ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="No cap"
              value={draftKb}
              onChange={(e) => setDraftKb(e.target.value)}
              onBlur={onBytesBlur}
              className="max-w-[7rem]"
              isDisabled={isLoading || busy}
              aria-label={`Byte cap for ${CONTENT_TYPE_LABELS[contentType]}`}
            />
            <span className="text-xs text-muted-fg">KB</span>
          </div>
        ) : (
          <span className="text-xs text-muted-fg">—</span>
        )}
      </td>
    </tr>
  );
}

export function ContentVisibilityTable() {
  const { isLoading } = useContentSettings();
  const [resetting, setResetting] = React.useState(false);

  const onReset = async () => {
    setResetting(true);
    try {
      await resetContentSettings();
      toast.success("Content visibility reset to defaults.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to reset content visibility",
      );
    } finally {
      setResetting(false);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Content visibility</h3>
        <p className="text-xs text-muted-fg pt-1">
          Per-content-type rule for what shows in the chat log. "Show max N bytes"
          truncates server-side; "+ ajax for more" lets you click-load the rest.
          "Ajax only" hides the body and lets you fetch it on demand. "Hide entirely"
          drops it from the wire and removes the fetch path.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-fg">
          <Loader className="size-4" />
          Loading rules...
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs text-muted-fg">
                <th className="py-2 pr-3 font-normal">Content type</th>
                <th className="py-2 pr-3 font-normal">Visibility</th>
                <th className="py-2 font-normal">Limit (when applicable)</th>
              </tr>
            </thead>
            <tbody>
              {ALL_CONTENT_TYPES.map((t) => (
                <ContentRuleRow key={t} contentType={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button
          size="sm"
          intent="outline"
          onPress={() => {
            void onReset();
          }}
          isDisabled={isLoading || resetting}
          data-test="portal-settings-content-reset"
        >
          {resetting ? "Resetting..." : "Reset to defaults"}
        </Button>
        <span className="text-xs text-muted-fg">
          Defaults: everything visible, OMO injections fetched on click.
        </span>
      </div>
    </section>
  );
}

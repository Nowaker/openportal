import { useState } from "react";
import {
  ModalOverlay,
  Modal,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import { CodeBracketIcon, XMarkIcon } from "@heroicons/react/24/outline";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { MODAL_OVERLAY_CLASSES } from "@/lib/ui-classes";
import { toast } from "@/components/ui/toast";

interface VSCodeInfoResponse {
  requestor: string;
  isLocal: boolean;
  workspaceDirs: string[];
  mapping: Record<string, string>;
}

const fetcher = async (url: string): Promise<VSCodeInfoResponse> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

function applyMapping(
  absPath: string,
  mapping: Record<string, string>,
): string {
  const keys = Object.keys(mapping).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (absPath === k) return mapping[k];
    if (absPath.startsWith(k + "/")) return mapping[k] + absPath.slice(k.length);
  }
  return absPath;
}

function buildVscodeHref(absPath: string): string {
  return `vscode://file${encodeURI(absPath.replace(/\/+$/, ""))}/`;
}

interface Props {
  directory: string;
  className?: string;
  children?: React.ReactNode;
  title?: string;
}

// Wraps the existing vscode:// link with a per-requestor path-mapping
// modal. On local requests (loopback / OPENPORTAL_LOCAL_IPS list) the
// link works exactly as before - vscode://file/<abs>/ via plain
// anchor href. On remote requests the first click opens a modal that
// asks the user to map each workspace root to its equivalent path on
// their own machine; once saved the link uses the mapped path.
export function VSCodeLink({
  directory,
  className,
  children,
  title = "Open project in VS Code",
}: Props) {
  const { data, mutate } = useSWR<VSCodeInfoResponse>(
    "/api/vscode/mapping",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const [modalOpen, setModalOpen] = useState(false);

  const open = (mapped: string) => {
    window.location.href = buildVscodeHref(mapped);
  };

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!data) return;
    if (data.isLocal) {
      open(directory);
      return;
    }
    const hasMapping = Object.keys(data.mapping).length > 0;
    if (hasMapping) {
      open(applyMapping(directory, data.mapping));
    } else {
      setModalOpen(true);
    }
  };

  const localHref = data?.isLocal ? buildVscodeHref(directory) : "#";

  return (
    <>
      <a
        href={localHref}
        onClick={onClick}
        className={className}
        title={title}
      >
        {children ?? <CodeBracketIcon className="size-3.5" />}
      </a>
      {modalOpen && data && !data.isLocal && (
        <VSCodeMappingModal
          info={data}
          previewPath={directory}
          onSaved={(mapping) => {
            void mutate(
              { ...data, mapping },
              { revalidate: false },
            );
            setModalOpen(false);
            open(applyMapping(directory, mapping));
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

interface MappingModalProps {
  info: VSCodeInfoResponse;
  previewPath: string;
  onSaved: (mapping: Record<string, string>) => void;
  onClose: () => void;
}

function VSCodeMappingModal({
  info,
  previewPath,
  onSaved,
  onClose,
}: MappingModalProps) {
  const [mapping, setMapping] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const d of info.workspaceDirs) {
      out[d] = info.mapping[d] ?? d;
    }
    return out;
  });
  const [saving, setSaving] = useState(false);

  const preview = applyMapping(previewPath, mapping);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/vscode/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSaved(mapping);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to save mapping",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={MODAL_OVERLAY_CLASSES}
    >
      <Modal className="w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col flex-1 min-h-0 outline-none">
          {({ close }) => (
            <>
              <header className="shrink-0 flex items-start gap-2 border-b border-border px-4 py-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold">
                    Open in VS Code — path mapping
                  </h2>
                  <p className="mt-1 text-xs text-muted-fg">
                    You're connecting from <span className="font-mono">{info.requestor}</span>.
                    Tell us where each workspace root lives on your machine
                    so the vscode:// link opens the right path.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
                >
                  <XMarkIcon className="size-4" />
                </button>
              </header>
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                {info.workspaceDirs.length === 0 && (
                  <p className="text-sm text-muted-fg">
                    No workspace roots configured.
                  </p>
                )}
                {info.workspaceDirs.map((d) => (
                  <div
                    key={d}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2"
                  >
                    <code className="block truncate rounded bg-muted/30 px-2 py-1 text-xs font-mono">
                      {d}
                    </code>
                    <span className="hidden sm:inline text-muted-fg">→</span>
                    <input
                      type="text"
                      value={mapping[d] ?? ""}
                      onChange={(e) =>
                        setMapping({ ...mapping, [d]: e.target.value })
                      }
                      placeholder="Path on your machine"
                      className="rounded-md border border-border bg-bg px-2 py-1 text-xs font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                ))}
                <div className="mt-2 rounded-md border border-border bg-muted/15 p-2 text-xs">
                  <div className="text-muted-fg">Preview:</div>
                  <div className="mt-1 font-mono break-words">
                    Opening <span className="text-primary">{previewPath}</span> →{" "}
                    <span className="text-primary">{preview}</span>
                  </div>
                </div>
              </div>
              <footer className="shrink-0 flex justify-end gap-2 border-t border-border px-4 py-3">
                <Button intent="outline" onPress={close}>
                  Cancel
                </Button>
                <Button
                  intent="primary"
                  isDisabled={saving}
                  onPress={() => void save()}
                >
                  {saving ? "Saving…" : "Save & open"}
                </Button>
              </footer>
            </>
          )}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

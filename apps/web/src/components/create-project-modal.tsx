import { useEffect, useRef, useState } from "react";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";

interface Props {
  isOpen: boolean;
  parentPath: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (newPath: string) => void;
}

export function CreateProjectModal({
  isOpen,
  parentPath,
  onOpenChange,
  onCreated,
}: Props) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm"
    >
      <Modal className="w-full max-w-sm rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="outline-none">
          {({ close }) => (
            <Body
              parentPath={parentPath}
              onClose={close}
              onCreated={(p) => {
                onCreated(p);
                close();
              }}
            />
          )}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

function Body({
  parentPath,
  onClose,
  onCreated,
}: {
  parentPath: string;
  onClose: () => void;
  onCreated: (newPath: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const v = name.trim();
    if (!v || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/fs/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: parentPath, name: v }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string; message?: string }).error ??
            (j as { message?: string }).message ??
            `HTTP ${r.status}`,
        );
      }
      const data = (await r.json()) as { path: string };
      onCreated(data.path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create");
      setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">New project</h2>
        <p className="text-xs text-muted-fg break-all" title={parentPath}>
          in {parentPath}
        </p>
      </div>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            onClose();
          }
        }}
        placeholder="Project folder name"
        disabled={busy}
        className="w-full rounded border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
      />
      {err && <div className="text-xs text-danger">{err}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md px-3 py-1 text-xs text-muted-fg hover:bg-muted hover:text-fg disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !name.trim()}
          className="rounded-md bg-primary px-3 py-1 text-xs text-primary-fg hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Creating..." : "Create"}
        </button>
      </div>
    </div>
  );
}

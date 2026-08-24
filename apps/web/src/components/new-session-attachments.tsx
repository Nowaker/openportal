import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { DocumentIcon } from "@heroicons/react/24/outline";
import { toast } from "@/components/ui/toast";

export interface PromptAttachment {
  readonly mime: string;
  readonly filename?: string;
  readonly url: string;
}

const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",", 2);
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export interface NewSessionAttachmentsController {
  readonly pendingAttachments: readonly PromptAttachment[];
  readonly setPendingAttachments: Dispatch<SetStateAction<PromptAttachment[]>>;
  readonly handleAttachFiles: (files: FileList | File[]) => Promise<void>;
  readonly removeAttachment: (index: number) => void;
  readonly fileAttachInputRef: RefObject<HTMLInputElement | null>;
  readonly anyFileAttachInputRef: RefObject<HTMLInputElement | null>;
}

export function useNewSessionAttachments(): NewSessionAttachmentsController {
  const [pendingAttachments, setPendingAttachments] = useState<
    PromptAttachment[]
  >([]);
  const fileAttachInputRef = useRef<HTMLInputElement | null>(null);
  const anyFileAttachInputRef = useRef<HTMLInputElement | null>(null);

  const handleAttachFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const oversized: string[] = [];
    const reads = await Promise.all(
      list.map(
        (file) =>
          new Promise<PromptAttachment | null>((resolve) => {
            if (file.size > ATTACHMENT_MAX_BYTES) {
              oversized.push(file.name);
              resolve(null);
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result;
              if (typeof result !== "string") {
                resolve(null);
                return;
              }
              resolve({
                mime: file.type || "application/octet-stream",
                filename: file.name,
                url: result,
              });
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }),
      ),
    );
    if (oversized.length > 0) {
      toast.error(
        `Skipped ${oversized.length} file(s) over 10 MB: ${oversized.join(", ")}`,
      );
    }
    const valid = reads.filter((a): a is PromptAttachment => a !== null);
    if (valid.length === 0) return;
    setPendingAttachments((prev) => [...prev, ...valid]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return {
    pendingAttachments,
    setPendingAttachments,
    handleAttachFiles,
    removeAttachment,
    fileAttachInputRef,
    anyFileAttachInputRef,
  };
}

interface NewSessionAttachmentInputsProps {
  readonly controller: NewSessionAttachmentsController;
}

export function NewSessionAttachmentInputs({
  controller,
}: NewSessionAttachmentInputsProps) {
  const { fileAttachInputRef, anyFileAttachInputRef, handleAttachFiles } =
    controller;
  return (
    <>
      <input
        ref={fileAttachInputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          if (e.target.files) {
            void handleAttachFiles(e.target.files);
          }
          e.target.value = "";
        }}
      />
      <input
        ref={anyFileAttachInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          if (e.target.files) {
            void handleAttachFiles(e.target.files);
          }
          e.target.value = "";
        }}
      />
    </>
  );
}

interface NewSessionAttachmentListProps {
  readonly controller: NewSessionAttachmentsController;
}

export function NewSessionAttachmentList({
  controller,
}: NewSessionAttachmentListProps) {
  const { pendingAttachments, removeAttachment } = controller;
  if (pendingAttachments.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {pendingAttachments.map((a, i) => {
        const isImage = (a.mime ?? "").startsWith("image/");
        return (
          <div
            key={`${a.filename ?? "attachment"}-${i}`}
            className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted"
          >
            <button
              type="button"
              onClick={() => {
                const url = a.url ?? "";
                if (!url.startsWith("data:")) return;
                try {
                  const blob = dataUrlToBlob(url);
                  const objUrl = URL.createObjectURL(blob);
                  window.open(objUrl, "_blank", "noopener,noreferrer");
                  window.setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
                } catch {
                  /* ignore */
                }
              }}
              title={a.filename ?? "Preview attachment"}
              aria-label={a.filename ?? "Preview attachment"}
              className="block h-full w-full"
            >
              {isImage ? (
                <img
                  src={a.url}
                  alt={a.filename ?? `Attachment ${i + 1}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-muted-fg">
                  <DocumentIcon className="size-5 shrink-0" />
                  <span className="w-full truncate text-[9px] leading-tight">
                    {a.filename ?? "file"}
                  </span>
                </div>
              )}
            </button>
            <button
              type="button"
              onClick={() => removeAttachment(i)}
              className="absolute right-0.5 top-0.5 rounded-full bg-bg/80 px-1 text-[10px] leading-tight text-fg shadow hover:bg-bg"
              aria-label={`Remove ${a.filename ?? "attachment"}`}
              title="Remove"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}

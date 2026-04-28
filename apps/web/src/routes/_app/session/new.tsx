import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod/v4";
import { useInstanceStore } from "@/stores/instance-store";
import { useVirtualSessionStore } from "@/stores/virtual-session-store";
import { useCreateSession } from "@/hooks/use-opencode";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import SendIcon from "@/components/icons/send-icon";
import { useSWRConfig } from "swr";
import { mutate as mutateSWR } from "swr";

const searchSchema = z.object({
  directory: z.string().optional(),
});

export const Route = createFileRoute("/_app/session/new")({
  component: NewSessionPage,
  validateSearch: searchSchema,
});

function NewSessionPage() {
  const navigate = useNavigate();
  const { directory: directoryFromUrl } = Route.useSearch();
  const storeDir = useVirtualSessionStore((s) => s.directory);
  const setStoreDir = useVirtualSessionStore((s) => s.setDirectory);
  const clearStore = useVirtualSessionStore((s) => s.clear);
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const createSession = useCreateSession();
  const { mutate: globalMutate } = useSWRConfig();

  const directory = directoryFromUrl || storeDir || null;

  useEffect(() => {
    if (directoryFromUrl && directoryFromUrl !== storeDir) {
      setStoreDir(directoryFromUrl);
    }
  }, [directoryFromUrl, storeDir, setStoreDir]);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (!submittedRef.current) {
        clearStore();
      }
    };
  }, [clearStore]);

  const handleSubmit = async () => {
    if (sending) return;
    if (!directory) {
      setError("No directory selected.");
      return;
    }
    const message = text.trim();
    if (!message) return;
    if (!port) {
      setError("Portal not bound to opencode.");
      return;
    }

    setSending(true);
    setError(null);

    try {
      const session = await createSession({ directory });
      const sessionId = session.id;

      const res = await fetch(
        `/api/opencode/${port}/session/${sessionId}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message }),
        },
      );
      if (!res.ok) {
        throw new Error(`prompt failed: ${res.status}`);
      }

      submittedRef.current = true;
      clearStore();
      await globalMutate(`/api/opencode/${port}/sessions`);
      mutateSWR(
        (key) =>
          typeof key === "string" &&
          key.startsWith(`/api/opencode/${port}/session/${sessionId}/messages`),
      );
      navigate({ to: "/session/$id", params: { id: sessionId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!directory) {
    return (
      <div className="flex h-full items-center justify-center text-muted-fg">
        No directory chosen. Use Open directory in the sidebar.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <div className="text-center max-w-xl space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-fg">
          New session
        </p>
        <h1 className="text-base font-mono break-all">{directory}</h1>
        <p className="text-sm text-muted-fg">
          Type your first message. The session is created when you send.
        </p>
      </div>

      <div className="w-full max-w-2xl space-y-2">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What do you want to do?"
          className="min-h-[120px]"
          disabled={sending}
        />
        {error && (
          <div className="text-sm text-danger-subtle-fg bg-danger-subtle px-3 py-2 rounded">
            {error}
          </div>
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            onPress={handleSubmit}
            isDisabled={sending || !text.trim()}
          >
            <SendIcon />
            {sending ? "Starting…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}

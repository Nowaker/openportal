import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import AppLayout from "@/layouts/app-layout";
import { ModelSelect } from "@/components/model-select";
import { Textarea } from "@/components/ui/textarea";
import IconBadgeSparkle from "@/components/icons/badge-sparkle-icon";
import { Streamdown } from 'streamdown';


interface Part {
  type: string;
  text?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
}

interface MessageInfo {
  id: string;
  role: "user" | "assistant";
  createdAt?: string;
}

interface Message {
  info: MessageInfo;
  parts: Part[];
}

interface Session {
  id: string;
  title?: string;
}

export default function SessionPage() {
  const router = useRouter();
  const { id } = router.query;

  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchMessages = async () => {
    if (!id) return;
    try {
      const messagesRes = await fetch(`/api/sessions/${id}/messages`);
      if (messagesRes.ok) {
        const messagesData = await messagesRes.json();
        setMessages(messagesData.data || messagesData || []);
      }
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    }
  };

  useEffect(() => {
    if (!id) return;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const [sessionRes, messagesRes] = await Promise.all([
          fetch(`/api/sessions/${id}`),
          fetch(`/api/sessions/${id}/messages`),
        ]);

        if (!sessionRes.ok || !messagesRes.ok) {
          throw new Error("Failed to fetch session data");
        }

        const sessionData = await sessionRes.json();
        const messagesData = await messagesRes.json();

        setSession(sessionData.data || sessionData);
        setMessages(messagesData.data || messagesData || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !id || sending) return;

    const messageText = input.trim();
    setInput("");
    setSending(true);

    try {
      const response = await fetch(`/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: messageText }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      await fetchMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const getMessageContent = (parts: Part[]): string => {
    return parts
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n\n");
  };

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] flex-col">
        {/* Chat container - top part */}
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-auto">
            <div className="w-full">
              {loading && (
                <div className="text-center text-muted-fg">
                  Loading messages...
                </div>
              )}

              {error && (
                <div className="rounded-md bg-danger-subtle p-4 text-danger-subtle-fg">
                  Error: {error}
                </div>
              )}

              {!loading && !error && messages.length === 0 && (
                <div className="text-center text-muted-fg">
                  No messages found
                </div>
              )}

              <div className="divide-y divide-dashed divide-border">
                {messages.map((message) => (
                  <div key={message.info.id} className="py-3 px-6">
                    <div className="mb-2 flex items-center gap-2">
                      {message.info.role === "assistant" && (
                        <IconBadgeSparkle size="16px" />
                      )}
                      {message.info.role === "user" && (
                        <span className="text-sm font-semibold">You</span>
                      )}
                      {message.info.createdAt && (
                        <span className="text-xs text-muted-fg">
                          {new Date(message.info.createdAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {/* <div className="whitespace-pre-wrap text-sm"> */}
                    <Streamdown>

                      {getMessageContent(message.parts)}
                    </Streamdown>
                    {/* </div> */}
                    {message.parts
                      .filter((part) => part.type === "tool-invocation")
                      .map((part, idx) => (
                        <div
                          key={idx}
                          className="mt-3 rounded border border-border bg-muted p-2 text-xs"
                        >
                          <div className="font-mono font-semibold text-primary">
                            Tool: {part.toolName}
                          </div>
                          {part.args && (
                            <pre className="mt-1 overflow-x-auto text-muted-fg">
                              {JSON.stringify(part.args, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    {message.parts
                      .filter((part) => part.type === "tool-result")
                      .map((part, idx) => (
                        <div
                          key={idx}
                          className="mt-2 rounded border border-success bg-success-subtle p-2 text-xs"
                        >
                          <div className="font-mono font-semibold text-success-subtle-fg">
                            Result:
                          </div>
                          <pre className="mt-1 overflow-x-auto text-muted-fg">
                            {typeof part.result === "string"
                              ? part.result
                              : JSON.stringify(part.result, null, 2)}
                          </pre>
                        </div>
                      ))}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>
        </div>

        {/* Messaging UI - bottom part */}
        <div className="border-t border-border p-4">
          <form onSubmit={handleSubmit} className="w-full">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && !sending) {
                    handleSubmit(e as unknown as React.FormEvent);
                  }
                }
              }}
              placeholder="Type your message..."
              disabled={sending}
              className="w-full resize-none"
              rows={1}
            />
            <div className="mt-3 flex items-center gap-2">
              <ModelSelect />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}

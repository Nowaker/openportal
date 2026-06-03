import { useEffect } from "react";
import { Autocomplete, ListBox, Popover, SelectValue } from "react-aria-components";
import { ChevronUpDownIcon } from "@heroicons/react/24/outline";
import { Dialog } from "@/components/ui/dialog";
import {
  Select,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import { useAgents, useProviders } from "@/hooks/use-opencode";
import { useAgentStore } from "@/stores/agent-store";
import { useChatDisplayStore } from "@/stores/chat-display-store";
import { useInstanceStore } from "@/stores/instance-store";
import { useModelStore } from "@/stores/model-store";
import { useThinkingStore } from "@/stores/thinking-store";
import { shortenOmoAgentName } from "@/lib/agent-name";
import { variantsForModel, pickClosestVariant } from "@/lib/variant-fallback";
import type { Agent } from "@opencode-ai/sdk";

interface AgentSelectProps {
  sessionId: string | null;
}

function isValidAgent(agents: Agent[], name?: string | null) {
  if (!name) return false;
  return agents.some((agent) => agent.name === name);
}

// Layered resolution: returns the agent name to display when this
// session doesn't have its own pick yet (or doesn't have an id yet,
// like the new-session composer).
//   1. agent last picked on THIS server (lastUsedForInstance)
//   2. agent last picked GLOBALLY (lastUsedGlobal)
//   3. hard fallback: 'plan' if present, else first available agent
function resolveDefaultAgentName(
  agents: Agent[],
  lastUsedForInstance: string | null,
  lastUsedGlobal: string | null,
) {
  if (agents.length === 0) return undefined;
  if (isValidAgent(agents, lastUsedForInstance)) return lastUsedForInstance!;
  if (isValidAgent(agents, lastUsedGlobal)) return lastUsedGlobal!;
  return agents.find((agent) => agent.name === "plan")?.name ?? agents[0]?.name;
}

export function AgentSelect({ sessionId }: AgentSelectProps) {
  const { data, isLoading } = useAgents();
  const agents = (data ?? []) as Agent[];
  const { data: providersData } = useProviders();
  const currentVariant = useThinkingStore((s) => s.resolve(sessionId ?? null));

  const instance = useInstanceStore((s) => s.instance);
  const instanceId = instance?.id ?? null;

  const selectedAgent = useAgentStore((s) => s.getSelectedAgent(sessionId));
  const shortenOmoAgent = useChatDisplayStore((s) => s.shortenOmoAgentNames);
  const setSelectedAgent = useAgentStore((s) => s.setSelectedAgent);
  const setLastUsedAgentForInstance = useAgentStore(
    (s) => s.setLastUsedAgentForInstance,
  );
  const setLastUsedAgentGlobal = useAgentStore((s) => s.setLastUsedAgentGlobal);
  const setModelForSession = useModelStore((s) => s.setModelForSession);
  const setInstanceDefaultModel = useModelStore((s) => s.setInstanceDefaultModel);
  const setVariantForSession = useThinkingStore((s) => s.setForSession);
  const setVariantDefault = useThinkingStore((s) => s.setDefault);
  const lastUsedAgentGlobal = useAgentStore((s) => s.lastUsedAgentGlobal);
  const lastUsedAgentForInstance = useAgentStore((s) =>
    s.getLastUsedAgentForInstance(instanceId),
  );

  const resolvedDefault = resolveDefaultAgentName(
    agents,
    lastUsedAgentForInstance,
    lastUsedAgentGlobal,
  );
  // displayedAgent is what the Select shows. For an existing session
  // we read its per-session pick; if missing, fall back to the
  // resolved default. For the new-session composer (sessionId=null)
  // we always show the resolved default since there's no per-session
  // entry to read yet.
  const displayedAgent = sessionId
    ? (isValidAgent(agents, selectedAgent) ? selectedAgent : resolvedDefault)
    : resolvedDefault;

  useEffect(() => {
    if (!sessionId || agents.length === 0) return;
    if (isValidAgent(agents, selectedAgent)) return;
    if (resolvedDefault) {
      setSelectedAgent(sessionId, resolvedDefault, instanceId);
    }
  }, [
    agents,
    sessionId,
    selectedAgent,
    setSelectedAgent,
    resolvedDefault,
    instanceId,
  ]);

  return (
    <Select
      aria-label="Agent"
      placeholder={isLoading ? "Loading agents..." : "Select agent"}
      className="w-full min-w-0"
      selectedKey={displayedAgent}
      onSelectionChange={(key) => {
        if (!key) return;
        const name = String(key);
        if (sessionId) {
          setSelectedAgent(sessionId, name, instanceId);
        } else {
          // new-session composer: persist the pick as the new default
          // so resolveDefaultAgent reads it back at submit time and
          // the display stays consistent with what the user clicked.
          setLastUsedAgentForInstance(instanceId, name);
          setLastUsedAgentGlobal(name);
        }
        const picked = agents.find((a) => a.name === name) as
          | (Agent & {
              model?: { providerID?: string; modelID?: string } | null;
              variant?: string | null;
            })
          | undefined;
        if (picked?.model?.providerID && picked.model.modelID) {
          const key = `${picked.model.providerID}/${picked.model.modelID}`;
          if (sessionId) setModelForSession(sessionId, key, instanceId);
          else setInstanceDefaultModel(key, instanceId);
          let nextVariant: string | undefined;
          if (typeof picked.variant === "string") {
            nextVariant = picked.variant;
          } else {
            const available = variantsForModel(
              (providersData ?? undefined) as Parameters<typeof variantsForModel>[0],
              picked.model.providerID,
              picked.model.modelID,
            );
            nextVariant = pickClosestVariant(currentVariant, available);
          }
          if (nextVariant !== undefined && nextVariant !== currentVariant) {
            if (sessionId) setVariantForSession(sessionId, nextVariant);
            else setVariantDefault(nextVariant);
          }
        }
      }}
    >
      <SelectTrigger
        className="w-full min-w-0 text-xs sm:text-sm"
        title={selectedAgent ? `Agent: ${selectedAgent}` : "Select agent"}
      >
        <SelectValue
          data-slot="select-value"
          className="truncate text-start text-sm/6 data-placeholder:text-muted-fg [&_[slot=description]]:hidden"
        >
          {({ defaultChildren, selectedText, isPlaceholder }) => {
            if (isPlaceholder) return defaultChildren;
            const text = String(selectedText ?? "");
            return shortenOmoAgent ? shortenOmoAgentName(text) || text : text;
          }}
        </SelectValue>
        <ChevronUpDownIcon
          data-slot="chevron"
          className="-mr-1 ml-auto size-5 text-muted-fg sm:size-4"
        />
      </SelectTrigger>
      <Popover className="entering:fade-in exiting:fade-out flex max-h-[min(50vh,24rem)] min-w-(--trigger-width) w-screen max-w-[calc(100vw-1.5rem)] sm:max-w-md entering:animate-in exiting:animate-out flex-col overflow-hidden rounded-lg border bg-overlay">
        <Dialog aria-label="Agent">
          <Autocomplete>
            <ListBox
              items={agents}
              className="grid max-h-[min(45vh,22rem)] w-full grid-cols-[auto_1fr] flex-col gap-y-0.5 overflow-y-auto p-1 text-xs outline-hidden sm:text-sm"
            >
              {(agent) => (
                <SelectItem id={agent.name} textValue={agent.name}>
                  <SelectLabel>{agent.name}</SelectLabel>
                  {agent.description && (
                    <div
                      slot="description"
                      className="col-start-2 row-start-2 text-muted-fg text-[10px] leading-tight sm:text-xs"
                    >
                      {agent.description}
                    </div>
                  )}
                </SelectItem>
              )}
            </ListBox>
          </Autocomplete>
        </Dialog>
      </Popover>
    </Select>
  );
}

import { useEffect } from "react";
import { Autocomplete, ListBox, Popover } from "react-aria-components";
import { Dialog } from "@/components/ui/dialog";
import {
  Select,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import { useAgents } from "@/hooks/use-opencode";
import { useAgentStore } from "@/stores/agent-store";
import { useInstanceStore } from "@/stores/instance-store";
import type { Agent } from "@opencode-ai/sdk";

interface AgentSelectProps {
  sessionId: string | null;
}

function isValidAgent(agents: Agent[], name?: string | null) {
  if (!name) return false;
  return agents.some((agent) => agent.name === name);
}

// Layered last-used resolution for brand-new sessions:
//   1. agent already chosen for THIS session (handled before this is called)
//   2. agent last picked on THIS server (lastUsedForInstance)
//   3. agent last picked GLOBALLY (lastUsedGlobal)
//   4. user-configured defaultName ("plan" by default)
//   5. hard fallback: first available agent
function resolveDefaultAgentName(
  agents: Agent[],
  strategy: "specific" | "last-used",
  defaultName: string,
  lastUsedForInstance: string | null,
  lastUsedGlobal: string | null,
) {
  if (agents.length === 0) return undefined;

  if (strategy === "last-used") {
    if (isValidAgent(agents, lastUsedForInstance)) return lastUsedForInstance!;
    if (isValidAgent(agents, lastUsedGlobal)) return lastUsedGlobal!;
  }
  if (isValidAgent(agents, defaultName)) return defaultName;
  return agents.find((agent) => agent.name === "plan")?.name ?? agents[0]?.name;
}

export function AgentSelect({ sessionId }: AgentSelectProps) {
  const { data, isLoading } = useAgents();
  const agents = (data ?? []) as Agent[];

  const instance = useInstanceStore((s) => s.instance);
  const instanceId = instance?.id ?? null;

  const selectedAgent = useAgentStore((s) => s.getSelectedAgent(sessionId));
  const setSelectedAgent = useAgentStore((s) => s.setSelectedAgent);
  const defaultAgentStrategy = useAgentStore((s) => s.defaultAgentStrategy);
  const defaultAgentName = useAgentStore((s) => s.defaultAgentName);
  const lastUsedAgentGlobal = useAgentStore((s) => s.lastUsedAgentGlobal);
  const lastUsedAgentForInstance = useAgentStore((s) =>
    s.getLastUsedAgentForInstance(instanceId),
  );

  useEffect(() => {
    if (!sessionId || agents.length === 0) return;
    if (isValidAgent(agents, selectedAgent)) return;

    const fallback = resolveDefaultAgentName(
      agents,
      defaultAgentStrategy,
      defaultAgentName,
      lastUsedAgentForInstance,
      lastUsedAgentGlobal,
    );
    if (fallback) {
      setSelectedAgent(sessionId, fallback, instanceId);
    }
  }, [
    agents,
    sessionId,
    selectedAgent,
    setSelectedAgent,
    defaultAgentStrategy,
    defaultAgentName,
    lastUsedAgentForInstance,
    lastUsedAgentGlobal,
    instanceId,
  ]);

  return (
    <Select
      aria-label="Agent"
      placeholder={isLoading ? "Loading agents..." : "Select agent"}
      className="w-full min-w-0"
      selectedKey={selectedAgent}
      onSelectionChange={(key) => {
        if (sessionId && key) {
          setSelectedAgent(sessionId, String(key), instanceId);
        }
      }}
    >
      <SelectTrigger className="w-full min-w-0 text-xs sm:text-sm" />
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

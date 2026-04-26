import { useEffect } from "react";
import { Autocomplete, ListBox, Popover } from "react-aria-components";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { Dialog } from "@/components/ui/dialog";
import {
  Select,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import { useAgents } from "@/hooks/use-opencode";
import { useAgentStore } from "@/stores/agent-store";
import type { Agent } from "@opencode-ai/sdk";

interface AgentSelectProps {
  sessionId: string | null;
}

function isValidAgent(agents: Agent[], name?: string | null) {
  if (!name) return false;
  return agents.some((agent) => agent.name === name);
}

function resolveDefaultAgentName(
  agents: Agent[],
  strategy: "specific" | "last-used",
  defaultName: string,
  lastUsed: string | null,
) {
  if (agents.length === 0) return undefined;

  if (strategy === "last-used" && isValidAgent(agents, lastUsed)) {
    return lastUsed!;
  }
  if (isValidAgent(agents, defaultName)) return defaultName;
  return agents.find((agent) => agent.name === "plan")?.name ?? agents[0]?.name;
}

export function AgentSelect({ sessionId }: AgentSelectProps) {
  const { data, isLoading } = useAgents();
  const agents = (data ?? []) as Agent[];

  const selectedAgent = useAgentStore((s) => s.getSelectedAgent(sessionId));
  const setSelectedAgent = useAgentStore((s) => s.setSelectedAgent);
  const defaultAgentStrategy = useAgentStore((s) => s.defaultAgentStrategy);
  const defaultAgentName = useAgentStore((s) => s.defaultAgentName);
  const lastUsedAgent = useAgentStore((s) => s.lastUsedAgent);

  useEffect(() => {
    if (!sessionId || agents.length === 0) return;
    if (isValidAgent(agents, selectedAgent)) return;

    const fallback = resolveDefaultAgentName(
      agents,
      defaultAgentStrategy,
      defaultAgentName,
      lastUsedAgent,
    );
    if (fallback) {
      setSelectedAgent(sessionId, fallback);
    }
  }, [
    agents,
    sessionId,
    selectedAgent,
    setSelectedAgent,
    defaultAgentStrategy,
    defaultAgentName,
    lastUsedAgent,
  ]);

  return (
    <Select
      aria-label="Agent"
      placeholder={isLoading ? "Loading agents..." : "Select agent"}
      className="w-full min-w-0"
      selectedKey={selectedAgent}
      onSelectionChange={(key) => {
        if (sessionId && key) {
          setSelectedAgent(sessionId, String(key));
        }
      }}
    >
      <SelectTrigger className="w-full min-w-0 text-xs sm:text-sm" />
      <Popover className="entering:fade-in exiting:fade-out flex max-h-[min(50vh,24rem)] w-(--trigger-width) entering:animate-in exiting:animate-out flex-col overflow-hidden rounded-lg border bg-overlay">
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
                      title={agent.description}
                      className="col-start-2 row-start-2 flex items-center gap-1 text-muted-fg text-[10px] leading-tight sm:text-xs"
                    >
                      <span className="truncate">{agent.description}</span>
                      <InformationCircleIcon className="shrink-0 size-3 sm:size-4 opacity-60" />
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

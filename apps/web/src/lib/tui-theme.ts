import type React from "react";

// OpenCode's TUI draws each user message with a bar in the color of the
// agent that ran it. This is the TUI's own rule (`local.agent.color()`):
// among the agents that are not hidden, one with a `color` uses it - a
// "#hex" value or the name of a theme color - and one without takes one
// of seven theme colors by its position in the list.
//
// vibeterm-api's agent list carries no colors at all: plugin agents such
// as OMO's exist only inside a running opencode, so it cannot know them.
// When no agent in the list has a color, every bar takes the first of
// the seven, which is also what the TUI does for an agent it cannot find,
// rather than a position-derived color the TUI itself would never show.

const POSITION_COLORS = [
  "secondary",
  "accent",
  "success",
  "warning",
  "primary",
  "error",
  "info",
] as const;

interface AgentLike {
  name?: unknown;
  color?: unknown;
  hidden?: unknown;
}

function themeColor(name: string): string {
  return `var(--oc-${name}, var(--oc-${POSITION_COLORS[0]}))`;
}

export function agentBarColor(
  agentName: string | undefined,
  agents: unknown,
): string {
  const visible = (Array.isArray(agents) ? agents : []).filter(
    (agent): agent is AgentLike =>
      !!agent && typeof agent === "object" && (agent as AgentLike).hidden !== true,
  );
  const index = visible.findIndex((agent) => agent.name === agentName);
  const listHasColors = visible.some((agent) => typeof agent.color === "string");
  if (index === -1 || !listHasColors) return themeColor(POSITION_COLORS[0]);
  const color = visible[index]?.color;
  if (typeof color === "string") {
    return color.startsWith("#") ? color : themeColor(color);
  }
  return themeColor(POSITION_COLORS[index % POSITION_COLORS.length] ?? POSITION_COLORS[0]);
}

// The inline style that hands a user message's bar color to `.chat-user`
// (main.css). Every surface that draws a user message uses this, so the
// bar never disagrees between the chat log and the sticky prompt.
export function userBarStyle(
  agentName: string | undefined,
  agents: unknown,
): React.CSSProperties {
  return { "--oc-user-bar": agentBarColor(agentName, agents) } as React.CSSProperties;
}

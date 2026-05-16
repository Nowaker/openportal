import { getSettings, setSetting } from "./portal-state";

const NAMESPACE = "starredMessages";

export interface StarredMessage {
  serverId: string;
  sessionId: string;
  messageId: string;
  role: "user" | "assistant";
  starredAt: number;
  snippet?: string;
  sessionTitle?: string;
  directory?: string;
}

export interface StarredMessagesConfig {
  items: StarredMessage[];
}

function emptyConfig(): StarredMessagesConfig {
  return { items: [] };
}

function isStarredMessage(raw: unknown): raw is StarredMessage {
  if (!raw || typeof raw !== "object") return false;
  const m = raw as Partial<StarredMessage>;
  return (
    typeof m.serverId === "string" &&
    typeof m.sessionId === "string" &&
    typeof m.messageId === "string" &&
    (m.role === "user" || m.role === "assistant") &&
    typeof m.starredAt === "number" &&
    (m.snippet === undefined || typeof m.snippet === "string") &&
    (m.sessionTitle === undefined || typeof m.sessionTitle === "string") &&
    (m.directory === undefined || typeof m.directory === "string")
  );
}

function readConfig(): StarredMessagesConfig {
  const raw = getSettings()[NAMESPACE];
  if (!raw || typeof raw !== "object") return emptyConfig();
  const obj = raw as Partial<StarredMessagesConfig>;
  const items = Array.isArray(obj.items)
    ? obj.items.filter(isStarredMessage)
    : [];
  return { items };
}

function writeConfig(config: StarredMessagesConfig): StarredMessagesConfig {
  setSetting(NAMESPACE, config);
  return config;
}

export function getStarredMessages(): StarredMessage[] {
  return readConfig().items;
}

function keyFor(m: Pick<StarredMessage, "serverId" | "messageId">): string {
  return `${m.serverId}::${m.messageId}`;
}

export function addStarredMessage(entry: StarredMessage): StarredMessage[] {
  const config = readConfig();
  const k = keyFor(entry);
  const filtered = config.items.filter((m) => keyFor(m) !== k);
  filtered.push(entry);
  return writeConfig({ items: filtered }).items;
}

export function removeStarredMessage(
  serverId: string,
  messageId: string,
): StarredMessage[] {
  const config = readConfig();
  const k = keyFor({ serverId, messageId });
  const filtered = config.items.filter((m) => keyFor(m) !== k);
  return writeConfig({ items: filtered }).items;
}

export function isStarred(serverId: string, messageId: string): boolean {
  const k = keyFor({ serverId, messageId });
  return readConfig().items.some((m) => keyFor(m) === k);
}

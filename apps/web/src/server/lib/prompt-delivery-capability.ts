import { z } from "zod/v4";
import { fetchOpencode } from "./opencode-client";

const capabilitiesSchema = z.object({
  version: z.literal(1),
  prompts: z.object({ receipt: z.boolean() }).optional(),
});

export async function requiresPromptReceipt(port: number): Promise<boolean> {
  const response = await fetchOpencode(port, "/vibeterm/capabilities", { signal: AbortSignal.timeout(5_000) });
  if (response.status === 404 || (response.ok && response.headers.get("content-type")?.includes("text/html"))) return false;
  if (!response.ok) throw new Error(`Delivery capability discovery failed (HTTP ${response.status})`);
  return capabilitiesSchema.parse(await response.json()).prompts?.receipt === true;
}

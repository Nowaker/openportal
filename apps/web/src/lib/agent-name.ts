// OMO agents use a "Family - Mode" naming convention (e.g.
// "Sisyphus - ultraworker", "Atlas - Plan Executor"). The family
// name alone is what the user identifies them by. The collapsed
// composer trigger and the chat-log meta line both have tight
// horizontal real estate, so dropping the mode suffix keeps the
// row scannable. Non-OMO agents (build, plan, general, ...) have
// no " - " separator and pass through untouched.

export function shortenOmoAgentName(full: string): string {
  if (!full) return full;
  const idx = full.indexOf(" - ");
  if (idx <= 0) return full;
  return full.slice(0, idx).trim();
}

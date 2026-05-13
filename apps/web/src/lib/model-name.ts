// The Select trigger's collapsed view sits in the composer between Mode
// and Thinking Effort, so vertical bar real estate is tight. Vendor
// prefixes ("Claude ", "GPT-", "Gemini ") and the "(default)" suffix
// each cost characters the user can already infer from context: they
// know which providers they enabled, and they configured the default
// themselves. Stripping both leaves the part that actually identifies
// which model this turn is using - "Opus 4.7", "Sonnet 4.5", "GPT-5.5".
//
// Applied to the COLLAPSED trigger only. The expanded dropdown items
// keep the full label so the user can still scan by vendor and see
// the (default) marker.

const VENDOR_PREFIX =
  /^(Claude|GPT|OpenAI|Gemini|Mistral|Llama|Grok|DeepSeek|Qwen|Cohere|Phi|Yi)\s+/i;
const DEFAULT_SUFFIX = /\s*\(default\)\s*$/i;

export function shortenModelName(full: string): string {
  if (!full) return full;
  return full.replace(VENDOR_PREFIX, "").replace(DEFAULT_SUFFIX, "").trim();
}

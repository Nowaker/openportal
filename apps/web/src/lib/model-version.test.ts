import { describe, expect, test } from "bun:test";
import {
  compareModelVersion,
  groupByFamily,
  parseModelId,
  resolveModelInFamily,
} from "./model-version";

describe("parseModelId", () => {
  test("anthropic Opus", () => {
    const p = parseModelId("anthropic", "claude-opus-4-7");
    expect(p.family).toBe("Opus");
    expect(p.familyKey).toBe("anthropic:opus");
    expect(p.versionNumeric).toEqual([4, 7]);
    expect(p.versionDisplay).toBe("4.7");
    expect(p.betaStatus).toBeNull();
  });

  test("anthropic Opus Fast (multi-token family prefix)", () => {
    const p = parseModelId("anthropic", "claude-opus-fast-4-7");
    expect(p.family).toBe("Opus Fast");
    expect(p.familyKey).toBe("anthropic:opus-fast");
    expect(p.versionNumeric).toEqual([4, 7]);
  });

  test("anthropic Sonnet / Haiku", () => {
    expect(parseModelId("anthropic", "claude-sonnet-4-6").family).toBe("Sonnet");
    expect(parseModelId("anthropic", "claude-haiku-4-5").family).toBe("Haiku");
  });

  test("openai gpt-5.5 (single dotted token)", () => {
    const p = parseModelId("openai", "gpt-5.5");
    expect(p.family).toBe("GPT");
    expect(p.familyKey).toBe("openai:");
    expect(p.versionDisplay).toBe("5.5");
  });

  test("openai gpt-5-nano (version-then-modifier)", () => {
    const p = parseModelId("openai", "gpt-5-nano");
    expect(p.family).toBe("GPT Nano");
    expect(p.familyKey).toBe("openai:nano");
    expect(p.versionDisplay).toBe("5.0");
    expect(p.versionNumeric).toEqual([5]);
  });

  test("openai gpt-5-nano-2025-08-07 (date suffix stripped)", () => {
    const p = parseModelId("openai", "gpt-5-nano-2025-08-07");
    expect(p.family).toBe("GPT Nano");
    expect(p.versionDisplay).toBe("5.0");
  });

  test("openai gpt-5.4-nano-2026-03-17 (date suffix + dotted version)", () => {
    const p = parseModelId("openai", "gpt-5.4-nano-2026-03-17");
    expect(p.family).toBe("GPT Nano");
    expect(p.versionDisplay).toBe("5.4");
  });

  test("openai gpt-5.4-mini-fast (multi-token modifier)", () => {
    const p = parseModelId("openai", "gpt-5.4-mini-fast");
    expect(p.family).toBe("GPT Mini Fast");
    expect(p.familyKey).toBe("openai:mini-fast");
    expect(p.versionDisplay).toBe("5.4");
  });

  test("openai gpt-5-pro", () => {
    const p = parseModelId("openai", "gpt-5-pro");
    expect(p.family).toBe("GPT Pro");
    expect(p.versionDisplay).toBe("5.0");
  });

  test("google gemini-3.1-pro-preview (beta marker stripped)", () => {
    const p = parseModelId("google", "gemini-3.1-pro-preview");
    expect(p.family).toBe("Gemini Pro");
    expect(p.familyKey).toBe("google:pro");
    expect(p.versionDisplay).toBe("3.1");
    expect(p.betaStatus).toBe("preview");
  });

  test("google gemini-2.5-flash-image (no beta)", () => {
    const p = parseModelId("google", "gemini-2.5-flash-image");
    expect(p.family).toBe("Gemini Flash Image");
    expect(p.versionDisplay).toBe("2.5");
    expect(p.betaStatus).toBeNull();
  });

  test("google gemini-2.5-flash-preview-tts (beta stripped, tts kept)", () => {
    const p = parseModelId("google", "gemini-2.5-flash-preview-tts");
    expect(p.family).toBe("Gemini Flash Tts");
    expect(p.betaStatus).toBe("preview");
  });

  test("google gemini-3.1-flash-lite-preview", () => {
    const p = parseModelId("google", "gemini-3.1-flash-lite-preview");
    expect(p.family).toBe("Gemini Flash Lite");
    expect(p.versionDisplay).toBe("3.1");
    expect(p.betaStatus).toBe("preview");
  });

  test("unknown provider falls back to raw ID", () => {
    const p = parseModelId("xprovider", "weird-model-id");
    expect(p.family).toBe("weird-model-id");
    expect(p.familyKey).toBe("xprovider:weird-model-id");
    expect(p.versionNumeric).toEqual([]);
  });

  test("opencode provider uses GPT-style parsing", () => {
    const p = parseModelId("opencode", "gpt-5-nano");
    expect(p.family).toBe("GPT Nano");
    expect(p.versionDisplay).toBe("5.0");
  });

  test("anthropic claude-opus-4-20250514 (8-digit YYYYMMDD stripped)", () => {
    const p = parseModelId("anthropic", "claude-opus-4-20250514");
    expect(p.family).toBe("Opus");
    expect(p.versionDisplay).toBe("4.0");
    expect(p.versionNumeric).toEqual([4]);
  });

  test("anthropic claude-opus-4-1-20250805 (8-digit YYYYMMDD stripped from minor)", () => {
    const p = parseModelId("anthropic", "claude-opus-4-1-20250805");
    expect(p.family).toBe("Opus");
    expect(p.versionDisplay).toBe("4.1");
  });

  test("anthropic claude-opus-4-7-fast (fast as family suffix)", () => {
    const p = parseModelId("anthropic", "claude-opus-4-7-fast");
    expect(p.family).toBe("Opus Fast");
    expect(p.familyKey).toBe("anthropic:opus-fast");
    expect(p.versionDisplay).toBe("4.7");
  });

  test("anthropic claude-3-opus-20240229 (old-style version-first + 8-digit date)", () => {
    const p = parseModelId("anthropic", "claude-3-opus-20240229");
    expect(p.family).toBe("Opus");
    expect(p.versionDisplay).toBe("3.0");
  });

  test("anthropic claude-3-5-haiku-latest (latest alias stripped)", () => {
    const p = parseModelId("anthropic", "claude-3-5-haiku-latest");
    expect(p.family).toBe("Haiku");
    expect(p.versionDisplay).toBe("3.5");
  });

  test("anthropic claude-3-5-sonnet-20241022 (old-style with hyphenated maj-min + date)", () => {
    const p = parseModelId("anthropic", "claude-3-5-sonnet-20241022");
    expect(p.family).toBe("Sonnet");
    expect(p.versionDisplay).toBe("3.5");
  });

  test("anthropic claude-opus-4-8 sorts ABOVE claude-opus-4-20250514", () => {
    const a = parseModelId("anthropic", "claude-opus-4-8");
    const b = parseModelId("anthropic", "claude-opus-4-20250514");
    expect(compareModelVersion(a, b)).toBeLessThan(0);
  });
});

describe("compareModelVersion", () => {
  const parse = (id: string) => parseModelId("anthropic", id);

  test("higher minor wins", () => {
    expect(
      compareModelVersion(parse("claude-opus-4-7"), parse("claude-opus-4-8")),
    ).toBeGreaterThan(0);
    expect(
      compareModelVersion(parse("claude-opus-4-8"), parse("claude-opus-4-7")),
    ).toBeLessThan(0);
  });

  test("higher major wins", () => {
    expect(
      compareModelVersion(parse("claude-opus-4-7"), parse("claude-opus-5-0")),
    ).toBeGreaterThan(0);
  });

  test("numeric not string ([4,10] beats [4,7])", () => {
    expect(
      compareModelVersion(
        parse("claude-opus-4-7"),
        parse("claude-opus-4-10"),
      ),
    ).toBeGreaterThan(0);
  });

  test("non-beta beats beta of same version", () => {
    expect(
      compareModelVersion(
        parseModelId("google", "gemini-3.1-pro"),
        parseModelId("google", "gemini-3.1-pro-preview"),
      ),
    ).toBeLessThan(0);
  });
});

describe("groupByFamily", () => {
  const providers = {
    providers: [
      {
        id: "anthropic",
        models: {
          "claude-opus-4-7": { id: "claude-opus-4-7" },
          "claude-opus-4-8": { id: "claude-opus-4-8" },
          "claude-opus-fast-4-7": { id: "claude-opus-fast-4-7" },
          "claude-sonnet-4-6": { id: "claude-sonnet-4-6" },
        },
      },
      {
        id: "openai",
        models: {
          "gpt-5.5": { id: "gpt-5.5" },
          "gpt-5-nano": { id: "gpt-5-nano" },
          "gpt-5.4-nano": { id: "gpt-5.4-nano" },
        },
      },
    ],
  };

  test("groups Opus + Opus Fast separately", () => {
    const g = groupByFamily(providers);
    expect(g.get("anthropic:opus")?.map((m) => m.modelID)).toEqual([
      "claude-opus-4-8",
      "claude-opus-4-7",
    ]);
    expect(g.get("anthropic:opus-fast")?.map((m) => m.modelID)).toEqual([
      "claude-opus-fast-4-7",
    ]);
  });

  test("groups GPT + GPT Nano separately, sorted latest-first", () => {
    const g = groupByFamily(providers);
    expect(g.get("openai:")?.map((m) => m.modelID)).toEqual(["gpt-5.5"]);
    expect(g.get("openai:nano")?.map((m) => m.modelID)).toEqual([
      "gpt-5.4-nano",
      "gpt-5-nano",
    ]);
  });
});

describe("resolveModelInFamily", () => {
  const groups = groupByFamily({
    providers: [
      {
        id: "anthropic",
        models: {
          "claude-opus-4-7": { id: "claude-opus-4-7" },
          "claude-opus-4-8": { id: "claude-opus-4-8" },
        },
      },
    ],
  });

  test("latest returns highest version", () => {
    expect(
      resolveModelInFamily(groups, "anthropic:opus", "latest")?.modelID,
    ).toBe("claude-opus-4-8");
  });

  test("specific returns exact version", () => {
    expect(
      resolveModelInFamily(groups, "anthropic:opus", "specific", "4.7")
        ?.modelID,
    ).toBe("claude-opus-4-7");
  });

  test("specific falls back to latest when version not found", () => {
    expect(
      resolveModelInFamily(groups, "anthropic:opus", "specific", "9.9")
        ?.modelID,
    ).toBe("claude-opus-4-8");
  });

  test("unknown family returns null", () => {
    expect(resolveModelInFamily(groups, "anthropic:unknown", "latest")).toBeNull();
  });
});

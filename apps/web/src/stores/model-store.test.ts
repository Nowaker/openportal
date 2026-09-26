import { beforeEach, describe, expect, test } from "bun:test";

import { latestMessageModel, useModelStore } from "./model-store";

const SID = "ses_test";
const INSTANCE = "srv-test";

function reset() {
  useModelStore.setState({
    selectedModelBySession: {},
    selectedAtBySession: {},
    observedModelBySession: {},
    lastUsedModelByInstance: { [INSTANCE]: "anthropic/claude-opus-5" },
    lastUsedModelGlobal: "anthropic/claude-opus-5",
    defaultModelKey: "anthropic/claude-sonnet-4-6",
  });
}

describe("latestMessageModel", () => {
  test("takes the newest model from assistant and user messages alike", () => {
    expect(
      latestMessageModel([
        { info: { role: "assistant", providerID: "openai", modelID: "gpt-6", time: { created: 1 } } },
        { info: { role: "user", model: { providerID: "anthropic", modelID: "claude-opus-5-5" }, time: { created: 3 } } },
        { info: { role: "assistant", providerID: "anthropic", modelID: "claude-opus-4-8", time: { created: 2 } } },
      ]),
    ).toEqual({ key: "anthropic/claude-opus-5-5", at: 3 });
  });

  test("ignores messages that carry no model", () => {
    expect(latestMessageModel([{ info: { role: "user", time: { created: 5 } } }])).toBeNull();
  });
});

describe("session model resolution", () => {
  beforeEach(reset);

  test("a session with no pick here follows the model its messages ran on", () => {
    useModelStore.getState().observeSessionModel(SID, { key: "anthropic/claude-opus-5-5", at: 100 });
    expect(useModelStore.getState().resolveModelKey(SID, INSTANCE)).toBe("anthropic/claude-opus-5-5");
  });

  test("a pick older than the latest message loses to it", () => {
    useModelStore.setState({
      selectedModelBySession: { [SID]: "openai/gpt-6" },
      selectedAtBySession: { [SID]: 50 },
    });
    useModelStore.getState().observeSessionModel(SID, { key: "anthropic/claude-opus-5-5", at: 100 });
    expect(useModelStore.getState().resolveModelKey(SID, INSTANCE)).toBe("anthropic/claude-opus-5-5");
  });

  test("a pick made after the latest message wins", () => {
    useModelStore.getState().observeSessionModel(SID, { key: "anthropic/claude-opus-5-5", at: 100 });
    useModelStore.getState().setModelForSession(SID, "openai/gpt-6", INSTANCE);
    expect(useModelStore.getState().resolveModelKey(SID, INSTANCE)).toBe("openai/gpt-6");
  });

  test("an older observation never replaces a newer one", () => {
    const { observeSessionModel } = useModelStore.getState();
    observeSessionModel(SID, { key: "anthropic/claude-opus-5-5", at: 100 });
    observeSessionModel(SID, { key: "anthropic/claude-opus-4-8", at: 10 });
    expect(useModelStore.getState().observedModelBySession[SID]?.key).toBe("anthropic/claude-opus-5-5");
  });

  test("a session model equal to the server default is still sent", () => {
    useModelStore.getState().observeSessionModel(SID, { key: "anthropic/claude-sonnet-4-6", at: 100 });
    expect(useModelStore.getState().isOverridingDefault(SID, INSTANCE)).toBe(true);
  });

  test("without a session model the instance pick applies", () => {
    expect(useModelStore.getState().resolveModelKey(SID, INSTANCE)).toBe("anthropic/claude-opus-5");
  });
});

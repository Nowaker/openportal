import { defineHandler } from "nitro/h3";
import { readCompanionState } from "./lib/companion-plugin-state";

export default defineHandler(() => {
  return readCompanionState();
});

import { defineHandler } from "nitro/h3";
import { clearAllOverrides } from "../lib/auto-approve-state";

export default defineHandler(() => {
  return clearAllOverrides();
});

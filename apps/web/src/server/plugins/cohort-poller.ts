import { definePlugin } from "nitro";
import { startCohortPoller } from "../lib/cohort-registry";

export default definePlugin(() => {
  startCohortPoller();
});

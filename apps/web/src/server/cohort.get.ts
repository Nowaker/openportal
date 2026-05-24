import { defineHandler } from "nitro/h3";
import { getCohortSnapshot } from "./lib/cohort-registry";

export default defineHandler(() => {
  return getCohortSnapshot();
});

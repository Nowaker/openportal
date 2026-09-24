import { defineHandler } from "nitro/h3";

import { listManagedInstanceStatus } from "../lib/managed-opencode";

export default defineHandler(() => {
  return { instances: listManagedInstanceStatus() };
});

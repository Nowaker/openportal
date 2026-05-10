import { definePlugin } from "nitro";
import { ensurePortalLayout } from "../lib/portal-paths";

// Boot-time hook: make sure ~/.openportal/ exists, the legacy
// ~/.openportal.json gets migrated into ~/.openportal/openportal.json,
// and the gitignore protecting auth file is in place. Cheap and
// idempotent — every config reader also calls ensurePortalLayout()
// lazily, but doing it here means the migration fires the moment the
// server starts rather than on first request.
export default definePlugin(() => {
  ensurePortalLayout();
});

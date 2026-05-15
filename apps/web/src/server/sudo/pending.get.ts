// GET /api/sudo/pending - list pending sudo requests awaiting a
// password from the web modal. Returns only metadata (command,
// reason, request_id, age) - no password fields exist on the
// server side until the browser POSTs to /api/sudo/answer/:id, and
// even then they are not stored in this map.
//
// Polled by SudoPromptModal (Phase C) every 1s while the modal is
// mounted in _app.tsx. Empty list = nothing to do.

import { defineHandler } from "nitro/h3";
import { listPendingSudo } from "../lib/sudo-pending";

export default defineHandler(() => {
  return { entries: listPendingSudo() };
});

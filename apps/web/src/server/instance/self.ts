import { defineHandler } from "nitro/h3";
import { buildSelfPayload } from "../lib/self-instance";

// /api/instance/self — which server is this Portal UI bound to?
//
// The payload builder lives in server/lib/self-instance.ts because
// POST /api/servers/bind answers with the identical body: a
// permalink-driven server switch hands the browser its new self-state in
// the same round-trip that performed the switch. One definition, two
// callers. See that module for the resolution order and the meaning of
// the client / presence / health fields.
export default defineHandler(async (event) => buildSelfPayload(event));

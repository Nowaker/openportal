import { defineHandler, setResponseStatus } from "nitro/h3";
import { getForkJob } from "../../../lib/fork-jobs";
import { parsePort, parseRouteParam } from "../../../lib/validation";

// Status poll for a fork job started by POST .../session/:id/fork. Short,
// cheap request the client hits every couple seconds while opencode copies
// the conversation server-side. Returns { status, forkId, error }; 404 once
// the job has expired or never existed (e.g. portal restarted mid-fork).
export default defineHandler((event) => {
  const port = parsePort(event);
  const jobId = parseRouteParam(event, "jobId");

  const snapshot = getForkJob(port, jobId);
  if (!snapshot) {
    setResponseStatus(event, 404);
    return { error: "fork job not found" };
  }
  return snapshot;
});

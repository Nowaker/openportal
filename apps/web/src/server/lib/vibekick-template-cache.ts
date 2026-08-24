import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import type {
  FsTemplate,
  TemplateSnapshot,
  TemplateVersion,
} from "../../lib/vibekick-template-contract";
import {
  canonicalWorkspaceKey,
  scanWorkspaceTemplateBatches,
} from "./vibekick-template-scan";
import {
  isPathWithin,
  normalizeWorkspaceRoots,
  rehomeFsTemplate,
} from "./vibekick-template-paths";
import { startTemplateCacheRefreshLoop } from "./vibekick-template-cache-refresh";
import { TemplateSnapshotStore } from "./vibekick-template-snapshot-store";
import {
  createCompletedTemplateScanSubscription,
  createTemplateScanSubscriber,
  createTemplateScanSubscription,
  queueTemplateScanBatch,
  wakeTemplateScanSubscriber,
  type TemplateScanSubscriber,
  type TemplateScanSubscription,
  type TerminalTemplateScanEvent,
} from "./vibekick-template-subscription";

export type { TemplateScanSubscription } from "./vibekick-template-subscription";

type ScanJob = {
  readonly key: string;
  readonly workspaces: readonly string[];
  readonly candidate: Map<string, FsTemplate>;
  readonly removedLocations: Set<string>;
  readonly subscribers: Set<TemplateScanSubscriber>;
  readonly unreadableDirectories: Set<string>;
  revision: number;
  completion: Promise<TemplateSnapshot | null>;
  failure: Error | null;
  terminal: TerminalTemplateScanEvent | null;
};

class TemplateScanFailedError extends Error {
  override readonly name = "TemplateScanFailedError";
}

class TemplateScanSupersededError extends Error {
  override readonly name = "TemplateScanSupersededError";
}

const activeJobs = new Map<string, ScanJob>();
const snapshots = new TemplateSnapshotStore();
let latestWorkspaceKey: string | null = null;

function workspacesContainLocation(
  workspaces: readonly string[],
  location: string,
): boolean {
  return workspaces.some((workspace) => isPathWithin(location, workspace));
}

function attachSubscriber(job: ScanJob): TemplateScanSubscription {
  const version = snapshots.versionAt(job.revision);
  const templatesByLocation = new Map<string, FsTemplate>();
  const completed = snapshots.completed;
  for (const template of completed?.templates ?? []) {
    const current = rehomeFsTemplate(template, job.workspaces);
    if (current) templatesByLocation.set(current.location, current);
  }
  for (const template of job.candidate.values()) {
    templatesByLocation.set(template.location, template);
  }
  for (const location of job.removedLocations) {
    templatesByLocation.delete(location);
  }
  const subscriber = createTemplateScanSubscriber({
    start: { type: "start", workspaces: job.workspaces, ...version },
    templates: templatesByLocation.values(),
    removedLocations: job.removedLocations,
    batchVersion: version,
    terminal: job.terminal,
  });
  job.subscribers.add(subscriber);
  return createTemplateScanSubscription(subscriber, () => {
    job.subscribers.delete(subscriber);
  });
}

function emitBatch(
  job: ScanJob,
  templates: readonly FsTemplate[],
  removedLocations: readonly string[] = [],
): void {
  for (const location of removedLocations) {
    job.candidate.delete(location);
    job.removedLocations.add(location);
  }
  for (const template of templates) {
    job.removedLocations.delete(template.location);
    job.candidate.set(template.location, template);
  }
  const version = snapshots.versionAt(job.revision);
  for (const subscriber of job.subscribers) {
    queueTemplateScanBatch(subscriber, {
      templates,
      removedLocations,
      version,
    });
  }
}

function finishJob(job: ScanJob, terminal: TerminalTemplateScanEvent): void {
  job.terminal = terminal;
  for (const subscriber of job.subscribers) {
    subscriber.terminal = terminal;
    wakeTemplateScanSubscriber(subscriber);
  }
  if (activeJobs.get(job.key) === job) activeJobs.delete(job.key);
}

function retainUnreadableTemplates(job: ScanJob): void {
  const completed = snapshots.completed;
  if (!completed) return;
  for (const template of completed.templates) {
    const current = rehomeFsTemplate(template, job.workspaces);
    if (!current) continue;
    const unreadable = [...job.unreadableDirectories].some((directory) =>
      isPathWithin(current.location, directory),
    );
    if (
      unreadable &&
      !job.removedLocations.has(current.location) &&
      !job.candidate.has(current.location)
    ) {
      job.candidate.set(current.location, current);
    }
  }
}

async function runJob(job: ScanJob): Promise<TemplateSnapshot | null> {
  await yieldToEventLoop();
  try {
    for await (const batch of scanWorkspaceTemplateBatches(job.workspaces)) {
      for (const directory of batch.unreadableDirectories) {
        job.unreadableDirectories.add(directory);
      }
      emitBatch(job, batch.templates);
    }
    if (latestWorkspaceKey !== job.key) {
      throw new TemplateScanSupersededError(
        "Workspace configuration changed during the filesystem template scan",
      );
    }
    retainUnreadableTemplates(job);
    const snapshot = snapshots.commit(job.workspaces, job.candidate.values());
    finishJob(job, { type: "complete", snapshot });
    return snapshot;
  } catch (error) {
    job.failure =
      error instanceof Error
        ? error
        : new TemplateScanFailedError("Filesystem template scan failed");
    finishJob(job, { type: "failed", error: job.failure.message });
    return null;
  }
}

function startJob(workspaces: readonly string[]): ScanJob {
  const normalizedWorkspaces = normalizeWorkspaceRoots(workspaces);
  const key = canonicalWorkspaceKey(normalizedWorkspaces);
  const active = activeJobs.get(key);
  if (active) return active;
  latestWorkspaceKey = key;
  const job: ScanJob = {
    key,
    workspaces: normalizedWorkspaces,
    candidate: new Map(),
    removedLocations: new Set(),
    subscribers: new Set(),
    unreadableDirectories: new Set(),
    revision: snapshots.currentRevision,
    completion: Promise.resolve(null),
    failure: null,
    terminal: null,
  };
  activeJobs.set(key, job);
  job.completion = runJob(job);
  return job;
}

async function awaitJob(job: ScanJob): Promise<TemplateSnapshot> {
  const snapshot = await job.completion;
  if (snapshot) return snapshot;
  throw (
    job.failure ??
    new TemplateScanFailedError("Filesystem template scan failed")
  );
}

export function subscribeTemplateScan(
  workspaces: readonly string[],
  options: { readonly force: boolean },
): TemplateScanSubscription {
  const key = canonicalWorkspaceKey(workspaces);
  const active = activeJobs.get(key);
  if (active) return attachSubscriber(active);
  const completed = snapshots.completed;
  if (
    !options.force &&
    completed &&
    canonicalWorkspaceKey(completed.workspaces) === key
  ) {
    return createCompletedTemplateScanSubscription(completed);
  }
  return attachSubscriber(startJob(workspaces));
}

export async function getTemplateSnapshot(
  workspaces: readonly string[],
): Promise<TemplateSnapshot> {
  const key = canonicalWorkspaceKey(workspaces);
  const completed = snapshots.completed;
  if (completed && canonicalWorkspaceKey(completed.workspaces) === key) {
    return completed;
  }
  const active = activeJobs.get(key);
  if (active) return awaitJob(active);
  return awaitJob(startJob(workspaces));
}

export function forceTemplateSnapshot(
  workspaces: readonly string[],
): Promise<TemplateSnapshot> {
  return awaitJob(startJob(workspaces));
}

export function applyTemplateUpdate(template: FsTemplate): TemplateVersion {
  const version = snapshots.applyUpdate(template);
  for (const job of activeJobs.values()) {
    if (!workspacesContainLocation(job.workspaces, template.location)) continue;
    job.revision = version.revision;
    emitBatch(job, [template]);
  }
  return version;
}

export function applyTemplateDelete(location: string): TemplateVersion {
  const version = snapshots.applyDelete(location);
  for (const job of activeJobs.values()) {
    if (!workspacesContainLocation(job.workspaces, location)) continue;
    job.revision = version.revision;
    emitBatch(job, [], [location]);
  }
  return version;
}

export function resetTemplateCacheForTests(): void {
  activeJobs.clear();
  snapshots.reset();
  latestWorkspaceKey = null;
}

export async function refreshCompletedTemplateSnapshot(): Promise<void> {
  const completed = snapshots.completed;
  if (!completed || activeJobs.size > 0) return;
  await forceTemplateSnapshot(completed.workspaces);
}

startTemplateCacheRefreshLoop(refreshCompletedTemplateSnapshot);

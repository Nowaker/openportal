import {
  sortFsTemplates,
  type FsTemplate,
  type TemplateScanEvent,
  type TemplateSnapshot,
  type TemplateVersion,
} from "../../lib/vibekick-template-contract";

export type TerminalTemplateScanEvent = Extract<
  TemplateScanEvent,
  { readonly type: "complete" | "failed" }
>;

export type TemplateScanSubscription = {
  next(): Promise<TemplateScanEvent | null>;
  unsubscribe(): void;
};

export type TemplateScanSubscriber = {
  start: Extract<TemplateScanEvent, { readonly type: "start" }> | null;
  readonly pendingByLocation: Map<string, FsTemplate>;
  readonly pendingRemovedLocations: Set<string>;
  batchVersion: TemplateVersion;
  terminal: TerminalTemplateScanEvent | null;
  terminalDelivered: boolean;
  waiting: ((event: TemplateScanEvent | null) => void) | null;
  closed: boolean;
};

type TemplateScanSubscriberSeed = {
  readonly start: Extract<TemplateScanEvent, { readonly type: "start" }>;
  readonly templates: Iterable<FsTemplate>;
  readonly removedLocations: Iterable<string>;
  readonly batchVersion: TemplateVersion;
  readonly terminal: TerminalTemplateScanEvent | null;
};

type TemplateScanBatchUpdate = {
  readonly templates: readonly FsTemplate[];
  readonly removedLocations: readonly string[];
  readonly version: TemplateVersion;
};

class TemplateScanPullError extends Error {
  override readonly name = "TemplateScanPullError";
}

function nextQueuedEvent(
  subscriber: TemplateScanSubscriber,
): TemplateScanEvent | null | undefined {
  if (subscriber.closed) return null;
  if (subscriber.start) {
    const start = subscriber.start;
    subscriber.start = null;
    return start;
  }
  if (
    subscriber.pendingByLocation.size > 0 ||
    subscriber.pendingRemovedLocations.size > 0
  ) {
    const templates = sortFsTemplates(subscriber.pendingByLocation.values());
    const removedLocations = [...subscriber.pendingRemovedLocations].sort();
    subscriber.pendingByLocation.clear();
    subscriber.pendingRemovedLocations.clear();
    return {
      type: "batch",
      templates,
      removedLocations,
      ...subscriber.batchVersion,
    };
  }
  if (subscriber.terminal && !subscriber.terminalDelivered) {
    subscriber.terminalDelivered = true;
    return subscriber.terminal;
  }
  return subscriber.terminalDelivered ? null : undefined;
}

export function wakeTemplateScanSubscriber(
  subscriber: TemplateScanSubscriber,
): void {
  if (!subscriber.waiting) return;
  const event = nextQueuedEvent(subscriber);
  if (event === undefined) return;
  const resolve = subscriber.waiting;
  subscriber.waiting = null;
  resolve(event);
}

export function createTemplateScanSubscription(
  subscriber: TemplateScanSubscriber,
  onUnsubscribe?: () => void,
): TemplateScanSubscription {
  return {
    next() {
      const event = nextQueuedEvent(subscriber);
      if (event !== undefined) return Promise.resolve(event);
      if (subscriber.waiting) {
        return Promise.reject(
          new TemplateScanPullError(
            "Concurrent stream pulls are not supported",
          ),
        );
      }
      return new Promise((resolve) => {
        subscriber.waiting = resolve;
      });
    },
    unsubscribe() {
      onUnsubscribe?.();
      subscriber.closed = true;
      subscriber.pendingByLocation.clear();
      subscriber.pendingRemovedLocations.clear();
      wakeTemplateScanSubscriber(subscriber);
    },
  };
}

export function createTemplateScanSubscriber(
  seed: TemplateScanSubscriberSeed,
): TemplateScanSubscriber {
  const pendingByLocation = new Map(
    Array.from(seed.templates, (template) => [template.location, template]),
  );
  const pendingRemovedLocations = new Set(seed.removedLocations);
  for (const location of pendingRemovedLocations) {
    pendingByLocation.delete(location);
  }
  return {
    start: seed.start,
    pendingByLocation,
    pendingRemovedLocations,
    batchVersion: seed.batchVersion,
    terminal: seed.terminal,
    terminalDelivered: false,
    waiting: null,
    closed: false,
  };
}

export function createCompletedTemplateScanSubscription(
  snapshot: TemplateSnapshot,
): TemplateScanSubscription {
  const version = {
    serverStartedAt: snapshot.serverStartedAt,
    revision: snapshot.revision,
  };
  return createTemplateScanSubscription(
    createTemplateScanSubscriber({
      start: { type: "start", workspaces: snapshot.workspaces, ...version },
      templates: snapshot.templates,
      removedLocations: [],
      batchVersion: version,
      terminal: { type: "complete", snapshot },
    }),
  );
}

export function queueTemplateScanBatch(
  subscriber: TemplateScanSubscriber,
  update: TemplateScanBatchUpdate,
): void {
  for (const location of update.removedLocations) {
    subscriber.pendingByLocation.delete(location);
    subscriber.pendingRemovedLocations.add(location);
  }
  for (const template of update.templates) {
    subscriber.pendingRemovedLocations.delete(template.location);
    subscriber.pendingByLocation.set(template.location, template);
  }
  subscriber.batchVersion = update.version;
  wakeTemplateScanSubscriber(subscriber);
}

import {
  sortFsTemplates,
  type FsTemplate,
  type TemplateSnapshot,
  type TemplateVersion,
} from "../../lib/vibekick-template-contract";
import { isPathWithin } from "./vibekick-template-paths";

export class TemplateSnapshotStore {
  readonly serverStartedAt = Date.now();
  private revision = 0;
  private snapshot: TemplateSnapshot | null = null;

  get completed(): TemplateSnapshot | null {
    return this.snapshot;
  }

  get currentRevision(): number {
    return this.revision;
  }

  versionAt(revision = this.revision): TemplateVersion {
    return { serverStartedAt: this.serverStartedAt, revision };
  }

  commit(
    workspaces: readonly string[],
    templates: Iterable<FsTemplate>,
  ): TemplateSnapshot {
    const version = this.nextVersion();
    this.snapshot = {
      workspaces,
      templates: sortFsTemplates(templates),
      builtAt: Date.now(),
      ...version,
    };
    return this.snapshot;
  }

  applyUpdate(template: FsTemplate): TemplateVersion {
    const version = this.nextVersion();
    const snapshot = this.snapshot;
    if (
      !snapshot ||
      !snapshot.workspaces.some((workspace) =>
        isPathWithin(template.location, workspace),
      )
    ) {
      return version;
    }
    const templates = new Map(
      snapshot.templates.map((current) => [current.location, current]),
    );
    templates.set(template.location, template);
    this.snapshot = {
      ...snapshot,
      templates: sortFsTemplates(templates.values()),
      ...version,
    };
    return version;
  }

  applyDelete(location: string): TemplateVersion {
    const version = this.nextVersion();
    const snapshot = this.snapshot;
    if (
      !snapshot ||
      !snapshot.workspaces.some((workspace) =>
        isPathWithin(location, workspace),
      )
    ) {
      return version;
    }
    this.snapshot = {
      ...snapshot,
      templates: snapshot.templates.filter(
        (template) => template.location !== location,
      ),
      ...version,
    };
    return version;
  }

  reset(): void {
    this.snapshot = null;
    this.revision = 0;
  }

  private nextVersion(): TemplateVersion {
    this.revision += 1;
    return this.versionAt();
  }
}

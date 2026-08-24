import { useState } from "react";
import { AddCustomTool } from "@/components/add-custom-tool";
import { FsTemplatesSection } from "@/components/fs-templates-settings";
import { UnifiedToolList } from "@/components/unified-tool-list";
import { useResolvedTools } from "@/hooks/use-resolved-tools";

export function ToolsSettings() {
  const tools = useResolvedTools();
  const [fsFormOpen, setFsFormOpen] = useState(false);

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs text-muted-fg">
          Templates can appear in the topbar menu, the new-session picker, and
          composer slash autocomplete. These flags control where each template
          shows up:
        </p>
        <ul className="text-xs text-muted-fg list-disc pl-5 space-y-0.5">
          <li>
            <strong>Burger</strong> - visible in the topbar templates menu.
          </li>
          <li>
            <strong>Init</strong> - shown in the new-session template list.
            Checked rows are prepended (in drag order below) to the first prompt
            on submit.
          </li>
          <li>
            <strong>Default on</strong> - pre-checked when the new-session
            template list opens. You can still uncheck it for that session.
          </li>
          <li>
            <strong>Slash</strong> - appears in the composer &quot;/&quot;
            autocomplete as <code>/template Full name</code>. Accepting it
            replaces the token with the template body.
          </li>
          <li>
            <strong>Outside</strong> - promoted out of the hamburger into the
            title bar as its own icon button (desktop, session routes). Pick the
            icon with the selector that appears when enabled.
          </li>
        </ul>
        <p className="text-xs text-muted-fg">
          Edit a system template&apos;s prompt to customise it - your edit
          survives future updates and you can hit Reset to restore the shipped
          version. Add your own templates with the button at the bottom. Drag
          the handle on any Init-marked row to reorder the init prompt.
        </p>
      </section>

      <UnifiedToolList tools={tools} />

      <FsTemplatesSection onFormOpenChange={setFsFormOpen} />

      {!fsFormOpen && (
        <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-bg border-t border-border/40">
          <AddCustomTool />
        </div>
      )}
    </div>
  );
}

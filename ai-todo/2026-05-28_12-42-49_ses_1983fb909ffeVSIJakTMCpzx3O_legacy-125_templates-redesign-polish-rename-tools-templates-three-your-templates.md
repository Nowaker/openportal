---
status: PENDING
session: ses_1983fb909ffeVSIJakTMCpzx3O
queued_at: 2026-05-28T12:42:49-05:00
legacy_number: 125
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Templates redesign polish: rename tools->templates, three Your-templates sections, visual-framework dropdown, sub-path completion, no monospace on prompt fields, horizontal label/field for small fields

User prompt (verbatim):

> section name in settings should be called "templates". anywhere we call it tools (when talking about this feature, not other), we need to use the correct term from now on.
>
> there is a section called "Your custom tools". like that one, there should be "System templates" at the beginning, then "Your templates - global" and the last one - "Your templates - filesystem"
>
> Workspace root - has a native browser dropdown. project ui rule to introduce (agents.md) - don't use native alerts, confirms, dropddowns, etc. use our visual framework, always.
>
> Sub-path under workspace (optional) - must offer path completion similar to "open session" feature. remember about the rule: DRY princple, code reuse.
>
> prompt field - both here and other forms. no monotype font. where did the idea for monotype font come from? our prompt fields are never monotype. add to agents.md, and at the very end, screen the system for other places where monotype font is used in fields, and provide a report.
>
> field label       field form
> field label2     field form2
>
> for small elements like root, path, name, description

Design notes:

- Follow-up to AI_TODO #119 (templates redesign). Scope is polish + correctness, no new features.
- **Rename "tools" -> "templates" in this feature's surface**: Settings tab name "Tools" -> "Templates", section headers, label copy. File names (tools-store.ts, prompt-tools.ts) and the topbar Tools menu stay - those are outside the templates-redesign feature surface and renaming would be churn without value. The store's localStorage key "opencode-tools" stays too (renaming loses user data).
- **Three "Your templates" sections in the unified list**: "System templates" (stock - was unlabelled), "Your templates - global" (custom from local store - was "Your custom tools"), "Your templates - filesystem" (FS-backed .vibekick/templates/*.md - was "Filesystem templates"). Matches the spec's parallel structure.
- **Visual-framework dropdown**: NewFsTemplateForm's workspace-root field is a native `<select>`. Swap for the project's <Select> component (likely from components/ui/select.tsx). Explore agent fired for the canonical pick.
- **Sub-path completion**: The sub-path input is a plain text field. The "open session" / new-session flow has directory completion - reuse that component. Explore agent fired to identify the right reusable piece. DRY principle applies; don't reinvent.
- **No monospace on prompt fields**: Drop font-mono from every prompt textarea in tools-settings.tsx (and any other prompt-shaped field that has it). Audit explore agent fired to catalog every monospace-on-form-field occurrence in apps/web/src and classify legitimate-vs-wrong.
- **Horizontal label/field layout**: For SMALL fields (workspace root, sub-path, name, description) use "label    field" on one line instead of label-on-top-of-field. Multi-line textareas (prompt) keep the stacked layout - horizontal doesn't fit a tall field. Specific class change: drop `space-y-1` + remove the standalone `<label>` line, switch to a flex row with the label sized to the left.
- **AGENTS.md additions**:
  - Under "UX preferences" - new rule: "Never use native alerts/confirms/dropdowns/file pickers. Always use the project's visual framework components."
  - Same section - new rule: "Prompt fields are NEVER monospace. Code/path/log fields can be; prompts cannot."
- Plan:
  1. AI_TODO entry (this commit, AI_TODO-only)
  2. Wait for the three explore agents
  3. AGENTS.md rule additions
  4. tools-settings.tsx rewrite for renaming + section restructure + horizontal layout + font-mono removal
  5. NewFsTemplateForm: visual-framework dropdown + path completion swap
  6. Settings tab rename Tools -> Templates (hash id, tab label)
  7. Deploy + verify in browser
  8. Push to both remotes
  9. Final monospace audit report delivered verbatim to user

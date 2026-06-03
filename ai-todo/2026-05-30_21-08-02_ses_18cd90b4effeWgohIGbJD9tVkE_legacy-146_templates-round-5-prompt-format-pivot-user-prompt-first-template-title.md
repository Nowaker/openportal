---
status: DONE
commit: 
session: ses_18cd90b4effeWgohIGbJD9tVkE
queued_at: 2026-05-30T21:08:02-05:00
legacy_number: 146
---

# Templates Round 5: prompt format pivot - user prompt first, /template "Title" blocks, frontend collapse

(Originally enqueued as #143 on feat/templates-redesign-round-4 before main shipped its own #143 - composer draft persistence - and the loser bumps to N+1 per AI_TODO.md collision rule.)

User prompt (verbatim):

> also, current state is this: i submit new session with a template, i see "submitted to opencode" still as "/template 1t\n/template t2\n\nmy prompt here". then when it turned to queued, it's already expanded to what these templates stand for.
>
> i've an idea to make it much better.
>
> this is how the ai should get it:
> ```
> user's prompt here.
>
> ---
>
> User has explicitly requested these extra rules to apply in this very session - obey diligently:
>
> # /template "template title 1":
>
> rule 1 content
>
> # /template "template title 2"
>
> rule 2 content
> can be multiline
> ```
>
> on the frontend, in chat log we will wrap it in a way similar to how omo content is wrapped to save space.
>
> [ Template: template title 1 [icon to expand here] ]
> [ Template: template title 2 [icon to expand here] ]
>
> we will also do the same in prompt history.
>
> effectively, user view is this:
>
> ```
> user's prompt here.
>
> [ Template: template title 1 [icon to expand here] ]   <- the first one also wraps --- and User has explicitly... bla bla.
> [ Template: template title 2 [icon to expand here] ]
> ```
>
> continue everything.

Design notes:

- Pivots the Round 4 archive-vs-opencode split. ONE wire format is now used for both surfaces; the frontend collapses on render. See `ai-analysis-requests/TEMPLATES_REDESIGN.md` § "Round 5 (2026-05-30)" for the locked design + anti-reversion notes.
- Wire format: user prompt FIRST, then `\n\n---\n\n` separator, then a fixed preamble paragraph framing the templates as user-mandated rules, then one `# /template "Title":\n\nBody` block per checked template. Standardised on trailing colon for every block header (user's example had one without; treat as typo).
- `apps/web/src/lib/prompt-template-format.ts` is the canonical producer + parser. `buildPromptWithTemplates(userText, templates)` writes the format; `parsePromptWithTemplates(text)` returns `{ userText, templates }` or null. 11 unit tests cover round-trips, edge cases (no templates, escaped quotes, multiline bodies, blank lines in user prompt).
- `new.tsx` submit handler simplified: one `opencodeText`, `archiveText = opencodeText`, no more `archiveText !== opencodeText` conditional on the POST body. Server's `body.archiveText ?? body.text` fallback transparently handles the unification.
- R5-A (helper + tests) + R5-B (new.tsx submit) shipped in this commit. R5-C (chat-log collapse) + R5-D (prompt history collapse) pending - require a `TemplateBlockView` component (modeled on `OmoBlockView`) and integration into the chat message renderer (TBD location) + `apps/web/src/routes/_app/prompts.tsx`.
- The FIRST collapse pill's expanded body also includes the `---` + preamble (those belong to the first template's introduction); subsequent pills only show their own block body.
- Old-format messages (legacy compact `/template Foo` archive rows) render unchanged - `parsePromptWithTemplates` returns null for them and the renderer falls back to its normal path.
- Implementation order locked: R5-A + R5-B (this commit), then R5-C, then R5-D. Phase 1 (UnifiedToolList/FsTemplateRow/NewFsTemplateForm bug fix) runs concurrently in bg_4314b99a and is unaffected.

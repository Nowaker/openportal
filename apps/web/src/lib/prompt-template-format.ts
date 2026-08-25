export const PROMPT_TEMPLATE_PREAMBLE =
  "User has explicitly requested these extra rules to apply in this very session - obey diligently:";

const SEPARATOR = "---";

export interface PromptTemplateBlock {
  name: string;
  body: string;
  modified?: boolean;
}

export interface SelectablePromptTemplate extends PromptTemplateBlock {
  id: string;
}

export const MODIFIED_SUFFIX = " + modifications";

export function buildPromptWithTemplates(
  userText: string,
  templates: ReadonlyArray<PromptTemplateBlock>,
): string {
  const user = userText.trim();
  if (templates.length === 0) return user;
  const blocks = templates
    .map((t) => {
      const header = `# /template "${escapeTitle(t.name)}"${
        t.modified ? MODIFIED_SUFFIX : ""
      }:`;
      return `${header}\n\n${t.body}`;
    })
    .join("\n\n");
  return `${user}\n\n${SEPARATOR}\n\n${PROMPT_TEMPLATE_PREAMBLE}\n\n${blocks}`;
}

export function buildPromptFromSelection(
  userText: string,
  order: ReadonlyArray<SelectablePromptTemplate>,
  selected: ReadonlySet<string>,
  edits: Readonly<Record<string, string>>,
): string {
  return buildPromptWithTemplates(
    userText,
    order.filter((template) => selected.has(template.id)).map((template) => {
      const edited = edits[template.id];
      const modified = edited !== undefined && edited !== template.body;
      return {
        name: template.name,
        body: modified ? edited : template.body,
        modified,
      };
    }),
  );
}

export interface PromptTemplateParse {
  userText: string;
  templates: PromptTemplateBlock[];
}

const PARSE_RE = new RegExp(
  `^([\\s\\S]*?)\\n\\n${SEPARATOR}\\s*\\n\\n${escapeRegExp(PROMPT_TEMPLATE_PREAMBLE)}\\n\\n([\\s\\S]+)$`,
);

const BLOCK_RE =
  /# \/template "((?:\\"|[^"])+?)"( \+ modifications)?:\s*\n([\s\S]*?)(?=\n# \/template "|$)/g;

export function parsePromptWithTemplates(
  text: string,
): PromptTemplateParse | null {
  const m = text.match(PARSE_RE);
  if (!m) return null;
  const userText = m[1];
  const blocks: PromptTemplateBlock[] = [];
  for (const bm of m[2].matchAll(BLOCK_RE)) {
    blocks.push({
      name: unescapeTitle(bm[1]),
      body: bm[3].replace(/^\n+|\n+$/g, ""),
      modified: Boolean(bm[2]),
    });
  }
  if (blocks.length === 0) return null;
  return { userText, templates: blocks };
}

// Re-parses existing block so repeated selections accumulate under one preamble, like ticking several checkboxes.
export function insertSlashTemplate(
  value: string,
  slashStart: number,
  slashTokenLength: number,
  template: PromptTemplateBlock,
): { newValue: string; cursorPos: number } {
  const before = value.slice(0, slashStart);
  const tail = value.slice(slashStart + slashTokenLength);
  const remainder = `${before}${tail}`;
  const parsed = parsePromptWithTemplates(remainder);
  const userText = parsed ? parsed.userText : remainder;
  const existing = parsed ? parsed.templates : [];
  const merged = [
    ...existing.filter((t) => t.name !== template.name),
    template,
  ];
  const newValue = buildPromptWithTemplates(userText, merged);
  return { newValue, cursorPos: userText.trim().length };
}

function escapeTitle(title: string): string {
  return title.replace(/"/g, '\\"');
}

function unescapeTitle(title: string): string {
  return title.replace(/\\"/g, '"');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

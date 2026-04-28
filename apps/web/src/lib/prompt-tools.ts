// System tools shipped with Portal. Each tool is a named prompt template
// that the user can fire from the topbar Tools menu; clicking sends the
// resolved prompt text to opencode in the current session.
//
// User customisation flow (see stores/tools-store.ts):
//   - enabled: a tool can be hidden from the menu via a per-tool toggle.
//   - prompt override: the user can rewrite the prompt body. The system
//     default still lives here in code; the override is stored as a
//     full-text replacement keyed by tool id. Migrating the system text
//     in the future does NOT clobber the user's edit; the user can hit
//     "reset" to drop the override.
//   - custom tools: the user can also create their own tools alongside
//     these. Custom tools have no system default and no reset action.
//
// Adding a new system tool: append to SYSTEM_TOOLS. The id is the
// stable identifier persisted in user settings; never change an existing
// id without a migration.

export interface SystemTool {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

const CREATE_PR_PROMPT = `Use gh CLI to create a pull request. Follow these steps:

1. First, check git status to see all changes
2. Stage all relevant changes with git add
3. Get the diff of staged changes
4. Generate a clear, descriptive commit message based on the changes
5. Commit the changes
6. Push to the remote branch (create branch if needed)
7. Create a PR using gh pr create with a descriptive title and body
8. After the PR is created, checkout to main branch

Make sure to:
- Write a meaningful commit message that explains WHY, not just WHAT
- The PR title should be concise but descriptive
- The PR body should summarize the changes and their purpose
- Always checkout to main after successfully creating the PR`;

const PULL_CHANGES_PROMPT = `Pull the latest changes from the remote repository. Follow these steps:

1. First, check git status to see if there are any uncommitted changes
2. If there are uncommitted changes, stash them with a descriptive message
3. Run git pull to fetch and merge the latest changes from the remote
4. If there were stashed changes, pop the stash and resolve any conflicts if needed
5. Show a summary of what was pulled (new commits, files changed)

Make sure to:
- Handle any merge conflicts gracefully
- Report what changes were pulled
- Restore any stashed changes after pulling`;

const PUSH_CHANGES_PROMPT = `Push the current changes to the remote repository. Follow these steps:

1. First, check git status to see all uncommitted changes
2. If there are uncommitted changes:
   - Stage all relevant changes with git add
   - Generate a clear, descriptive commit message based on the changes
   - Commit the changes
3. Check if the current branch has an upstream branch set
4. Push to the remote (set upstream if needed)
5. Show a summary of what was pushed

Make sure to:
- Write a meaningful commit message that explains WHY, not just WHAT
- Handle any push rejections (e.g., if remote has new commits, pull first)
- Report the result of the push operation`;

export const SYSTEM_TOOLS: readonly SystemTool[] = [
  {
    id: "git.pull",
    name: "Pull",
    description: "Pull the latest changes from the remote repository.",
    prompt: PULL_CHANGES_PROMPT,
  },
  {
    id: "git.push",
    name: "Push",
    description: "Stage, commit, and push the current changes.",
    prompt: PUSH_CHANGES_PROMPT,
  },
  {
    id: "git.create-pr",
    name: "Create PR",
    description: "Push the current branch and open a pull request via gh.",
    prompt: CREATE_PR_PROMPT,
  },
];

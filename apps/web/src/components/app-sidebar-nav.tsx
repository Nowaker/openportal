import { useEffect, useState } from "react";
import { useMatch } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { SidebarNav, SidebarTrigger } from "@/components/ui/sidebar";
import { toast } from "@/components/ui/toast";
import ArrowDownCircleIcon from "@/components/icons/arrow-down-circle-icon";
import ArrowUpCircleIcon from "@/components/icons/arrow-up-circle-icon";
import IconGitPullRequest from "@/components/icons/git-pull-request-icon";
import { useInstanceStore } from "@/stores/instance-store";
import { useModelStore } from "@/stores/model-store";
import { mutateSessionMessages } from "@/hooks/use-session-messages";
import { useSessions } from "@/hooks/use-opencode";
import type { Session } from "@opencode-ai/sdk";

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

// Take the deepest path component and use it as a short project label.
// "session.directory" can be absolute ("/home/u/projekty/nowaker/blah") or
// even a single-segment short name; either way the basename gives us
// something useful to fit in the topbar.
function projectLabelFromDirectory(directory?: string): string | null {
  if (!directory) return null;
  const parts = directory.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || null;
}

export function AppSidebarNav() {
  const instance = useInstanceStore((s) => s.instance);
  const port = instance?.port ?? 0;
  const instanceId = instance?.id ?? null;
  const resolveModel = useModelStore((s) => s.resolveModel);
  const { data: sessionsData, mutate: mutateSessions } = useSessions();

  const [isCreatingPR, setIsCreatingPR] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPushing, setIsPushing] = useState(false);

  const sessionMatch = useMatch({
    from: "/_app/session/$id",
    shouldThrow: false,
  });
  const sessionId = sessionMatch?.params?.id;
  const sessions: Session[] = sessionsData ?? [];
  const currentSession = sessions.find((s) => s.id === sessionId);
  const sessionTitle = currentSession?.title ?? null;
  const projectLabel = projectLabelFromDirectory(currentSession?.directory);

  // Browser tab title: '<project>: <session> - OpenPortal' when on a
  // session route, plain 'OpenPortal' anywhere else. Restored on unmount
  // / route change so other pages aren't stuck with the session label.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    if (sessionTitle) {
      const prefix = projectLabel ? `${projectLabel}: ` : "";
      document.title = `${prefix}${sessionTitle} - OpenPortal`;
    } else {
      document.title = "OpenPortal";
    }
    return () => {
      document.title = previous;
    };
  }, [sessionTitle, projectLabel]);

  const sendPrompt = async (prompt: string) => {
    if (!sessionId || !port) {
      toast.error("Please open a session first");
      return;
    }

    const selectedModel = resolveModel(sessionId, instanceId);
    const response = await fetch(
      `/api/opencode/${port}/session/${sessionId}/prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: prompt, model: selectedModel }),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to send request");
    }

    mutateSessionMessages(port, sessionId);
    mutateSessions();
  };

  const handleCreatePR = async () => {
    setIsCreatingPR(true);
    try {
      await sendPrompt(CREATE_PR_PROMPT);
      toast.success("PR creation request sent");
    } catch (err) {
      console.error("Failed to create PR:", err);
      toast.error("Failed to send PR creation request");
    } finally {
      setIsCreatingPR(false);
    }
  };

  const handlePull = async () => {
    setIsPulling(true);
    try {
      await sendPrompt(PULL_CHANGES_PROMPT);
      toast.success("Pull request sent");
    } catch (err) {
      console.error("Failed to pull:", err);
      toast.error("Failed to send pull request");
    } finally {
      setIsPulling(false);
    }
  };

  const handlePush = async () => {
    setIsPushing(true);
    try {
      await sendPrompt(PUSH_CHANGES_PROMPT);
      toast.success("Push request sent");
    } catch (err) {
      console.error("Failed to push:", err);
      toast.error("Failed to send push request");
    } finally {
      setIsPushing(false);
    }
  };

  const isLoading = isCreatingPR || isPulling || isPushing;

  return (
    <SidebarNav isSticky>
      <span className="flex items-center gap-x-2 min-w-0 flex-1">
        <SidebarTrigger className="-ml-2 shrink-0" />
        {/* Session title fills the gap between the left/right hamburgers.
            On a session route we render '<project>: <title>'; outside a
            session, the instance name keeps the topbar from looking empty.
            min-w-0 + truncate so long titles don't push the right buttons
            off the screen on mobile. */}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
          {sessionTitle ? (
            <>
              {projectLabel && (
                <span className="text-muted-fg">{projectLabel}: </span>
              )}
              {sessionTitle}
            </>
          ) : (
            <span className="text-muted-fg">
              {instance?.name ?? "OpenPortal"}
            </span>
          )}
        </span>
      </span>
      <span className="flex items-center gap-x-2 ml-auto">
        <Button
          size="xs"
          intent="outline"
          className="!text-[11px] uppercase font-mono"
          onPress={handlePull}
          isDisabled={isLoading || !sessionId}
        >
          <ArrowDownCircleIcon size="12px" />
          {isPulling ? "Pulling..." : "Pull"}
        </Button>
        <Button
          size="xs"
          intent="outline"
          className="!text-[11px] uppercase font-mono"
          onPress={handlePush}
          isDisabled={isLoading || !sessionId}
        >
          <ArrowUpCircleIcon size="12px" />
          {isPushing ? "Pushing..." : "Push"}
        </Button>
        <Button
          size="xs"
          intent="outline"
          className="!text-[11px] uppercase font-mono"
          onPress={handleCreatePR}
          isDisabled={isLoading || !sessionId}
        >
          <IconGitPullRequest size="12px" />
          {isCreatingPR ? "Creating..." : "Create PR"}
        </Button>
      </span>
    </SidebarNav>
  );
}

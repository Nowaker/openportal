import {
  ArrowRightOnRectangleIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/router";
import { useState } from "react";
import IconGitPullRequest from "@/components/icons/git-pull-request-icon";
import { Avatar } from "@/components/ui/avatar";
import { Breadcrumbs, BreadcrumbsItem } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuContent,
  MenuHeader,
  MenuItem,
  MenuLabel,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { SidebarNav, SidebarTrigger } from "@/components/ui/sidebar";
import { useCurrentProject } from "@/hooks/use-project";
import { useSelectedModel } from "@/hooks/use-selected-model";
import { mutateSessions, useSession } from "@/hooks/use-sessions";
import { mutateSessionMessages } from "@/hooks/use-session-messages";

const CREATE_PR_PROMPT = `Use gh CLI to create a pull request. Follow these steps:

1. First, check git status to see all changes
2. Stage all relevant changes with git add
3. Get the diff of staged changes
4. Generate a clear, descriptive commit message based on the changes
5. Commit the changes
6. Push to the remote branch (create branch if needed)
7. Create a PR using gh pr create with a descriptive title and body

Make sure to:
- Write a meaningful commit message that explains WHY, not just WHAT
- The PR title should be concise but descriptive
- The PR body should summarize the changes and their purpose`;

export default function AppSidebarNav() {
  const router = useRouter();
  const { project } = useCurrentProject();
  const { selectedModel } = useSelectedModel();
  const [isCreatingPR, setIsCreatingPR] = useState(false);

  const sessionId = router.pathname.startsWith("/session/")
    ? (router.query.id as string)
    : undefined;
  const { session } = useSession(sessionId);

  // Derive project name from worktree path
  const projectName = project?.worktree?.split("/").pop() || "Dashboard";

  const sessionName =
    session?.title || (session ? `Session ${session.id}` : null);

  const handleCreatePR = async () => {
    if (!sessionId) {
      // If not on a session page, we could create a new session or show an error
      alert("Please open a session first to create a PR");
      return;
    }

    setIsCreatingPR(true);

    try {
      const response = await fetch(`/api/sessions/${sessionId}/prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: CREATE_PR_PROMPT,
          model: selectedModel,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send PR creation request");
      }

      // Revalidate messages to show the new message
      mutateSessionMessages(sessionId);
      mutateSessions();
    } catch (err) {
      console.error("Failed to create PR:", err);
      alert("Failed to send PR creation request");
    } finally {
      setIsCreatingPR(false);
    }
  };

  return (
    <SidebarNav>
      <span className="flex items-center gap-x-4">
        <SidebarTrigger />
        <Breadcrumbs className="hidden md:flex">
          <BreadcrumbsItem href="/">{projectName}</BreadcrumbsItem>
          {session && <BreadcrumbsItem>{sessionName}</BreadcrumbsItem>}
        </Breadcrumbs>
      </span>
      <span className="flex items-center gap-x-2 ml-auto">
        <Button
          size="xs"
          intent="outline"
          onPress={handleCreatePR}
          isDisabled={isCreatingPR || !sessionId}
        >
          <IconGitPullRequest size="14px" />
          {isCreatingPR ? "Creating..." : "Create PR"}
        </Button>
        <UserMenu />
      </span>
    </SidebarNav>
  );
}

function UserMenu() {
  return (
    <Menu>
      <MenuTrigger className="ml-auto md:hidden" aria-label="Open Menu">
        <Avatar
          isSquare
          alt="kurt cobain"
          src="https://intentui.com/images/avatar/cobain.jpg"
        />
      </MenuTrigger>
      <MenuContent popover={{ placement: "bottom end" }} className="min-w-64">
        <MenuSection>
          <MenuHeader separator>
            <span className="block">Kurt Cobain</span>
            <span className="font-normal text-muted-fg">@cobain</span>
          </MenuHeader>
        </MenuSection>
        <MenuItem href="#dashboard">
          <Squares2X2Icon />
          <MenuLabel>Dashboard</MenuLabel>
        </MenuItem>
        <MenuItem href="#settings">
          <Cog6ToothIcon />
          <MenuLabel>Settings</MenuLabel>
        </MenuItem>
        <MenuSeparator />
        <MenuItem>
          <CommandLineIcon />
          <MenuLabel>Command Menu</MenuLabel>
        </MenuItem>
        <MenuSeparator />
        <MenuItem href="#contact-s">
          <MenuLabel>Contact Support</MenuLabel>
        </MenuItem>
        <MenuSeparator />
        <MenuItem href="#logout">
          <ArrowRightOnRectangleIcon />
          <MenuLabel>Log out</MenuLabel>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

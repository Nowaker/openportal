import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import EmptyState from "@/components/empty-state";
import { useBreadcrumb } from "@/contexts/breadcrumb-context";
import { useSessions } from "@/hooks/use-opencode";
import type { Session } from "@opencode-ai/sdk";

export const Route = createFileRoute("/_app/")({
  component: AppIndex,
});

function AppIndex() {
  const { setPageTitle } = useBreadcrumb();
  const navigate = useNavigate();
  const { data: sessionsData, isLoading } = useSessions();

  useEffect(() => {
    setPageTitle(null);
    return () => setPageTitle(null);
  }, [setPageTitle]);

  useEffect(() => {
    if (isLoading) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("opencode-last-session");
    } catch {
      // ignore quota / private-mode errors
    }
    if (!stored) return;
    const sessions = (sessionsData ?? []) as Session[];
    const exists = sessions.some((s) => s.id === stored);
    if (exists) {
      void navigate({
        to: "/session/$id",
        params: { id: stored },
        replace: true,
      });
    } else {
      try {
        localStorage.removeItem("opencode-last-session");
      } catch {
        // ignore quota / private-mode errors
      }
    }
  }, [isLoading, sessionsData, navigate]);

  return <EmptyState />;
}

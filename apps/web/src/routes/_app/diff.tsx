import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";
import { AppPage, AppPageBody, AppPageHeader } from "@/components/app-page";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/typography";
import { useGitDiff } from "@/hooks/use-opencode";
import { useBreadcrumb } from "@/contexts/breadcrumb-context";
import { ArrowPathIcon } from "@heroicons/react/24/outline";

export const Route = createFileRoute("/_app/diff")({
  component: DiffPage,
});

function DiffPage() {
  const { data, error, isLoading, mutate } = useGitDiff();
  const { setPageTitle } = useBreadcrumb();

  useEffect(() => {
    setPageTitle("Git Diff");
    return () => setPageTitle(null);
  }, [setPageTitle]);

  const files = useMemo(() => {
    if (!data?.diff) return [];
    try {
      const patches = parsePatchFiles(data.diff);
      // Flatten all files from all patches
      return patches.flatMap((patch) => patch.files);
    } catch {
      return [];
    }
  }, [data?.diff]);

  if (isLoading) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center">
        <Loader className="size-8" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col min-h-0 items-center justify-center gap-4">
        <div className="text-danger">Error loading diff: {error.message}</div>
        <Button onPress={() => mutate()}>
          <ArrowPathIcon className="size-4" />
          Retry
        </Button>
      </div>
    );
  }

  if (!data?.diff || files.length === 0) {
    return (
      <div className="flex flex-1 flex-col min-h-0 items-center justify-center gap-4">
        <div className="text-muted-fg">No changes detected</div>
        <Button onPress={() => mutate()}>
          <ArrowPathIcon className="size-4" />
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <AppPage>
      <AppPageHeader className="flex items-center justify-between py-3">
        <PageTitle>Git Diff</PageTitle>
        <Button intent="secondary" size="sm" onPress={() => mutate()}>
          <ArrowPathIcon className="size-4" />
          Refresh
        </Button>
      </AppPageHeader>

      <AppPageBody padded={false}>
        {files.map((file, index) => (
          <FileDiff
            key={file.name || file.prevName || index}
            fileDiff={file}
            options={{
              diffStyle: "unified",
              diffIndicators: "bars",
            }}
          />
        ))}
      </AppPageBody>
    </AppPage>
  );
}

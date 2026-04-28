import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import AppSidebar from "@/components/app-sidebar";
import { AppSidebarNav } from "@/components/app-sidebar-nav";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { BreadcrumbProvider } from "@/contexts/breadcrumb-context";
import { useInstanceStore } from "@/stores/instance-store";
import { useSelfInstance } from "@/hooks/use-opencode";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const instance = useInstanceStore((s) => s.instance);
  const setInstance = useInstanceStore((s) => s.setInstance);
  const { data: selfData, isLoading, error } = useSelfInstance();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!selfData) return;
    if (selfData.instance) {
      const self = selfData.instance;
      if (
        !instance ||
        instance.port !== self.port ||
        instance.id !== self.id
      ) {
        setInstance({ id: self.id, name: self.name, port: self.port });
      }
    }
    setHydrated(true);
  }, [selfData, instance, setInstance]);

  if (isLoading || !hydrated) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted-fg">
        Loading…
      </div>
    );
  }

  if (error || !selfData?.instance) {
    return (
      <div className="flex h-dvh items-center justify-center p-6">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-lg font-medium">Portal not registered</h1>
          <p className="text-sm text-muted-fg">
            {selfData?.error ||
              (error instanceof Error ? error.message : "Unknown error")}
          </p>
          <p className="text-xs text-muted-fg">
            This Portal UI's web port is not in <code>~/.portal.json</code>.
            Restart it via the launcher.
          </p>
        </div>
      </div>
    );
  }

  if (!instance) return null;

  return (
    <BreadcrumbProvider>
      <SidebarProvider className="h-dvh overflow-hidden">
        <AppSidebar collapsible="dock" />
        <SidebarInset className="overflow-hidden">
          <AppSidebarNav />
          <div className="flex-1 overflow-hidden">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </BreadcrumbProvider>
  );
}

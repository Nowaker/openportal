import { createRootRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { RouterProvider } from "react-aria-components";
import { ThemeProvider } from "@/providers/theme-provider";
import { Toast } from "@/components/ui/toast";
import Cmd from "@/components/cmd";

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: AlwaysShowError,
});

function AlwaysShowError({ error }: { error: unknown }) {
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const stack = error instanceof Error ? error.stack : undefined;
  const detail =
    typeof error === "object" && error !== null && !(error instanceof Error)
      ? JSON.stringify(error, null, 2)
      : null;
  return (
    <div className="p-4 max-w-full">
      <strong className="block text-base text-danger">
        Something went wrong!
      </strong>
      <pre className="mt-2 max-h-96 overflow-auto rounded border border-danger/40 bg-danger-subtle/30 p-2 text-xs text-danger-subtle-fg whitespace-pre-wrap break-words">
        {message}
        {detail ? `\n\n${detail}` : ""}
        {stack ? `\n\n${stack}` : ""}
      </pre>
    </div>
  );
}

function RootComponent() {
  const navigate = useNavigate();

  return (
    <ThemeProvider>
      <RouterProvider navigate={(path) => navigate({ to: path })}>
        <div className="page">
          <section className="content">
            <Outlet />
          </section>
          <Cmd />
          <Toast position="top-right" />
        </div>
      </RouterProvider>
    </ThemeProvider>
  );
}

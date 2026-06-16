import { createContext, useContext, useState, useCallback } from "react";

export interface PageTitleAction {
  onClick: () => void;
  title: string;
  ariaLabel: string;
  disabled?: boolean;
}

interface BreadcrumbContextValue {
  pageTitle: string | null;
  setPageTitle: (title: string | null) => void;
  pageTitleAction: PageTitleAction | null;
  setPageTitleAction: (action: PageTitleAction | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export function BreadcrumbProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pageTitle, setPageTitleState] = useState<string | null>(null);
  const [pageTitleAction, setPageTitleActionState] =
    useState<PageTitleAction | null>(null);

  const setPageTitle = useCallback((title: string | null) => {
    setPageTitleState(title);
  }, []);

  const setPageTitleAction = useCallback((action: PageTitleAction | null) => {
    setPageTitleActionState(action);
  }, []);

  return (
    <BreadcrumbContext.Provider
      value={{ pageTitle, setPageTitle, pageTitleAction, setPageTitleAction }}
    >
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumb() {
  const context = useContext(BreadcrumbContext);
  if (!context) {
    throw new Error("useBreadcrumb must be used within a BreadcrumbProvider");
  }
  return context;
}

export function useSetPageTitle(title: string | null) {
  const { setPageTitle } = useBreadcrumb();

  useState(() => {
    setPageTitle(title);
    return null;
  });
}

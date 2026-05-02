import useSWR from "swr";
import { useInstanceStore } from "@/stores/instance-store";

export interface LspStatus {
  id: string;
  name: string;
  root: string;
  status: "connected" | "error";
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

export function useLspStatus() {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  return useSWR<LspStatus[]>(
    port ? `/api/opencode/${port}/lsp` : null,
    fetcher,
    { revalidateOnFocus: true },
  );
}

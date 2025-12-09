import { Providers } from "@/providers";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { NuqsAdapter } from "nuqs/adapters/next/pages";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <Providers>
      <NuqsAdapter>
        <Component {...pageProps} />
      </NuqsAdapter>
    </Providers>
  );
}

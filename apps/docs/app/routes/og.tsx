import { ImageResponse } from "@takumi-rs/image-response/wasm";
import type { LoaderFunctionArgs } from "react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const pageTitle = url.searchParams.get("title") || "PORTAL";
  const description =
    url.searchParams.get("description") || "Mobile-first Web UI for OpenCode";

  // Load DepartureMono font
  const fontPath = join(process.cwd(), "public", "DepartureMono-Regular.otf");
  const fontData = await readFile(fontPath);

  // Load WASM module
  const wasmPath = require.resolve("@takumi-rs/wasm/takumi_wasm_bg.wasm");
  const wasmBuffer = await readFile(wasmPath);

  return new ImageResponse(
    <div
      tw="flex flex-col w-full h-full bg-white text-black p-16"
      style={{ fontFamily: "Geist" }}
    >
      <div tw="flex items-center mb-8">
        <span tw="text-2xl text-gray-600">OpenCode Portal</span>
      </div>
      <div tw="flex flex-col flex-1 justify-center">
        <h1
          tw="text-7xl font-bold mb-6 text-black"
          style={{ fontFamily: "DepartureMono", textTransform: "uppercase" }}
        >
          {pageTitle.toUpperCase()}
        </h1>
        <p tw="text-2xl text-gray-600 max-w-3xl">{description}</p>
      </div>
      <div tw="flex items-center justify-between mt-auto pt-8 border-t border-gray-200">
        <span tw="text-xl text-gray-500">openportal.space</span>
        <span tw="text-xl text-blue-600">Mobile-first Web UI for OpenCode</span>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      format: "png",
      module: wasmBuffer,
      fonts: [
        {
          name: "DepartureMono",
          data: fontData,
          style: "normal",
          weight: 400,
        },
      ],
    },
  );
}

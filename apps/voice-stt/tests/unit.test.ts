import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { buildServer } from "../src/index";

let server: ReturnType<typeof buildServer>;
let baseUrl: string;

beforeAll(() => {
  server = buildServer({
    host: "127.0.0.1",
    port: 0,
    model: "base.en",
    modelPath: null,
  });
  baseUrl = `http://${server.hostname}:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe("voice-stt HTTP surface (no model required)", () => {
  it("GET /health returns ok + model name", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.model).toBe("base.en");
  });

  it("OPTIONS / returns 204 with CORS headers", async () => {
    const res = await fetch(baseUrl, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "Content-Type",
    );
  });

  it("OPTIONS /transcribe returns 204", async () => {
    const res = await fetch(`${baseUrl}/transcribe`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
  });

  it("POST /transcribe with empty body returns 400", async () => {
    const res = await fetch(`${baseUrl}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "audio/webm" },
      body: new ArrayBuffer(0),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("empty");
  });

  it("POST /transcribe multipart without audio field returns 400", async () => {
    const form = new FormData();
    form.append("notaudio", "wrong-field");
    const res = await fetch(`${baseUrl}/transcribe`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("audio");
  });

  it("GET /unknown returns 404", async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
  });

  it("POST /transcribe is the only POST endpoint (POST /health 404)", async () => {
    const res = await fetch(`${baseUrl}/health`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("CORS headers on JSON responses", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

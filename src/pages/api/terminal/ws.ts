import type { NextApiRequest, NextApiResponse } from "next";
import type { Server as HTTPServer } from "node:http";
import type { Socket as NetSocket } from "node:net";
import { Server as SocketIOServer } from "socket.io";
import http from "node:http";
import net from "node:net";

// Environment variable for the Docker socket path
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
const OPENCODE_CONTAINER =
  process.env.OPENCODE_CONTAINER || process.env.HOSTNAME || "";

console.log("[Terminal] Config:", {
  DOCKER_SOCKET,
  OPENCODE_CONTAINER,
});

export const config = {
  api: {
    bodyParser: false,
  },
};

interface SocketServer extends HTTPServer {
  io?: SocketIOServer;
}

interface SocketWithIO extends NetSocket {
  server: SocketServer;
}

interface ResponseWithSocket extends NextApiResponse {
  socket: SocketWithIO;
}

// Helper to make Docker API requests over Unix socket
function dockerRequest(
  method: string,
  path: string,
  body?: object,
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: DOCKER_SOCKET,
      path,
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode || 0, data });
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Create a raw socket connection to Docker for exec streaming
function createExecStream(execId: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: DOCKER_SOCKET }, () => {
      // Send HTTP request to start exec
      const request = [
        `POST /exec/${execId}/start HTTP/1.1`,
        "Host: localhost",
        "Content-Type: application/json",
        "Connection: Upgrade",
        "Upgrade: tcp",
        "",
        JSON.stringify({ Detach: false, Tty: true }),
      ].join("\r\n");

      socket.write(request);
    });

    let headersParsed = false;
    let buffer = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      if (headersParsed) return;

      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");

      if (headerEnd !== -1) {
        headersParsed = true;
        const headers = buffer.slice(0, headerEnd).toString();
        const remaining = buffer.slice(headerEnd + 4);

        // Check for successful upgrade
        if (headers.includes("101") || headers.includes("200")) {
          socket.removeListener("data", onData);

          // Push back any remaining data
          if (remaining.length > 0) {
            socket.unshift(remaining);
          }

          resolve(socket);
        } else {
          reject(new Error(`Docker exec start failed: ${headers}`));
          socket.destroy();
        }
      }
    };

    socket.on("data", onData);
    socket.on("error", reject);
  });
}

export default function handler(_req: NextApiRequest, res: ResponseWithSocket) {
  if (!res.socket.server.io) {
    console.log("[Terminal] Initializing Socket.IO server...");

    const io = new SocketIOServer(res.socket.server, {
      path: "/api/terminal/ws",
      addTrailingSlash: false,
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    io.on("connection", async (socket) => {
      console.log("[Terminal] Client connected:", socket.id);

      const containerId =
        (socket.handshake.query.containerId as string) || OPENCODE_CONTAINER;

      console.log("[Terminal] Using container ID:", containerId);

      if (!containerId) {
        console.log("[Terminal] Error: No container ID");
        socket.emit("error", {
          message:
            "Container ID is required. Set OPENCODE_CONTAINER env variable.",
        });
        socket.disconnect();
        return;
      }

      let dockerSocket: net.Socket | null = null;
      let execId: string | null = null;

      const connectToDocker = async () => {
        try {
          // Step 1: Create exec instance
          console.log("[Terminal] Creating exec instance...");
          socket.emit("log", "Creating shell session...");

          const execCreateRes = await dockerRequest(
            "POST",
            `/containers/${containerId}/exec`,
            {
              AttachStdin: true,
              AttachStdout: true,
              AttachStderr: true,
              Tty: true,
              Cmd: [
                "/bin/sh",
                "-c",
                "if command -v bash >/dev/null; then exec bash; else exec sh; fi",
              ],
            },
          );

          if (execCreateRes.statusCode !== 201) {
            throw new Error(
              `Failed to create exec: ${execCreateRes.statusCode} ${execCreateRes.data}`,
            );
          }

          const execData = JSON.parse(execCreateRes.data);
          execId = execData.Id;
          console.log("[Terminal] Exec created:", execId);
          socket.emit("log", "Shell session created, connecting...");

          // Step 2: Start exec with raw socket connection
          dockerSocket = await createExecStream(execId as string);
          console.log("[Terminal] Docker stream connected");
          socket.emit("connected", { containerId });

          dockerSocket.on("data", (data: Buffer) => {
            socket.emit("output", data.toString());
          });

          dockerSocket.on("close", () => {
            console.log("[Terminal] Docker stream closed");
            socket.emit("disconnected", { code: 0, reason: "Stream closed" });
          });

          dockerSocket.on("error", (error: Error) => {
            console.error("[Terminal] Docker stream error:", error.message);
            socket.emit("error", { message: error.message });
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error("[Terminal] Error:", errMsg);
          socket.emit("error", { message: errMsg });
        }
      };

      // Handle input from client
      socket.on("input", (data: string) => {
        if (dockerSocket && !dockerSocket.destroyed) {
          dockerSocket.write(data);
        }
      });

      // Handle resize from client
      socket.on("resize", async (data: { cols: number; rows: number }) => {
        if (execId) {
          console.log("[Terminal] Resize:", data);
          try {
            await dockerRequest(
              "POST",
              `/exec/${execId}/resize?h=${data.rows}&w=${data.cols}`,
            );
          } catch (err) {
            console.error("[Terminal] Resize error:", err);
          }
        }
      });

      // Handle disconnect
      socket.on("disconnect", (reason) => {
        console.log("[Terminal] Client disconnected:", reason);
        if (dockerSocket) {
          dockerSocket.destroy();
          dockerSocket = null;
        }
      });

      // Start connection
      connectToDocker();
    });

    res.socket.server.io = io;
    console.log("[Terminal] Socket.IO server initialized");
  }

  res.end();
}

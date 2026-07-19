import type { Server, ServerWebSocket } from "bun";
import { LobbyHub, type Transport } from "./lobby";
import { isSupportedVersion, type ServerMessage, WS_PATH } from "./protocol";

interface SocketData {
  socketId: string;
}

// Kept under Cloudflare's ~100s edge idle timeout so Bun's automatic pings
// (sendPings defaults true) cross a cloudflared quick tunnel before the edge drops
// an idle lobby socket; a genuinely dead socket is then detected in ~45s (INV-2).
const DEFAULT_IDLE_TIMEOUT = 45;

export interface ServeLobbyOptions {
  port?: number;
  routes?: Record<string, Bun.HTMLBundle>;
  development?: Bun.Serve.Options<SocketData>["development"];
  graceMs?: number;
  tickMs?: number; // fixed world timestep once a match starts; see LobbyHub
  idleTimeout?: number; // WS idle seconds before Bun pings/closes; see DEFAULT_IDLE_TIMEOUT
}

export interface LobbyServer {
  server: Server<SocketData>;
  port: number;
  url: string; // ws:// URL for the same-origin lobby socket
  stop(): void;
}

// One `Bun.serve` — HTML routes, a same-origin `/ws` upgrade, and the websocket
// handler — so the client and its lobby socket share one origin and one port (INV-1).
// The registry maps opaque socket ids to live sockets, implementing the Lobby's
// Transport without leaking Bun types into the domain.
export function serveLobby(options: ServeLobbyOptions = {}): LobbyServer {
  const registry = new Map<string, ServerWebSocket<SocketData>>();
  const transport: Transport = {
    send(socketId: string, msg: ServerMessage) {
      registry.get(socketId)?.send(JSON.stringify(msg));
    },
    close(socketId: string, code: number, reason?: string) {
      registry.get(socketId)?.close(code, reason);
    },
  };
  const hub = new LobbyHub(transport, { graceMs: options.graceMs, tickMs: options.tickMs });

  const server = Bun.serve<SocketData>({
    port: options.port ?? Number(process.env.PORT ?? 3000),
    development: options.development,
    routes: options.routes,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === WS_PATH) {
        // Version is connection-scoped: validated here, before the upgrade, so no
        // wrong-dialect socket ever reaches the handler.
        if (!isSupportedVersion(url.searchParams.get("v"))) {
          return new Response("unsupported protocol version", { status: 400 });
        }
        if (srv.upgrade(req, { data: { socketId: crypto.randomUUID() } })) return;
        return new Response("upgrade failed", { status: 500 });
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      idleTimeout: options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT,
      open(ws) {
        registry.set(ws.data.socketId, ws);
      },
      message(ws, raw) {
        hub.handleMessage(ws.data.socketId, typeof raw === "string" ? raw : raw.toString());
      },
      close(ws) {
        registry.delete(ws.data.socketId);
        hub.handleClose(ws.data.socketId);
      },
    },
  });

  return {
    server,
    port: Number(server.url.port),
    url: `ws://${server.url.host}${WS_PATH}`,
    stop() {
      hub.dispose(); // clear timers first so closing sockets can't arm new ones
      server.stop(true);
    },
  };
}

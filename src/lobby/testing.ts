import { expect } from "bun:test";
import type { LobbyClient, LobbyState } from "./client";
import { type ClientMessage, PROTOCOL_VERSION, type ServerMessage } from "./protocol";
import { type ServeLobbyOptions, serveLobby } from "./server";

// Assert a message's `type` and narrow it, so a test can read payload fields safely.
export function expectMessage<T extends ServerMessage["type"]>(
  msg: ServerMessage,
  type: T,
): Extract<ServerMessage, { type: T }> {
  expect(msg.type).toBe(type);
  return msg as Extract<ServerMessage, { type: T }>;
}

// Reusable WebSocket test harness (INV-3): an ephemeral-port server plus buffering
// clients that `waitFor` a specific message. The buffer + parked-waiter design is the
// anti-race move — a message that already arrived is matched from the buffer, and a
// missed one fails fast via timeout instead of hanging the suite.

export function startServer(options: ServeLobbyOptions = {}): ReturnType<typeof serveLobby> {
  return serveLobby({ port: 0, ...options });
}

export interface TestClient {
  ws: WebSocket;
  opened: Promise<void>;
  send(msg: ClientMessage): void;
  waitFor(pred: (m: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>;
  close(): Promise<void>;
}

export function makeClient(url: string): TestClient {
  const ws = new WebSocket(`${url}?v=${PROTOCOL_VERSION}`);
  const buffer: ServerMessage[] = [];
  const waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String((ev as MessageEvent).data)) as ServerMessage;
    const i = waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else buffer.push(msg);
  });

  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("ws error")));
  });

  const waitFor = (pred: (m: ServerMessage) => boolean, timeoutMs = 1000) =>
    new Promise<ServerMessage>((resolve, reject) => {
      const i = buffer.findIndex(pred);
      if (i >= 0) return resolve(buffer.splice(i, 1)[0]);
      const waiter = { pred, resolve };
      waiters.push(waiter);
      const timer = setTimeout(() => {
        const j = waiters.indexOf(waiter);
        if (j >= 0) {
          waiters.splice(j, 1);
          reject(new Error("waitFor timeout"));
        }
      }, timeoutMs);
      timer.unref?.();
    });

  const close = () =>
    new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) return resolve();
      ws.addEventListener("close", () => resolve());
      ws.close();
    });

  return { ws, opened, send: (msg) => ws.send(JSON.stringify(msg)), waitFor, close };
}

// Resolve once the client's state satisfies `pred`; fail fast on timeout.
export function waitForState(
  client: LobbyClient,
  pred: (s: LobbyState) => boolean,
  timeoutMs = 1000,
): Promise<LobbyState> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const check = () => {
      if (pred(client.getState())) {
        unsubscribe();
        resolve(client.getState());
      }
    };
    unsubscribe = client.subscribe(check);
    check();
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("waitForState timeout"));
    }, timeoutMs);
    timer.unref?.();
  });
}

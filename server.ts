import index from "./index.html";
import { serveLobby } from "./src/lobby/server";

// One process serves the bundled React app and the same-origin lobby WebSocket
// (INV-1). Dev (`bun --hot server.ts`) enables HMR; the compiled binary ships the
// pre-bundled client. Binds 0.0.0.0 by default so a tunnel can expose it (INV-2).
const { server } = serveLobby({
  routes: { "/": index },
  development: process.env.NODE_ENV === "production" ? false : { hmr: true, console: true },
});

console.log(`Breakout Box listening on ${server.url}`);

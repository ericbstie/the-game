import index from "./index.html";

const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  routes: { "/": index },
});

console.log(`Breakout Box server listening on ${server.url}`);

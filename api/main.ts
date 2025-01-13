import express from "express";
import cors from "cors";
import { appRouter, createContext, expressMiddleware } from "./src/trpc";
import {
  getBars,
  getConfig,
  getServerTime,
  resolveSymbol,
  searchSymbols,
} from "./src/tradingview";
import apicache from "apicache";
import { expressHandler } from "trpc-playground/handlers/express";
import { validateRequest } from "zod-express-middleware";
import { z } from "zod";
import logger from "../common/logger";
import { WebSocketServer } from "ws";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { createOpenApiExpressMiddleware } from "trpc-openapi";
import { createServer } from "http";

const cache = apicache.options({
  headers: {
    "cache-control": "no-cache",
  },
}).middleware;

const trpcApiEndpoint = "/trpc";
const playgroundEndpoint = "/trpc-playground";
const openApiEndpoint = "/api";

const app = express();
app.use(cors());
app.use(trpcApiEndpoint, expressMiddleware);
// @ts-expect-error
app.use(openApiEndpoint, createOpenApiExpressMiddleware({ router: appRouter }));

// Playground (dev only)
process.env.NODE_ENV === "development" &&
  app.use(
    playgroundEndpoint,
    await expressHandler({
      trpcApiEndpoint,
      playgroundEndpoint,
      router: appRouter,
    })
  );

// Health check
app.get("/", (req, res) => {
  res.send("Hello World!");
});

// Websocket

const server = createServer();
const wss = new WebSocketServer({
  server,
});
server.on("request", app);
const handler = applyWSSHandler({
  wss,
  router: appRouter,
  // @ts-expect-error
  createContext,
  // // Enable heartbeat messages to keep connection open (disabled by default)
  // keepAlive: {
  //   enabled: true,
  //   // server ping message interval in milliseconds
  //   pingMs: 30000,
  //   // connection is terminated if pong message is not received in this many milliseconds
  //   pongWaitMs: 5000,
  // },
});

process.on("SIGTERM", () => {
  console.log("SIGTERM");
  handler.broadcastReconnectNotification();
  wss.close();
});

// ========================================
//               TRADING VIEW            //
// ========================================

app.get("/config", (req, res) => {
  const config = getConfig();
  res.send(config);
});
app.get(
  "/symbols",
  validateRequest({
    query: z.object({
      symbol: z.string().startsWith("AS1"),
    }),
  }),
  cache("1 hour"),
  async (req, res) => {
    const symbolInfo = await resolveSymbol(req.query.symbol);
    res.send(symbolInfo);
  }
);
app.get("/search", (req, res) => {
  const searchResults = searchSymbols();
  res.send(searchResults);
});
app.get(
  "/history",
  cache("1 minute"),
  validateRequest({
    query: z.object({
      symbol: z.string(),
      resolution: z.string(),
      from: z.string(),
      to: z.string(),
      countback: z.string(),
    }),
  }),
  async (req, res) => {
    const { resolution, symbol, from, to, countback } = req.query;
    const history = await getBars({
      symbol,
      resolution,
      from: Number(from),
      to: Number(to),
      countback: Number(countback),
    });
    res.send(history);
  }
);
app.get("/time", (req, res) => {
  const time = getServerTime();
  res.send(time.toString()); // express doesnt allow sending numbers (could be interpreted as status code)
});

// ========================================

const port: number = parseInt(process.env.PORT || "3001");
server.listen(port);
logger.info("Listening on port " + port);

// @ts-expect-error: Property 'toJSON' does not exist on type 'BigInt'
BigInt.prototype.toJSON = function (): string {
  return this.toString();
};

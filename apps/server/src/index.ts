import http from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp, type RealtimePublisher } from "./app";
import { loadEnv } from "./env";
import { PrismaChatRepository } from "./repositories/prismaChatRepository";
import { createAssetStorage } from "./storage";
import { attachRealtime } from "./socket";

const env = loadEnv();
const prisma = new PrismaClient();
const repo = new PrismaChatRepository(prisma);
const storage = createAssetStorage(env);
const realtime: RealtimePublisher = {
  emitMessage: () => undefined,
  emitProfileUpdated: () => undefined,
  emitMembersUpdated: () => undefined
};

const app = createApp({ env, repo, storage, realtime });
const httpServer = http.createServer(app);

attachRealtime(httpServer, env, repo, realtime);

httpServer.listen(env.port, async () => {
  await repo.ensureGlobalCommunity();
  console.log(`GCChat server listening on http://localhost:${env.port}`);
});

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

async function shutdown() {
  httpServer.close();
  await prisma.$disconnect();
  process.exit(0);
}

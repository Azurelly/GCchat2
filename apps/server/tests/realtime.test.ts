import http from "node:http";
import { AddressInfo } from "node:net";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type RealtimePublisher } from "../src/app";
import type { ServerEnv } from "../src/env";
import { attachRealtime } from "../src/socket";
import { MemoryAssetStorage } from "../src/storage";
import { InMemoryChatRepository } from "./inMemoryChatRepository";

const env: ServerEnv = {
  port: 0,
  clientOrigin: "http://localhost:5173",
  jwtSecret: "test-secret",
  supabaseAvatarsBucket: "avatars",
  supabaseAttachmentsBucket: "message-attachments"
};

let clients: Socket[] = [];

afterEach(() => {
  clients.forEach((client) => client.close());
  clients = [];
});

describe("realtime messaging", () => {
  it("broadcasts a new persisted message to other connected clients", async () => {
    const repo = new InMemoryChatRepository();
    const realtime: RealtimePublisher = {
      emitMessage: () => undefined,
      emitMessageUpdated: () => undefined,
      emitMessageDeleted: () => undefined,
      emitProfileUpdated: () => undefined,
      emitMembersUpdated: () => undefined,
      emitChannelsUpdated: () => undefined,
      emitSessionBanned: () => undefined,
      emitCalendarEvent: () => undefined,
      emitCalendarEventDeleted: () => undefined,
      emitAuditLog: () => undefined,
      emitEmojisUpdated: () => undefined
    };
    const app = createApp({ env, repo, storage: new MemoryAssetStorage(), realtime });
    const server = http.createServer(app);
    const io = attachRealtime(server, env, repo, realtime);

    await new Promise<void>((resolve) => server.listen(0, resolve));

    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const alice = await register(url, "Alice");
    const bob = await register(url, "Bob");
    const aliceSocket = connect(url, alice.token);
    const bobSocket = connect(url, bob.token);
    clients.push(aliceSocket, bobSocket);

    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);

    const received = new Promise<{ content: string }>((resolve) => {
      bobSocket.on("message:new", resolve);
    });

    aliceSocket.emit(
      "message:create",
      { channelId: alice.channelId, content: "Hello from realtime" },
      (response) => {
        expect(response.ok).toBe(true);
      }
    );

    await expect(received).resolves.toMatchObject({ content: "Hello from realtime" });

    io.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

async function register(url: string, username: string) {
  const response = await fetch(`${url}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "password123" })
  });

  const body = (await response.json()) as {
    token: string;
    channel: { id: string };
  };

  return { token: body.token, channelId: body.channel.id };
}

function connect(url: string, token: string) {
  return createClient(url, {
    auth: { token },
    transports: ["websocket"]
  });
}

function waitForConnect(socket: Socket) {
  return new Promise<void>((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", reject);
  });
}

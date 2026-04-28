import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { ServerEnv } from "../src/env";
import { MemoryAssetStorage } from "../src/storage";
import { InMemoryChatRepository } from "./inMemoryChatRepository";

const env: ServerEnv = {
  port: 0,
  clientOrigin: "http://localhost:5173",
  jwtSecret: "test-secret",
  supabaseAvatarsBucket: "avatars",
  supabaseAttachmentsBucket: "message-attachments"
};

function makeApp() {
  const repo = new InMemoryChatRepository();
  const app = createApp({ env, repo, storage: new MemoryAssetStorage() });
  return { app, repo };
}

describe("auth and profile API", () => {
  it("registers accounts, rejects duplicate usernames, and logs in", async () => {
    const { app } = makeApp();

    const registered = await request(app)
      .post("/auth/register")
      .send({ username: "Alice", password: "password123" })
      .expect(201);

    expect(registered.body.token).toEqual(expect.any(String));
    expect(registered.body.user.username).toBe("alice");
    expect(registered.body.channel.name).toBe("general");

    await request(app)
      .post("/auth/register")
      .send({ username: "alice", password: "password123" })
      .expect(409);

    await request(app)
      .post("/auth/login")
      .send({ username: "alice", password: "wrong-password" })
      .expect(401);

    const loggedIn = await request(app)
      .post("/auth/login")
      .send({ username: "alice", password: "password123" })
      .expect(200);

    expect(loggedIn.body.token).toEqual(expect.any(String));
  });

  it("updates profile personalization and exposes user profile cards", async () => {
    const { app } = makeApp();
    const registered = await request(app)
      .post("/auth/register")
      .send({ username: "Casey", password: "password123" })
      .expect(201);

    const token = registered.body.token as string;
    const userId = registered.body.user.id as string;

    const updated = await request(app)
      .patch("/me/profile")
      .set("authorization", `Bearer ${token}`)
      .send({
        displayName: "Casey Codes",
        bio: "Building the first version.",
        avatarUrl: "https://example.com/avatar.png"
      })
      .expect(200);

    expect(updated.body.displayName).toBe("Casey Codes");
    expect(updated.body.bio).toBe("Building the first version.");

    const card = await request(app)
      .get(`/users/${userId}/profile`)
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(card.body.createdAt).toEqual(expect.any(String));
    expect(card.body.avatarUrl).toBe("https://example.com/avatar.png");
  });
});

describe("messages API", () => {
  it("persists messages and returns message history in chronological order", async () => {
    const { app } = makeApp();
    const registered = await request(app)
      .post("/auth/register")
      .send({ username: "Morgan", password: "password123" })
      .expect(201);

    const token = registered.body.token as string;
    const channelId = registered.body.channel.id as string;

    await request(app)
      .post(`/channels/${channelId}/messages`)
      .set("authorization", `Bearer ${token}`)
      .send({ content: "First message" })
      .expect(201);

    await request(app)
      .post(`/channels/${channelId}/messages`)
      .set("authorization", `Bearer ${token}`)
      .send({
        content: "Second message",
        attachments: [
          {
            url: "https://example.com/image.png",
            fileName: "image.png",
            mimeType: "image/png",
            size: 1234
          }
        ]
      })
      .expect(201);

    const history = await request(app)
      .get(`/channels/${channelId}/messages`)
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(history.body.map((message: { content: string }) => message.content)).toEqual([
      "First message",
      "Second message"
    ]);
    expect(history.body[1].attachments[0].fileName).toBe("image.png");
  });
});

describe("calendar API", () => {
  it("creates calendar events, shows the creator, and lets other users opt in", async () => {
    const { app } = makeApp();
    const alice = await request(app)
      .post("/auth/register")
      .send({ username: "Alice", password: "password123" })
      .expect(201);
    const bob = await request(app)
      .post("/auth/register")
      .send({ username: "Bob", password: "password123" })
      .expect(201);

    const event = await request(app)
      .post("/calendar/events")
      .set("authorization", `Bearer ${alice.body.token}`)
      .send({
        title: "Dinner run",
        description: "Meet up and grab food.",
        startAt: "2026-05-03T18:30:00.000Z"
      })
      .expect(201);

    expect(event.body.title).toBe("Dinner run");
    expect(event.body.creator.username).toBe("alice");
    expect(event.body.viewerOptedIn).toBe(true);
    expect(event.body.optIns).toHaveLength(1);

    const optedIn = await request(app)
      .patch(`/calendar/events/${event.body.id}/opt-in`)
      .set("authorization", `Bearer ${bob.body.token}`)
      .send({ optedIn: true })
      .expect(200);

    expect(optedIn.body.viewerOptedIn).toBe(true);
    expect(optedIn.body.optIns.map((optIn: { user: { username: string } }) => optIn.user.username)).toEqual([
      "alice",
      "bob"
    ]);

    const history = await request(app)
      .get("/calendar/events")
      .set("authorization", `Bearer ${bob.body.token}`)
      .expect(200);

    expect(history.body).toHaveLength(1);
    expect(history.body[0].viewerOptedIn).toBe(true);
  });
});

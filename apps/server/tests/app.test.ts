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
  supabaseAttachmentsBucket: "message-attachments",
  livekitRoomName: "gcchat-general-voice"
};

function makeApp(overrides: Partial<ServerEnv> = {}) {
  const repo = new InMemoryChatRepository();
  const app = createApp({ env: { ...env, ...overrides }, repo, storage: new MemoryAssetStorage() });
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

  it("updates username and password from account settings", async () => {
    const { app } = makeApp();
    const registered = await request(app)
      .post("/auth/register")
      .send({ username: "Taylor", password: "password123" })
      .expect(201);

    await request(app)
      .patch("/me/account")
      .set("authorization", `Bearer ${registered.body.token}`)
      .send({
        username: "TaylorNew",
        currentPassword: "password123",
        newPassword: "newpassword123"
      })
      .expect(200);

    await request(app)
      .post("/auth/login")
      .send({ username: "taylornew", password: "password123" })
      .expect(401);

    await request(app)
      .post("/auth/login")
      .send({ username: "taylornew", password: "newpassword123" })
      .expect(200);
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

  it("persists replies and toggles reactions per user", async () => {
    const { app } = makeApp();
    const alex = await request(app)
      .post("/auth/register")
      .send({ username: "Alex", password: "password123" })
      .expect(201);
    const blair = await request(app)
      .post("/auth/register")
      .send({ username: "Blair", password: "password123" })
      .expect(201);

    const channelId = alex.body.channel.id as string;
    const parent = await request(app)
      .post(`/channels/${channelId}/messages`)
      .set("authorization", `Bearer ${alex.body.token}`)
      .send({ content: "Food run?" })
      .expect(201);

    const reply = await request(app)
      .post(`/channels/${channelId}/messages`)
      .set("authorization", `Bearer ${blair.body.token}`)
      .send({ content: "I'm in", replyToId: parent.body.id })
      .expect(201);

    expect(reply.body.replyTo.content).toBe("Food run?");
    expect(reply.body.replyTo.author.username).toBe("alex");

    const reacted = await request(app)
      .post(`/messages/${reply.body.id}/reactions`)
      .set("authorization", `Bearer ${alex.body.token}`)
      .send({ emoji: "👍" })
      .expect(200);

    expect(reacted.body.reactions).toHaveLength(1);
    expect(reacted.body.reactions[0].count).toBe(1);
    expect(reacted.body.reactions[0].users[0].username).toBe("alex");

    const removed = await request(app)
      .post(`/messages/${reply.body.id}/reactions`)
      .set("authorization", `Bearer ${alex.body.token}`)
      .send({ emoji: "👍" })
      .expect(200);

    expect(removed.body.reactions).toEqual([]);
  });
});

describe("voice API", () => {
  it("generates a LiveKit join token for active users", async () => {
    const { app } = makeApp({
      livekitWsUrl: "wss://gcchat-test.livekit.cloud",
      livekitApiKey: "test-key",
      livekitApiSecret: "test-secret"
    });
    const registered = await request(app)
      .post("/auth/register")
      .send({ username: "VoiceUser", password: "password123" })
      .expect(201);

    const voice = await request(app)
      .post("/voice/token")
      .set("authorization", `Bearer ${registered.body.token}`)
      .send({})
      .expect(200);

    expect(voice.body.url).toBe("wss://gcchat-test.livekit.cloud");
    expect(voice.body.roomName).toBe("gcchat-general-voice");
    expect(voice.body.identity).toBe(registered.body.user.id);
    expect(voice.body.token).toEqual(expect.any(String));
  });
});

describe("custom emoji API", () => {
  it("lets admins manage custom emojis and counts message usage", async () => {
    const { app } = makeApp();
    const owner = await request(app)
      .post("/auth/register")
      .send({ username: "Owner", password: "password123" })
      .expect(201);
    const friend = await request(app)
      .post("/auth/register")
      .send({ username: "Friend", password: "password123" })
      .expect(201);

    await request(app)
      .post("/emojis")
      .set("authorization", `Bearer ${friend.body.token}`)
      .send({ name: "party", imageUrl: "https://example.com/party.png" })
      .expect(403);

    const emoji = await request(app)
      .post("/emojis")
      .set("authorization", `Bearer ${owner.body.token}`)
      .send({ name: "Party", imageUrl: "https://example.com/party.png" })
      .expect(201);

    expect(emoji.body.name).toBe("party");
    expect(emoji.body.createdBy.username).toBe("owner");

    await request(app)
      .post(`/channels/${owner.body.channel.id}/messages`)
      .set("authorization", `Bearer ${friend.body.token}`)
      .send({ content: "let's go :party: :party:" })
      .expect(201);

    const emojisAfterUse = await request(app)
      .get("/emojis")
      .set("authorization", `Bearer ${owner.body.token}`)
      .expect(200);

    expect(emojisAfterUse.body[0].useCount).toBe(2);

    const renamed = await request(app)
      .patch(`/emojis/${emoji.body.id}`)
      .set("authorization", `Bearer ${owner.body.token}`)
      .send({ name: "food_run" })
      .expect(200);

    expect(renamed.body.name).toBe("food_run");

    const deleted = await request(app)
      .delete(`/emojis/${emoji.body.id}`)
      .set("authorization", `Bearer ${owner.body.token}`)
      .expect(200);

    expect(deleted.body).toEqual([]);
  });
});

describe("role and moderation API", () => {
  it("lets admins create channels and only super admins delete them", async () => {
    const { app } = makeApp();
    const owner = await request(app)
      .post("/auth/register")
      .send({ username: "Owner", password: "password123" })
      .expect(201);
    const friend = await request(app)
      .post("/auth/register")
      .send({ username: "Friend", password: "password123" })
      .expect(201);

    expect(owner.body.user.role).toBe("SUPER_ADMIN");

    await request(app)
      .post("/channels")
      .set("authorization", `Bearer ${friend.body.token}`)
      .send({ name: "plans" })
      .expect(403);

    const promoted = await request(app)
      .patch(`/users/${friend.body.user.id}/role`)
      .set("authorization", `Bearer ${owner.body.token}`)
      .send({ role: "ADMIN" })
      .expect(200);

    expect(promoted.body.role).toBe("ADMIN");

    const created = await request(app)
      .post("/channels")
      .set("authorization", `Bearer ${friend.body.token}`)
      .send({ name: "Food Plans" })
      .expect(201);

    expect(created.body.name).toBe("food-plans");

    await request(app)
      .delete(`/channels/${created.body.id}`)
      .set("authorization", `Bearer ${friend.body.token}`)
      .send({ confirmationName: "food-plans" })
      .expect(403);

    await request(app)
      .delete(`/channels/${created.body.id}`)
      .set("authorization", `Bearer ${owner.body.token}`)
      .send({ confirmationName: "wrong-name" })
      .expect(400);

    const channels = await request(app)
      .delete(`/channels/${created.body.id}`)
      .set("authorization", `Bearer ${owner.body.token}`)
      .send({ confirmationName: "food-plans" })
      .expect(200);

    expect(channels.body.map((channel: { name: string }) => channel.name)).toEqual(["general"]);
  });

  it("bans users from future logins and authenticated requests until unbanned", async () => {
    const { app } = makeApp();
    const owner = await request(app)
      .post("/auth/register")
      .send({ username: "Owner", password: "password123" })
      .expect(201);
    const target = await request(app)
      .post("/auth/register")
      .send({ username: "Target", password: "password123" })
      .expect(201);

    const banned = await request(app)
      .patch(`/users/${target.body.user.id}/ban`)
      .set("authorization", `Bearer ${owner.body.token}`)
      .send({ banned: true })
      .expect(200);

    expect(banned.body.bannedAt).toEqual(expect.any(String));

    const login = await request(app)
      .post("/auth/login")
      .send({ username: "target", password: "password123" })
      .expect(403);

    expect(login.body.error).toBe("You are banned");

    await request(app)
      .get("/me")
      .set("authorization", `Bearer ${target.body.token}`)
      .expect(403);

    const unbanned = await request(app)
      .patch(`/users/${target.body.user.id}/ban`)
      .set("authorization", `Bearer ${owner.body.token}`)
      .send({ banned: false })
      .expect(200);

    expect(unbanned.body.bannedAt).toBeNull();

    await request(app)
      .post("/auth/login")
      .send({ username: "target", password: "password123" })
      .expect(200);
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

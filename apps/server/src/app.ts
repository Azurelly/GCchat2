import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { AccessToken } from "livekit-server-sdk";
import multer from "multer";
import type {
  ChannelSummary,
  CustomEmojiView,
  AuditLogView,
  CalendarEventView,
  MessageView,
  ServerMemberView,
  UpdateProfileRequest,
  UploadKind,
  UserProfile,
  VoiceTokenResponse,
  YouTubeEmbedView
} from "@gcchat/shared";
import {
  hashPassword,
  normalizeUsername,
  signAuthToken,
  verifyAuthToken,
  verifyPassword,
  type AuthUser
} from "./auth";
import { asyncRoute, errorHandler, HttpError } from "./errors";
import type { ServerEnv } from "./env";
import type { ChatRepository } from "./repositories/chatRepository";
import type { AssetStorage } from "./storage";
import {
  createCalendarEventSchema,
  createChannelSchema,
  createCustomEmojiSchema,
  createMessageSchema,
  deleteChannelSchema,
  loginSchema,
  registerSchema,
  setCalendarEventOptInSchema,
  toggleMessageReactionSchema,
  updateMessageSchema,
  updateAccountSchema,
  updateCustomEmojiSchema,
  updateUserBanSchema,
  updateProfileSchema,
  updateUserRoleSchema
} from "./validation";

export interface RealtimePublisher {
  emitMessage(message: MessageView): void;
  emitMessageUpdated(message: MessageView): void;
  emitMessageDeleted(payload: { id: string; channelId: string }): void;
  emitProfileUpdated(profile: UserProfile): void;
  emitMembersUpdated(serverId: string, members: ServerMemberView[]): void;
  emitChannelsUpdated(serverId: string, channels: ChannelSummary[]): void;
  emitSessionBanned(userId: string): void;
  emitCalendarEvent(event: CalendarEventView): void;
  emitCalendarEventDeleted(payload: { id: string }): void;
  emitAuditLog(entry: AuditLogView): void;
  emitEmojisUpdated(emojis: CustomEmojiView[]): void;
}

export interface AppDependencies {
  env: ServerEnv;
  repo: ChatRepository;
  storage: AssetStorage;
  realtime?: RealtimePublisher;
}

interface AuthedRequest extends Request {
  user: AuthUser;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

export function createApp({ env, repo, storage, realtime }: AppDependencies) {
  const app = express();

  app.use(
    cors({
      origin: createCorsOrigin(env.clientOrigin),
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post(
    "/auth/register",
    asyncRoute(async (req, res) => {
      const parsed = registerSchema.parse(req.body);
      const username = normalizeUsername(parsed.username);
      const existing = await repo.findUserAuthByUsername(username);

      if (existing) {
        throw new HttpError(409, "Username is already taken");
      }

      const passwordHash = await hashPassword(parsed.password);
      const user = await repo.createUser({ username, passwordHash });
      const bootstrap = await repo.getBootstrap(user.id);
      const token = signAuthToken(user, env.jwtSecret);

      realtime?.emitMembersUpdated(bootstrap.server.id, bootstrap.members);
      res.status(201).json({ ...bootstrap, token });
    })
  );

  app.post(
    "/auth/login",
    asyncRoute(async (req, res) => {
      const parsed = loginSchema.parse(req.body);
      const username = normalizeUsername(parsed.username);
      const user = await repo.findUserAuthByUsername(username);

      if (!user || !(await verifyPassword(user.passwordHash, parsed.password))) {
        throw new HttpError(401, "Invalid username or password");
      }

      if (user.bannedAt) {
        throw new HttpError(403, "You are banned");
      }

      const bootstrap = await repo.getBootstrap(user.id);
      const token = signAuthToken(user, env.jwtSecret);

      res.json({ ...bootstrap, token });
    })
  );

  app.use(requireAuth(env.jwtSecret));
  app.use(requireActiveUser(repo));

  app.get(
    "/me",
    asyncRoute(async (req, res) => {
      const bootstrap = await repo.getBootstrap((req as AuthedRequest).user.id);
      res.json(bootstrap);
    })
  );

  app.patch(
    "/me/profile",
    asyncRoute(async (req, res) => {
      const parsed = updateProfileSchema.parse(req.body) as UpdateProfileRequest;
      const profile = await repo.updateProfile((req as AuthedRequest).user.id, parsed);
      realtime?.emitProfileUpdated(profile);
      res.json(profile);
    })
  );

  app.patch(
    "/me/account",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const parsed = updateAccountSchema.parse(req.body);
      const input: { username?: string; passwordHash?: string } = {};

      if (parsed.username) {
        const username = normalizeUsername(parsed.username);
        const existing = await repo.findUserAuthByUsername(username);

        if (existing && existing.id !== user.id) {
          throw new HttpError(409, "Username is already taken");
        }

        input.username = username;
      }

      if (parsed.newPassword) {
        const auth = await repo.findUserAuthById(user.id);

        if (!auth || !parsed.currentPassword || !(await verifyPassword(auth.passwordHash, parsed.currentPassword))) {
          throw new HttpError(401, "Current password is incorrect");
        }

        input.passwordHash = await hashPassword(parsed.newPassword);
      }

      const profile = await repo.updateAccount(user.id, input);
      realtime?.emitProfileUpdated(profile);
      res.json(profile);
    })
  );

  app.get(
    "/users/:id/profile",
    asyncRoute(async (req, res) => {
      const userId = requiredParam(req, "id");
      const profile = await repo.getProfile(userId);

      if (!profile) {
        throw new HttpError(404, "User not found");
      }

      res.json(profile);
    })
  );

  app.post(
    "/voice/token",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;

      if (!env.livekitWsUrl || !env.livekitApiKey || !env.livekitApiSecret) {
        throw new HttpError(503, "Voice is not configured yet");
      }

      const profile = await repo.getProfile(user.id);

      if (!profile) {
        throw new HttpError(401, "Invalid or expired session");
      }

      const accessToken = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
        identity: user.id,
        name: profile.displayName,
        ttl: "1h"
      });

      accessToken.addGrant({
        room: env.livekitRoomName,
        roomJoin: true,
        canPublish: true,
        canPublishData: true,
        canSubscribe: true
      });

      const response: VoiceTokenResponse = {
        token: await accessToken.toJwt(),
        url: env.livekitWsUrl,
        roomName: env.livekitRoomName,
        identity: user.id
      };

      res.json(response);
    })
  );

  app.get(
    "/servers/:id/members",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const serverId = requiredParam(req, "id");

      if (!(await repo.userHasServerAccess(user.id, serverId))) {
        throw new HttpError(403, "You are not a member of this server");
      }

      res.json(await repo.listServerMembers(serverId));
    })
  );

  app.post(
    "/channels",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const parsed = createChannelSchema.parse(req.body);
      const bootstrap = await repo.getBootstrap(user.id);
      const channel = await repo.createChannel({
        serverId: bootstrap.server.id,
        actorId: user.id,
        name: parsed.name
      });
      const channels = await repo.listChannels(bootstrap.server.id);

      realtime?.emitChannelsUpdated(bootstrap.server.id, channels);
      res.status(201).json(channel);
    })
  );

  app.delete(
    "/channels/:id",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const channelId = requiredParam(req, "id");
      const parsed = deleteChannelSchema.parse(req.body);
      const bootstrap = await repo.getBootstrap(user.id);
      const channels = await repo.deleteChannel(channelId, {
        actorId: user.id,
        confirmationName: parsed.confirmationName
      });

      realtime?.emitChannelsUpdated(bootstrap.server.id, channels);
      res.json(channels);
    })
  );

  app.get(
    "/channels/:id/messages",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const channelId = requiredParam(req, "id");

      if (!(await repo.userHasChannelAccess(user.id, channelId))) {
        throw new HttpError(403, "You cannot access this channel");
      }

      const page = await repo.listMessages(channelId, {
        limit: parseMessageLimit(req.query.limit),
        beforeMessageId: parseMessageCursor(req.query.before)
      });

      if (req.query.page === "1" || typeof req.query.before === "string") {
        res.json(page);
        return;
      }

      res.json(page.messages);
    })
  );

  app.get(
    "/embeds/youtube",
    asyncRoute(async (req, res) => {
      const inputUrl = typeof req.query.url === "string" ? req.query.url : "";
      const embed = await fetchYouTubeEmbed(inputUrl);
      res.json(embed);
    })
  );

  app.patch(
    "/users/:id/role",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const targetId = requiredParam(req, "id");
      const parsed = updateUserRoleSchema.parse(req.body);
      const profile = await repo.setUserRole(targetId, {
        actorId: user.id,
        role: parsed.role
      });
      const bootstrap = await repo.getBootstrap(user.id);
      const members = await repo.listServerMembers(bootstrap.server.id);

      realtime?.emitProfileUpdated(profile);
      realtime?.emitMembersUpdated(bootstrap.server.id, members);
      res.json(profile);
    })
  );

  app.patch(
    "/users/:id/ban",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const targetId = requiredParam(req, "id");
      const parsed = updateUserBanSchema.parse(req.body);
      const profile = await repo.setUserBan(targetId, {
        actorId: user.id,
        banned: parsed.banned
      });
      const bootstrap = await repo.getBootstrap(user.id);
      const members = await repo.listServerMembers(bootstrap.server.id);

      realtime?.emitProfileUpdated(profile);
      realtime?.emitMembersUpdated(bootstrap.server.id, members);

      if (parsed.banned) {
        realtime?.emitSessionBanned(targetId);
      }

      res.json(profile);
    })
  );

  app.post(
    "/channels/:id/messages",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const channelId = requiredParam(req, "id");

      if (!(await repo.userHasChannelAccess(user.id, channelId))) {
        throw new HttpError(403, "You cannot access this channel");
      }

      const parsed = createMessageSchema.parse(req.body);
      const message = await repo.createMessage({
        channelId,
        authorId: user.id,
        content: parsed.content,
        replyToId: parsed.replyToId,
        attachments: parsed.attachments
      });

      realtime?.emitMessage(message);
      if (hasCustomEmojiToken(parsed.content)) {
        realtime?.emitEmojisUpdated(await repo.listCustomEmojis());
      }
      res.status(201).json(message);
    })
  );

  app.patch(
    "/messages/:id",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const messageId = requiredParam(req, "id");
      const parsed = updateMessageSchema.parse(req.body);
      const message = await repo.updateMessage(messageId, {
        actorId: user.id,
        content: parsed.content
      });

      realtime?.emitMessageUpdated(message);
      res.json(message);
    })
  );

  app.delete(
    "/messages/:id",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const messageId = requiredParam(req, "id");
      const deleted = await repo.deleteMessage(messageId, { actorId: user.id });

      realtime?.emitMessageDeleted(deleted);
      res.json(deleted);
    })
  );

  app.post(
    "/messages/:id/reactions",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const messageId = requiredParam(req, "id");
      const parsed = toggleMessageReactionSchema.parse(req.body);
      const message = await repo.toggleMessageReaction(messageId, {
        userId: user.id,
        emoji: parsed.emoji
      });

      realtime?.emitMessageUpdated(message);
      res.json(message);
    })
  );

  app.get(
    "/calendar/events",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      res.json(await repo.listCalendarEvents(user.id));
    })
  );

  app.post(
    "/calendar/events",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const parsed = createCalendarEventSchema.parse(req.body);
      const event = await repo.createCalendarEvent({
        creatorId: user.id,
        title: parsed.title,
        description: parsed.description,
        startAt: parsed.startAt
      });

      realtime?.emitCalendarEvent(event);
      res.status(201).json(event);
    })
  );

  app.patch(
    "/calendar/events/:id/opt-in",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const eventId = requiredParam(req, "id");
      const parsed = setCalendarEventOptInSchema.parse(req.body);
      const event = await repo.setCalendarEventOptIn(user.id, eventId, parsed);

      realtime?.emitCalendarEvent(event);
      res.json(event);
    })
  );

  app.delete(
    "/calendar/events/:id",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const eventId = requiredParam(req, "id");
      const deleted = await repo.deleteCalendarEvent(eventId, { actorId: user.id });

      realtime?.emitCalendarEventDeleted(deleted);
      res.json(deleted);
    })
  );

  app.get(
    "/audit",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      res.json(await repo.listAuditLogs(user.id));
    })
  );

  app.post(
    "/audit/:id/restore",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const logId = requiredParam(req, "id");
      const restored = await repo.restoreAuditLogEntry(logId, { actorId: user.id });

      if (restored.message) {
        realtime?.emitMessage(restored.message);
      }

      if (restored.event) {
        realtime?.emitCalendarEvent(restored.event);
      }

      realtime?.emitAuditLog(restored.auditLog);
      res.json(restored);
    })
  );

  app.get(
    "/emojis",
    asyncRoute(async (_req, res) => {
      res.json(await repo.listCustomEmojis());
    })
  );

  app.post(
    "/emojis",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const parsed = createCustomEmojiSchema.parse(req.body);
      const emoji = await repo.createCustomEmoji({
        actorId: user.id,
        name: parsed.name,
        imageUrl: parsed.imageUrl
      });

      realtime?.emitEmojisUpdated(await repo.listCustomEmojis());
      res.status(201).json(emoji);
    })
  );

  app.patch(
    "/emojis/:id",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const emojiId = requiredParam(req, "id");
      const parsed = updateCustomEmojiSchema.parse(req.body);
      const emoji = await repo.updateCustomEmoji(emojiId, {
        actorId: user.id,
        name: parsed.name,
        imageUrl: parsed.imageUrl
      });

      realtime?.emitEmojisUpdated(await repo.listCustomEmojis());
      res.json(emoji);
    })
  );

  app.delete(
    "/emojis/:id",
    asyncRoute(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const emojiId = requiredParam(req, "id");
      const emojis = await repo.deleteCustomEmoji(emojiId, { actorId: user.id });

      realtime?.emitEmojisUpdated(emojis);
      res.json(emojis);
    })
  );

  app.post(
    "/uploads",
    upload.single("file"),
    asyncRoute(async (req, res) => {
      const kind = parseUploadKind(req.body.kind);
      const file = req.file;

      if (!file) {
        throw new HttpError(400, "File is required");
      }

      res.status(201).json(
        await storage.upload(kind, {
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          buffer: file.buffer
        })
      );
    })
  );

  app.use(errorHandler);
  return app;
}

function requireAuth(jwtSecret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

    if (!token) {
      next(new HttpError(401, "Missing session"));
      return;
    }

    try {
      (req as AuthedRequest).user = verifyAuthToken(token, jwtSecret);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireActiveUser(repo: ChatRepository) {
  return asyncRoute(async (req, _res, next) => {
    const profile = await repo.getProfile((req as AuthedRequest).user.id);

    if (!profile) {
      throw new HttpError(401, "Invalid or expired session");
    }

    if (profile.bannedAt) {
      throw new HttpError(403, "You are banned");
    }

    next();
  });
}

function parseMessageLimit(limit: unknown) {
  const parsed = Number(limit ?? 80);

  if (!Number.isFinite(parsed)) {
    return 80;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function parseMessageCursor(before: unknown) {
  return typeof before === "string" && before.trim().length > 0 ? before.trim() : null;
}

async function fetchYouTubeEmbed(inputUrl: string): Promise<YouTubeEmbedView> {
  const videoId = extractYouTubeVideoId(inputUrl);

  if (!videoId) {
    throw new HttpError(400, "Invalid YouTube URL");
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const fallback: YouTubeEmbedView = {
    url,
    videoId,
    title: "YouTube video",
    authorName: null,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    providerName: "YouTube"
  };

  const oembedUrl = new URL("https://www.youtube.com/oembed");
  oembedUrl.searchParams.set("url", url);
  oembedUrl.searchParams.set("format", "json");

  try {
    const response = await fetch(oembedUrl, {
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      return fallback;
    }

    const data = (await response.json()) as {
      title?: unknown;
      author_name?: unknown;
      thumbnail_url?: unknown;
    };

    return {
      ...fallback,
      title: typeof data.title === "string" && data.title.trim() ? data.title.trim() : fallback.title,
      authorName:
        typeof data.author_name === "string" && data.author_name.trim()
          ? data.author_name.trim()
          : fallback.authorName,
      thumbnailUrl:
        typeof data.thumbnail_url === "string" && data.thumbnail_url.trim()
          ? data.thumbnail_url.trim()
          : fallback.thumbnailUrl
    };
  } catch {
    return fallback;
  }
}

function extractYouTubeVideoId(input: string) {
  try {
    const url = new URL(input.trim());
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      return sanitizeYouTubeVideoId(url.pathname.slice(1).split("/")[0]);
    }

    if (!host.endsWith("youtube.com")) {
      return null;
    }

    if (url.pathname === "/watch") {
      return sanitizeYouTubeVideoId(url.searchParams.get("v"));
    }

    const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
    return sanitizeYouTubeVideoId(match?.[1] ?? null);
  } catch {
    return null;
  }
}

function sanitizeYouTubeVideoId(videoId: string | null | undefined) {
  return videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId) ? videoId : null;
}

function requiredParam(req: Request, name: string) {
  const value = req.params[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, `Missing route parameter: ${name}`);
  }

  return value;
}

function createCorsOrigin(clientOrigin: string) {
  const allowed = clientOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (!origin || allowed.includes("*") || allowed.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new HttpError(403, "Origin is not allowed"));
  };
}

function parseUploadKind(kind: unknown): UploadKind {
  if (kind === "avatar" || kind === "attachment" || kind === "emoji") {
    return kind;
  }

  throw new HttpError(400, "Upload kind must be avatar, attachment, or emoji");
}

function hasCustomEmojiToken(content: string) {
  return /:[a-z0-9_]{2,32}:/i.test(content);
}

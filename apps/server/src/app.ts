import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type {
  ChannelSummary,
  CalendarEventView,
  MessageView,
  ServerMemberView,
  UpdateProfileRequest,
  UploadKind,
  UserProfile
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
  createMessageSchema,
  deleteChannelSchema,
  loginSchema,
  registerSchema,
  setCalendarEventOptInSchema,
  updateUserBanSchema,
  updateProfileSchema,
  updateUserRoleSchema
} from "./validation";

export interface RealtimePublisher {
  emitMessage(message: MessageView): void;
  emitProfileUpdated(profile: UserProfile): void;
  emitMembersUpdated(serverId: string, members: ServerMemberView[]): void;
  emitChannelsUpdated(serverId: string, channels: ChannelSummary[]): void;
  emitSessionBanned(userId: string): void;
  emitCalendarEvent(event: CalendarEventView): void;
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

      res.json(await repo.listMessages(channelId, parseMessageLimit(req.query.limit)));
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
        attachments: parsed.attachments
      });

      realtime?.emitMessage(message);
      res.status(201).json(message);
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
  if (kind === "avatar" || kind === "attachment") {
    return kind;
  }

  throw new HttpError(400, "Upload kind must be avatar or attachment");
}

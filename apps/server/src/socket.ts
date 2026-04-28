import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@gcchat/shared";
import { verifyAuthToken, type AuthUser } from "./auth";
import { HttpError } from "./errors";
import type { ServerEnv } from "./env";
import type { ChatRepository } from "./repositories/chatRepository";
import type { RealtimePublisher } from "./app";
import { createMessageSchema } from "./validation";

interface SocketData {
  user: AuthUser;
  serverId?: string;
}

export function attachRealtime(
  httpServer: HttpServer,
  env: ServerEnv,
  repo: ChatRepository,
  realtime: RealtimePublisher
) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    httpServer,
    {
      cors: { origin: env.clientOrigin, credentials: true }
    }
  );
  const onlineUsers = new Map<string, number>();

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (typeof token !== "string") {
      next(new Error("Missing session"));
      return;
    }

    try {
      socket.data.user = verifyAuthToken(token, env.jwtSecret);
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("Invalid session"));
    }
  });

  io.on("connection", (socket) => {
    void repo
      .getBootstrap(socket.data.user.id)
      .then((bootstrap) => {
        if (bootstrap.user.bannedAt) {
          socket.emit("session:banned");
          socket.disconnect(true);
          return;
        }

        socket.data.serverId = bootstrap.server.id;
        incrementOnline(onlineUsers, socket.data.user.id);
        socket.join(userRoom(socket.data.user.id));
        socket.join(channelRoom(bootstrap.channel.id));
        socket.join(serverRoom(bootstrap.server.id));
        void emitMembersWithPresence(bootstrap.server.id);
      })
      .catch(() => socket.disconnect(true));

    socket.on("disconnect", () => {
      const serverId = socket.data.serverId;

      decrementOnline(onlineUsers, socket.data.user.id);

      if (serverId) {
        void emitMembersWithPresence(serverId);
      }
    });

    socket.on("channel:join", async (payload, ack) => {
      try {
        await assertSocketActive(socket.data.user.id);

        if (!(await repo.userHasChannelAccess(socket.data.user.id, payload.channelId))) {
          throw new HttpError(403, "You cannot access this channel");
        }

        socket.join(channelRoom(payload.channelId));
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: getErrorMessage(error) });
      }
    });

    socket.on("message:create", async (payload, ack) => {
      try {
        await assertSocketActive(socket.data.user.id);

        if (!(await repo.userHasChannelAccess(socket.data.user.id, payload.channelId))) {
          throw new HttpError(403, "You cannot access this channel");
        }

        const parsed = createMessageSchema.parse(payload);
        const message = await repo.createMessage({
          channelId: payload.channelId,
          authorId: socket.data.user.id,
          content: parsed.content,
          attachments: parsed.attachments
        });

        io.to(channelRoom(message.channelId)).emit("message:new", message);
        ack?.({ ok: true, message });
      } catch (error) {
        ack?.({ ok: false, error: getErrorMessage(error) });
      }
    });
  });

  realtime.emitMessage = (message) => {
    io.to(channelRoom(message.channelId)).emit("message:new", message);
  };

  realtime.emitProfileUpdated = (profile) => {
    io.emit("profile:updated", profile);
  };

  realtime.emitMembersUpdated = (serverId, members) => {
    io.to(serverRoom(serverId)).emit("members:updated", withPresence(members, onlineUsers));
  };

  realtime.emitChannelsUpdated = (serverId, channels) => {
    io.to(serverRoom(serverId)).emit("channels:updated", channels);
  };

  realtime.emitSessionBanned = (userId) => {
    io.to(userRoom(userId)).emit("session:banned");
    setTimeout(() => io.in(userRoom(userId)).disconnectSockets(true), 100);
  };

  realtime.emitCalendarEvent = (event) => {
    io.emit("calendar:event:upsert", event);
  };

  return io;

  async function emitMembersWithPresence(serverId: string) {
    const members = await repo.listServerMembers(serverId);
    io.to(serverRoom(serverId)).emit("members:updated", withPresence(members, onlineUsers));
  }

  async function assertSocketActive(userId: string) {
    const profile = await repo.getProfile(userId);

    if (profile?.bannedAt) {
      io.to(userRoom(userId)).emit("session:banned");
      throw new HttpError(403, "You are banned");
    }
  }
}

function channelRoom(channelId: string) {
  return `channel:${channelId}`;
}

function serverRoom(serverId: string) {
  return `server:${serverId}`;
}

function userRoom(userId: string) {
  return `user:${userId}`;
}

function incrementOnline(onlineUsers: Map<string, number>, userId: string) {
  onlineUsers.set(userId, (onlineUsers.get(userId) ?? 0) + 1);
}

function decrementOnline(onlineUsers: Map<string, number>, userId: string) {
  const count = onlineUsers.get(userId) ?? 0;

  if (count <= 1) {
    onlineUsers.delete(userId);
    return;
  }

  onlineUsers.set(userId, count - 1);
}

function withPresence<T extends { id: string; isOnline: boolean }>(
  members: T[],
  onlineUsers: Map<string, number>
) {
  return members.map((member) => ({
    ...member,
    isOnline: onlineUsers.has(member.id)
  }));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}

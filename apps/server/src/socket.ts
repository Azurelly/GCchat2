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
        socket.join(channelRoom(bootstrap.channel.id));
        socket.join(serverRoom(bootstrap.server.id));
      })
      .catch(() => socket.disconnect(true));

    socket.on("channel:join", async (payload, ack) => {
      try {
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
    io.to(serverRoom(serverId)).emit("members:updated", members);
  };

  return io;
}

function channelRoom(channelId: string) {
  return `channel:${channelId}`;
}

function serverRoom(serverId: string) {
  return `server:${serverId}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}

import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  UserRole,
  VoiceParticipantState,
  VoiceStateView
} from "@gcchat/shared";
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

interface VoicePresence {
  userId: string;
  selfMuted: boolean;
  selfDeafened: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  screenSharing: boolean;
  reconnecting: boolean;
  joinedAt: string;
  updatedAt: string;
}

interface VoiceModerationState {
  serverMuted: boolean;
  serverDeafened: boolean;
}

const voiceChannelName = "General Voice";
const voiceReconnectGraceMs = 45000;

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
  const voiceParticipants = new Map<string, VoicePresence>();
  const voiceParticipantSockets = new Map<string, Set<string>>();
  const voiceModeration = new Map<string, VoiceModerationState>();
  const voiceReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
        socket.emit("voice:state", buildVoiceState());
        void emitMembersWithPresence(bootstrap.server.id);
      })
      .catch(() => socket.disconnect(true));

    socket.on("disconnect", () => {
      const serverId = socket.data.serverId;

      decrementOnline(onlineUsers, socket.data.user.id);

      if (serverId) {
        void emitMembersWithPresence(serverId);
      }

      const voiceSocketState = unregisterVoiceSocket(socket.data.user.id, socket.id);

      if (voiceSocketState.wasRegistered && !voiceSocketState.hasRemainingSockets) {
        logVoice("socket-disconnect-mark-reconnecting", {
          userId: socket.data.user.id,
          socketId: socket.id
        });
        markVoiceParticipantReconnecting(socket.data.user.id);
      } else if (voiceSocketState.wasRegistered) {
        logVoice("socket-disconnect-kept-present", {
          userId: socket.data.user.id,
          socketId: socket.id
        });
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
          replyToId: parsed.replyToId,
          attachments: parsed.attachments
        });

        io.to(channelRoom(message.channelId)).emit("message:new", message);
        if (hasCustomEmojiToken(parsed.content)) {
          io.emit("emojis:updated", await repo.listCustomEmojis());
        }
        ack?.({ ok: true, message });
      } catch (error) {
        ack?.({ ok: false, error: getErrorMessage(error) });
      }
    });

    socket.on("voice:join", async (ack) => {
      try {
        await assertSocketActive(socket.data.user.id);
        const now = new Date().toISOString();
        const moderation = voiceModeration.get(socket.data.user.id) ?? {
          serverMuted: false,
          serverDeafened: false
        };
        const existing = voiceParticipants.get(socket.data.user.id);

        const nextPresence: VoicePresence = {
          userId: socket.data.user.id,
          selfMuted: existing?.selfMuted ?? (moderation.serverMuted || moderation.serverDeafened),
          selfDeafened: existing?.selfDeafened ?? moderation.serverDeafened,
          serverMuted: moderation.serverMuted,
          serverDeafened: moderation.serverDeafened,
          screenSharing: existing?.screenSharing ?? false,
          reconnecting: false,
          joinedAt: existing?.joinedAt ?? now,
          updatedAt: now
        };
        const shouldBroadcast =
          !existing ||
          existing.reconnecting ||
          existing.selfMuted !== nextPresence.selfMuted ||
          existing.selfDeafened !== nextPresence.selfDeafened ||
          existing.serverMuted !== nextPresence.serverMuted ||
          existing.serverDeafened !== nextPresence.serverDeafened ||
          existing.screenSharing !== nextPresence.screenSharing;

        clearVoiceReconnectTimer(socket.data.user.id);
        registerVoiceSocket(socket.data.user.id, socket.id);
        voiceParticipants.set(socket.data.user.id, nextPresence);
        const state = buildVoiceState();

        logVoice("join", {
          userId: socket.data.user.id,
          socketId: socket.id,
          hadExisting: Boolean(existing),
          wasReconnecting: Boolean(existing?.reconnecting),
          shouldBroadcast
        });

        if (shouldBroadcast) {
          io.emit("voice:state", state);
        }

        ack?.({ ok: true, state });
      } catch (error) {
        ack?.({ ok: false, error: getErrorMessage(error) });
      }
    });

    socket.on("voice:leave", async (ack) => {
      try {
        await assertSocketActive(socket.data.user.id);
        const voiceSocketState = unregisterVoiceSocket(socket.data.user.id, socket.id);

        if (!voiceSocketState.hasRemainingSockets) {
          clearVoiceReconnectTimer(socket.data.user.id);
          voiceParticipants.delete(socket.data.user.id);
          logVoice("leave-removed", {
            userId: socket.data.user.id,
            socketId: socket.id,
            wasRegistered: voiceSocketState.wasRegistered
          });
          io.emit("voice:state", buildVoiceState());
        } else {
          logVoice("leave-kept-present", {
            userId: socket.data.user.id,
            socketId: socket.id
          });
        }

        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: getErrorMessage(error) });
      }
    });

    socket.on("voice:self-state", async (payload, ack) => {
      try {
        await assertSocketActive(socket.data.user.id);
        const now = new Date().toISOString();
        const moderation = voiceModeration.get(socket.data.user.id) ?? {
          serverMuted: false,
          serverDeafened: false
        };
        const existing = voiceParticipants.get(socket.data.user.id);
        const basePresence: VoicePresence = existing ?? {
          userId: socket.data.user.id,
          selfMuted: moderation.serverMuted || moderation.serverDeafened,
          selfDeafened: moderation.serverDeafened,
          serverMuted: moderation.serverMuted,
          serverDeafened: moderation.serverDeafened,
          screenSharing: false,
          reconnecting: false,
          joinedAt: now,
          updatedAt: now
        };

        const selfDeafened = payload.selfDeafened ?? basePresence.selfDeafened;
        const moderatedMuted = basePresence.serverMuted || basePresence.serverDeafened;
        const next: VoicePresence = {
          ...basePresence,
          selfMuted: moderatedMuted || selfDeafened || (payload.selfMuted ?? basePresence.selfMuted),
          selfDeafened,
          screenSharing: payload.screenSharing ?? basePresence.screenSharing,
          reconnecting: false,
          updatedAt: now
        };

        const shouldBroadcast =
          !existing ||
          existing.selfMuted !== next.selfMuted ||
          existing.selfDeafened !== next.selfDeafened ||
          existing.screenSharing !== next.screenSharing ||
          existing.reconnecting;

        clearVoiceReconnectTimer(socket.data.user.id);
        registerVoiceSocket(socket.data.user.id, socket.id);
        voiceParticipants.set(socket.data.user.id, next);
        const state = buildVoiceState();

        logVoice("self-state", {
          userId: socket.data.user.id,
          socketId: socket.id,
          hadExisting: Boolean(existing),
          recreatedMissingPresence: !existing,
          shouldBroadcast,
          payload
        });

        if (shouldBroadcast) {
          io.emit("voice:state", state);
        }

        ack?.({ ok: true, state });
      } catch (error) {
        ack?.({ ok: false, error: getErrorMessage(error) });
      }
    });

    socket.on("voice:moderate", async (payload, ack) => {
      try {
        await assertSocketActive(socket.data.user.id);
        const actor = await repo.getProfile(socket.data.user.id);

        if (!actor || !hasAtLeastRole(actor.role, "ADMIN")) {
          throw new HttpError(403, "Admin permissions are required");
        }

        if (payload.targetUserId === socket.data.user.id) {
          throw new HttpError(400, "You cannot moderate your own voice state");
        }

        const now = new Date().toISOString();
        const currentModeration = voiceModeration.get(payload.targetUserId) ?? {
          serverMuted: false,
          serverDeafened: false
        };
        const nextModeration = {
          serverMuted: payload.serverMuted ?? currentModeration.serverMuted,
          serverDeafened: payload.serverDeafened ?? currentModeration.serverDeafened
        };

        voiceModeration.set(payload.targetUserId, nextModeration);

        if (payload.disconnect) {
          clearVoiceReconnectTimer(payload.targetUserId);
          voiceParticipantSockets.delete(payload.targetUserId);
          voiceParticipants.delete(payload.targetUserId);
          io.to(userRoom(payload.targetUserId)).emit("voice:force-disconnect");
        } else {
          const currentPresence = voiceParticipants.get(payload.targetUserId);

          if (currentPresence) {
            const nextPresence: VoicePresence = {
              ...currentPresence,
              serverMuted: nextModeration.serverMuted,
              serverDeafened: nextModeration.serverDeafened,
              selfMuted:
                nextModeration.serverMuted ||
                nextModeration.serverDeafened ||
                currentPresence.selfDeafened ||
                currentPresence.selfMuted,
              selfDeafened: nextModeration.serverDeafened || currentPresence.selfDeafened,
              updatedAt: now
            };

            voiceParticipants.set(payload.targetUserId, nextPresence);
            io.to(userRoom(payload.targetUserId)).emit("voice:moderated", toVoiceParticipantState(nextPresence));
          }
        }

        const state = buildVoiceState();
        io.emit("voice:state", state);
        ack?.({ ok: true, state });
      } catch (error) {
        ack?.({ ok: false, error: getErrorMessage(error) });
      }
    });
  });

  realtime.emitMessage = (message) => {
    io.to(channelRoom(message.channelId)).emit("message:new", message);
  };

  realtime.emitMessageUpdated = (message) => {
    io.to(channelRoom(message.channelId)).emit("message:updated", message);
  };

  realtime.emitMessageDeleted = (payload) => {
    io.to(channelRoom(payload.channelId)).emit("message:deleted", payload);
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

  realtime.emitCalendarEventDeleted = (payload) => {
    io.emit("calendar:event:deleted", payload);
  };

  realtime.emitAuditLog = (entry) => {
    io.emit("audit:new", entry);
  };

  realtime.emitEmojisUpdated = (emojis) => {
    io.emit("emojis:updated", emojis);
  };

  return io;

  function logVoice(event: string, details: Record<string, unknown> = {}) {
    try {
      console.info(
        `[voice] ${event}`,
        JSON.stringify({
          at: new Date().toISOString(),
          ...details,
          participantSocketCounts: Object.fromEntries(
            Array.from(voiceParticipantSockets.entries()).map(([userId, sockets]) => [userId, sockets.size])
          ),
          participants: Array.from(voiceParticipants.values()).map((presence) => ({
            userId: presence.userId,
            selfMuted: presence.selfMuted,
            selfDeafened: presence.selfDeafened,
            serverMuted: presence.serverMuted,
            serverDeafened: presence.serverDeafened,
            screenSharing: presence.screenSharing,
            reconnecting: presence.reconnecting,
            joinedAt: presence.joinedAt,
            updatedAt: presence.updatedAt
          }))
        })
      );
    } catch {
      console.info(`[voice] ${event}`);
    }
  }

  function buildVoiceState(): VoiceStateView {
    return {
      channelName: voiceChannelName,
      participants: Array.from(voiceParticipants.values())
        .map(toVoiceParticipantState)
        .sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt))
    };
  }

  function markVoiceParticipantReconnecting(userId: string) {
    const existing = voiceParticipants.get(userId);

    if (!existing || voiceReconnectTimers.has(userId)) {
      return;
    }

    voiceParticipants.set(userId, {
      ...existing,
      reconnecting: true,
      updatedAt: new Date().toISOString()
    });
    logVoice("mark-reconnecting", { userId });
    io.emit("voice:state", buildVoiceState());

    voiceReconnectTimers.set(
      userId,
      setTimeout(() => {
        voiceReconnectTimers.delete(userId);
        const current = voiceParticipants.get(userId);

        if (current?.reconnecting) {
          voiceParticipants.delete(userId);
          logVoice("remove-after-reconnect-grace", { userId });
          io.emit("voice:state", buildVoiceState());
        }
      }, voiceReconnectGraceMs)
    );
  }

  function clearVoiceReconnectTimer(userId: string) {
    const timer = voiceReconnectTimers.get(userId);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    voiceReconnectTimers.delete(userId);
  }

  function registerVoiceSocket(userId: string, socketId: string) {
    const sockets = voiceParticipantSockets.get(userId) ?? new Set<string>();

    sockets.add(socketId);
    voiceParticipantSockets.set(userId, sockets);
  }

  function unregisterVoiceSocket(userId: string, socketId: string) {
    const sockets = voiceParticipantSockets.get(userId);

    if (!sockets) {
      return { wasRegistered: false, hasRemainingSockets: false };
    }

    const wasRegistered = sockets.delete(socketId);

    if (sockets.size === 0) {
      voiceParticipantSockets.delete(userId);
      return { wasRegistered, hasRemainingSockets: false };
    }

    return { wasRegistered, hasRemainingSockets: true };
  }

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

function hasCustomEmojiToken(content: string) {
  return /:[a-z0-9_]{2,32}:/i.test(content);
}

function toVoiceParticipantState(presence: VoicePresence): VoiceParticipantState {
  return {
    userId: presence.userId,
    selfMuted: presence.selfMuted,
    selfDeafened: presence.selfDeafened,
    serverMuted: presence.serverMuted,
    serverDeafened: presence.serverDeafened,
    screenSharing: presence.screenSharing,
    reconnecting: presence.reconnecting,
    joinedAt: presence.joinedAt,
    updatedAt: presence.updatedAt
  };
}

function hasAtLeastRole(role: UserRole, minimum: "ADMIN" | "SUPER_ADMIN") {
  const rank: Record<UserRole, number> = {
    USER: 0,
    ADMIN: 1,
    SUPER_ADMIN: 2
  };

  return rank[role] >= rank[minimum];
}

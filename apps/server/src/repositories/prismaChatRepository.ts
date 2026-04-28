import { PrismaClient, type Prisma } from "@prisma/client";
import {
  type AuditAction,
  type AuditLogView,
  GLOBAL_CHANNEL_NAME,
  GLOBAL_SERVER_NAME,
  type AttachmentView,
  type BootstrapPayload,
  type CalendarEventView,
  type ChannelSummary,
  type CustomEmojiView,
  type CreateChannelRequest,
  type CreateCalendarEventRequest,
  type CreateCustomEmojiRequest,
  type CreateMessageRequest,
  type DeleteChannelRequest,
  type MessageReactionView,
  type MessageReplyView,
  type MessageView,
  type RestoreAuditLogResponse,
  type SetCalendarEventOptInRequest,
  type ServerMemberView,
  type ServerSummary,
  type ToggleMessageReactionRequest,
  type UpdateMessageRequest,
  type UpdateAccountRequest,
  type UpdateCustomEmojiRequest,
  type UpdateUserBanRequest,
  type UpdateProfileRequest,
  type UpdateUserRoleRequest,
  type UserRole,
  type UserProfile
} from "@gcchat/shared";
import type { ChatRepository, GlobalCommunity, UserAuthRecord } from "./chatRepository";
import { HttpError } from "../errors";

type UserWithProfile = {
  id: string;
  username: string;
  role: UserRole;
  bannedAt: Date | null;
  createdAt: Date;
  profile: {
    displayName: string;
    bio: string;
    avatarUrl: string | null;
  } | null;
};

type MessageWithRelations = {
  id: string;
  channelId: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  author: UserWithProfile;
  attachments: AttachmentView[];
  replyTo: MessageReplyWithRelations | null;
  reactions: MessageReactionWithRelations[];
};

type MessageReplyWithRelations = {
  id: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  author: UserWithProfile;
  attachments: AttachmentView[];
};

type MessageReactionWithRelations = {
  emoji: string;
  createdAt: Date;
  user: UserWithProfile;
};

type CalendarEventWithRelations = {
  id: string;
  title: string;
  description: string;
  startAt: Date;
  createdAt: Date;
  deletedAt: Date | null;
  creator: UserWithProfile;
  optIns: Array<{
    createdAt: Date;
    user: UserWithProfile;
  }>;
};

type CustomEmojiWithRelations = {
  id: string;
  name: string;
  imageUrl: string;
  useCount: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: UserWithProfile;
};

type AuditLogWithRelations = {
  id: string;
  action: AuditAction;
  actorId: string | null;
  targetUserId: string | null;
  messageId: string | null;
  channelId: string | null;
  calendarEventId: string | null;
  metadata: Prisma.JsonValue;
  restoredAt: Date | null;
  createdAt: Date;
  actor: UserWithProfile | null;
  targetUser: UserWithProfile | null;
};

const GLOBAL_SERVER_KEY = "global";

const calendarEventInclude = {
  creator: { include: { profile: true } },
  optIns: {
    include: { user: { include: { profile: true } } },
    orderBy: { createdAt: "asc" as const }
  }
};

const customEmojiInclude = {
  createdBy: { include: { profile: true } }
};

const auditLogInclude = {
  actor: { include: { profile: true } },
  targetUser: { include: { profile: true } }
};

const messageInclude = {
  author: { include: { profile: true } },
  attachments: { orderBy: { createdAt: "asc" as const } },
  replyTo: {
    include: {
      author: { include: { profile: true } },
      attachments: { orderBy: { createdAt: "asc" as const } }
    }
  },
  reactions: {
    include: { user: { include: { profile: true } } },
    orderBy: { createdAt: "asc" as const }
  }
};

export class PrismaChatRepository implements ChatRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async ensureGlobalCommunity(): Promise<GlobalCommunity> {
    const server = await this.prisma.server.upsert({
      where: { key: GLOBAL_SERVER_KEY },
      update: {},
      create: {
        key: GLOBAL_SERVER_KEY,
        name: GLOBAL_SERVER_NAME,
        channels: { create: { name: GLOBAL_CHANNEL_NAME } }
      },
      include: { channels: { where: { name: GLOBAL_CHANNEL_NAME }, take: 1 } }
    });

    let channel = server.channels[0];

    if (!channel) {
      channel = await this.prisma.channel.create({
        data: { serverId: server.id, name: GLOBAL_CHANNEL_NAME }
      });
    }

    return {
      server: { id: server.id, name: server.name, iconUrl: server.iconUrl },
      channel: { id: channel.id, serverId: server.id, name: channel.name }
    };
  }

  public async createUser(input: { username: string; passwordHash: string }) {
    const global = await this.ensureGlobalCommunity();
    const existingUsers = await this.prisma.user.count();

    const user = await this.prisma.user.create({
      data: {
        username: input.username,
        passwordHash: input.passwordHash,
        role: existingUsers === 0 ? "SUPER_ADMIN" : "USER",
        profile: { create: { displayName: input.username } },
        memberships: { create: { serverId: global.server.id } }
      },
      include: { profile: true }
    });

    return mapUserProfile(user);
  }

  public async findUserAuthByUsername(username: string): Promise<UserAuthRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, passwordHash: true, bannedAt: true }
    });

    return mapAuthRecord(user);
  }

  public async findUserAuthById(userId: string): Promise<UserAuthRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, passwordHash: true, bannedAt: true }
    });

    return mapAuthRecord(user);
  }

  public async getBootstrap(userId: string): Promise<BootstrapPayload> {
    const global = await this.ensureGlobalCommunity();

    await this.prisma.membership.upsert({
      where: { userId_serverId: { userId, serverId: global.server.id } },
      update: {},
      create: { userId, serverId: global.server.id }
    });

    const user = await this.getProfile(userId);

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    return {
      user,
      server: global.server,
      channel: global.channel,
      channels: await this.listChannels(global.server.id),
      members: await this.listServerMembers(global.server.id)
    };
  }

  public async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    });

    return user ? mapUserProfile(user) : null;
  }

  public async updateProfile(userId: string, input: UpdateProfileRequest) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    });

    if (!existing) {
      throw new HttpError(404, "User not found");
    }

    await this.prisma.profile.upsert({
      where: { userId },
      update: {
        displayName: input.displayName,
        bio: input.bio,
        avatarUrl: input.avatarUrl
      },
      create: {
        userId,
        displayName: input.displayName ?? existing.username,
        bio: input.bio ?? "",
        avatarUrl: input.avatarUrl
      }
    });

    const user = await this.getProfile(userId);

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    return user;
  }

  public async updateAccount(
    userId: string,
    input: Omit<UpdateAccountRequest, "currentPassword"> & { passwordHash?: string }
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    });

    if (!existing) {
      throw new HttpError(404, "User not found");
    }

    const data: { username?: string; passwordHash?: string } = {};

    if (input.username) {
      data.username = input.username;
    }

    if (input.passwordHash) {
      data.passwordHash = input.passwordHash;
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      include: { profile: true }
    });

    return mapUserProfile(user);
  }

  public async listServerMembers(serverId: string): Promise<ServerMemberView[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { serverId },
      include: { user: { include: { profile: true } } },
      orderBy: { joinedAt: "asc" }
    });

    return memberships.map((membership) => ({
      ...mapUserProfile(membership.user),
      joinedAt: membership.joinedAt.toISOString(),
      isOnline: false
    }));
  }

  public async listChannels(serverId: string): Promise<ChannelSummary[]> {
    const channels = await this.prisma.channel.findMany({
      where: { serverId },
      orderBy: { createdAt: "asc" }
    });

    return channels.map(mapChannel);
  }

  public async createChannel(
    input: { serverId: string; actorId: string } & CreateChannelRequest
  ): Promise<ChannelSummary> {
    await this.assertAdmin(input.actorId);
    const name = normalizeChannelName(input.name);

    if (!name) {
      throw new HttpError(400, "Channel name is required");
    }

    const existing = await this.prisma.channel.findUnique({
      where: { serverId_name: { serverId: input.serverId, name } },
      select: { id: true }
    });

    if (existing) {
      throw new HttpError(409, "A channel with that name already exists");
    }

    const channel = await this.prisma.channel.create({
      data: { serverId: input.serverId, name }
    });

    return mapChannel(channel);
  }

  public async deleteChannel(
    channelId: string,
    input: { actorId: string } & DeleteChannelRequest
  ): Promise<ChannelSummary[]> {
    await this.assertSuperAdmin(input.actorId);

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, serverId: true, name: true }
    });

    if (!channel) {
      throw new HttpError(404, "Channel not found");
    }

    if (input.confirmationName !== channel.name) {
      throw new HttpError(400, "Type the channel name exactly to delete it");
    }

    const channelCount = await this.prisma.channel.count({
      where: { serverId: channel.serverId }
    });

    if (channelCount <= 1) {
      throw new HttpError(400, "You cannot delete the last text channel");
    }

    await this.prisma.channel.delete({ where: { id: channelId } });
    return this.listChannels(channel.serverId);
  }

  public async setUserRole(
    targetUserId: string,
    input: { actorId: string } & UpdateUserRoleRequest
  ): Promise<UserProfile> {
    await this.assertSuperAdmin(input.actorId);

    if (targetUserId === input.actorId) {
      throw new HttpError(400, "You cannot change your own role");
    }

    const target = await this.getProfile(targetUserId);

    if (!target) {
      throw new HttpError(404, "User not found");
    }

    if (target.role === "SUPER_ADMIN") {
      throw new HttpError(400, "Super admins cannot be changed here");
    }

    const user = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: input.role },
      include: { profile: true }
    });

    await this.createAuditLog({
      action: "USER_ROLE_UPDATE",
      actorId: input.actorId,
      targetUserId,
      metadata: {
        beforeRole: target.role,
        afterRole: input.role
      }
    });

    return mapUserProfile(user);
  }

  public async setUserBan(
    targetUserId: string,
    input: { actorId: string } & UpdateUserBanRequest
  ): Promise<UserProfile> {
    await this.assertSuperAdmin(input.actorId);

    if (targetUserId === input.actorId) {
      throw new HttpError(400, "You cannot ban yourself");
    }

    const target = await this.getProfile(targetUserId);

    if (!target) {
      throw new HttpError(404, "User not found");
    }

    if (target.role === "SUPER_ADMIN") {
      throw new HttpError(400, "Super admins cannot be banned");
    }

    const user = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { bannedAt: input.banned ? new Date() : null },
      include: { profile: true }
    });

    await this.createAuditLog({
      action: input.banned ? "USER_BAN" : "USER_UNBAN",
      actorId: input.actorId,
      targetUserId,
      metadata: {
        bannedAt: user.bannedAt?.toISOString() ?? null
      }
    });

    return mapUserProfile(user);
  }

  public async userHasServerAccess(userId: string, serverId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId, serverId } },
      select: { id: true }
    });

    return Boolean(membership);
  }

  public async userHasChannelAccess(userId: string, channelId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: channelId,
        server: { memberships: { some: { userId } } }
      },
      select: { id: true }
    });

    return Boolean(channel);
  }

  public async listMessages(channelId: string, limit: number): Promise<MessageView[]> {
    const messages = await this.prisma.message.findMany({
      where: { channelId, deletedAt: null },
      include: messageInclude,
      orderBy: { createdAt: "desc" },
      take: limit
    });

    return messages.reverse().map(mapMessage);
  }

  public async createMessage(
    input: { channelId: string; authorId: string } & CreateMessageRequest
  ) {
    const emojiNames = extractCustomEmojiNames(input.content);
    const replyToId = input.replyToId ?? null;

    if (replyToId) {
      const replyTo = await this.prisma.message.findUnique({
        where: { id: replyToId },
        select: { channelId: true, deletedAt: true }
      });

      if (!replyTo || replyTo.channelId !== input.channelId || replyTo.deletedAt) {
        throw new HttpError(400, "Reply target must be in this channel");
      }
    }

    const message = await this.prisma.message.create({
      data: {
        channelId: input.channelId,
        authorId: input.authorId,
        replyToId,
        content: input.content,
        attachments: {
          create: input.attachments?.map((attachment) => ({
            url: attachment.url,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            size: attachment.size
          }))
        }
      },
      include: messageInclude
    });

    if (emojiNames.length > 0) {
      const counts = countByName(emojiNames);
      await this.prisma.$transaction(
        [...counts.entries()].map(([name, count]) =>
          this.prisma.customEmoji.updateMany({
            where: { name },
            data: { useCount: { increment: count } }
          })
        )
      );
    }

    return mapMessage(message);
  }

  public async updateMessage(
    messageId: string,
    input: { actorId: string } & UpdateMessageRequest
  ): Promise<MessageView> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        deletedAt: null,
        channel: { server: { memberships: { some: { userId: input.actorId } } } }
      },
      include: messageInclude
    });

    if (!message) {
      throw new HttpError(404, "Message not found");
    }

    if (message.author.id !== input.actorId) {
      throw new HttpError(403, "You can only edit your own messages");
    }

    const nextContent = input.content.trim();

    if (!nextContent) {
      throw new HttpError(400, "Message cannot be empty");
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { content: nextContent, editedAt: new Date() },
      include: messageInclude
    });

    await this.createAuditLog({
      action: "MESSAGE_EDIT",
      actorId: input.actorId,
      targetUserId: message.author.id,
      messageId,
      channelId: message.channelId,
      metadata: {
        before: {
          content: message.content,
          editedAt: message.editedAt?.toISOString() ?? null
        },
        after: {
          content: updated.content,
          editedAt: updated.editedAt?.toISOString() ?? null
        }
      }
    });

    return mapMessage(updated);
  }

  public async deleteMessage(
    messageId: string,
    input: { actorId: string }
  ): Promise<{ id: string; channelId: string }> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        deletedAt: null,
        channel: { server: { memberships: { some: { userId: input.actorId } } } }
      },
      include: messageInclude
    });

    if (!message) {
      throw new HttpError(404, "Message not found");
    }

    if (message.author.id !== input.actorId) {
      await this.assertSuperAdmin(input.actorId);
    }

    const deletedAt = new Date();
    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt, deletedById: input.actorId }
    });

    await this.createAuditLog({
      action: "MESSAGE_DELETE",
      actorId: input.actorId,
      targetUserId: message.author.id,
      messageId,
      channelId: message.channelId,
      metadata: {
        deletedAt: deletedAt.toISOString(),
        message: messageAuditSnapshot(message)
      }
    });

    return { id: message.id, channelId: message.channelId };
  }

  public async toggleMessageReaction(
    messageId: string,
    input: { userId: string } & ToggleMessageReactionRequest
  ): Promise<MessageView> {
    const emoji = input.emoji.trim();

    if (!emoji) {
      throw new HttpError(400, "Reaction emoji is required");
    }

    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        deletedAt: null,
        channel: {
          server: {
            memberships: { some: { userId: input.userId } }
          }
        }
      },
      select: { id: true }
    });

    if (!message) {
      throw new HttpError(404, "Message not found");
    }

    const existing = await this.prisma.messageReaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId: input.userId,
          emoji
        }
      }
    });

    if (existing) {
      await this.prisma.messageReaction.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.messageReaction.create({
        data: {
          messageId,
          userId: input.userId,
          emoji
        }
      });
      const customEmojiName = extractSingleCustomEmojiName(emoji);

      if (customEmojiName) {
        await this.prisma.customEmoji.updateMany({
          where: { name: customEmojiName },
          data: { useCount: { increment: 1 } }
        });
      }
    }

    const updated = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: messageInclude
    });

    if (!updated) {
      throw new HttpError(404, "Message not found");
    }

    return mapMessage(updated);
  }

  public async listCalendarEvents(viewerId: string): Promise<CalendarEventView[]> {
    const events = await this.prisma.calendarEvent.findMany({
      where: { deletedAt: null },
      include: calendarEventInclude,
      orderBy: [{ startAt: "asc" }, { createdAt: "asc" }]
    });

    return events.map((event) => mapCalendarEvent(event, viewerId));
  }

  public async createCalendarEvent(
    input: { creatorId: string } & CreateCalendarEventRequest
  ): Promise<CalendarEventView> {
    const event = await this.prisma.calendarEvent.create({
      data: {
        creatorId: input.creatorId,
        title: input.title,
        description: input.description ?? "",
        startAt: new Date(input.startAt),
        optIns: { create: { userId: input.creatorId } }
      },
      include: calendarEventInclude
    });

    return mapCalendarEvent(event, input.creatorId);
  }

  public async deleteCalendarEvent(
    eventId: string,
    input: { actorId: string }
  ): Promise<{ id: string }> {
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      include: calendarEventInclude
    });

    if (!event || event.deletedAt) {
      throw new HttpError(404, "Calendar event not found");
    }

    if (event.creator.id !== input.actorId) {
      await this.assertAdmin(input.actorId);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          action: "CALENDAR_EVENT_DELETE",
          actorId: input.actorId,
          targetUserId: event.creator.id,
          calendarEventId: event.id,
          metadata: {
            event: calendarEventAuditSnapshot(event)
          }
        }
      });
      await tx.calendarEvent.delete({ where: { id: event.id } });
    });

    return { id: event.id };
  }

  public async setCalendarEventOptIn(
    userId: string,
    eventId: string,
    input: SetCalendarEventOptInRequest
  ): Promise<CalendarEventView> {
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: { id: true }
    });

    if (!event) {
      throw new HttpError(404, "Calendar event not found");
    }

    if (input.optedIn) {
      await this.prisma.calendarEventOptIn.upsert({
        where: { eventId_userId: { eventId, userId } },
        update: {},
        create: { eventId, userId }
      });
    } else {
      await this.prisma.calendarEventOptIn.deleteMany({
        where: { eventId, userId }
      });
    }

    const updated = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      include: calendarEventInclude
    });

    if (!updated) {
      throw new HttpError(404, "Calendar event not found");
    }

    return mapCalendarEvent(updated, userId);
  }

  public async listAuditLogs(actorId: string): Promise<AuditLogView[]> {
    await this.assertSuperAdmin(actorId);

    const logs = await this.prisma.auditLog.findMany({
      include: auditLogInclude,
      orderBy: { createdAt: "desc" },
      take: 200
    });

    return logs.map(mapAuditLog);
  }

  public async restoreAuditLogEntry(
    logId: string,
    input: { actorId: string }
  ): Promise<RestoreAuditLogResponse> {
    await this.assertSuperAdmin(input.actorId);

    const log = await this.prisma.auditLog.findUnique({
      where: { id: logId },
      include: auditLogInclude
    });

    if (!log) {
      throw new HttpError(404, "Audit log entry not found");
    }

    if (log.restoredAt) {
      throw new HttpError(400, "This audit entry has already been restored");
    }

    if (log.action === "MESSAGE_DELETE" && log.messageId) {
      const message = await this.prisma.message.update({
        where: { id: log.messageId },
        data: { deletedAt: null, deletedById: null },
        include: messageInclude
      });

      const updatedLog = await this.markAuditLogRestored(log.id, input.actorId);
      await this.createAuditLog({
        action: "MESSAGE_RESTORE",
        actorId: input.actorId,
        targetUserId: message.author.id,
        messageId: message.id,
        channelId: message.channelId,
        metadata: { restoredFromAuditLogId: log.id }
      });

      return { auditLog: updatedLog, message: mapMessage(message), event: null };
    }

    if (log.action === "CALENDAR_EVENT_DELETE") {
      const snapshot = readCalendarEventSnapshot(log.metadata);

      if (!snapshot) {
        throw new HttpError(400, "This audit entry cannot be restored");
      }

      const event = await this.prisma.calendarEvent.create({
        data: {
          id: snapshot.id,
          creatorId: snapshot.creatorId,
          title: snapshot.title,
          description: snapshot.description,
          startAt: new Date(snapshot.startAt),
          createdAt: new Date(snapshot.createdAt),
          optIns: {
            create: snapshot.optIns.map((optIn) => ({
              userId: optIn.userId,
              createdAt: new Date(optIn.createdAt)
            }))
          }
        },
        include: calendarEventInclude
      });

      const updatedLog = await this.markAuditLogRestored(log.id, input.actorId);
      await this.createAuditLog({
        action: "CALENDAR_EVENT_RESTORE",
        actorId: input.actorId,
        targetUserId: event.creator.id,
        calendarEventId: event.id,
        metadata: { restoredFromAuditLogId: log.id }
      });

      return { auditLog: updatedLog, message: null, event: mapCalendarEvent(event, input.actorId) };
    }

    throw new HttpError(400, "This audit entry cannot be restored");
  }

  public async listCustomEmojis(): Promise<CustomEmojiView[]> {
    const emojis = await this.prisma.customEmoji.findMany({
      include: customEmojiInclude,
      orderBy: [{ name: "asc" }]
    });

    return emojis.map(mapCustomEmoji);
  }

  public async createCustomEmoji(
    input: { actorId: string } & CreateCustomEmojiRequest
  ): Promise<CustomEmojiView> {
    await this.assertAdmin(input.actorId);
    const name = normalizeCustomEmojiName(input.name);

    if (!name) {
      throw new HttpError(400, "Emoji name is required");
    }

    const existing = await this.prisma.customEmoji.findUnique({
      where: { name },
      select: { id: true }
    });

    if (existing) {
      throw new HttpError(409, "An emoji with that name already exists");
    }

    const emoji = await this.prisma.customEmoji.create({
      data: {
        name,
        imageUrl: input.imageUrl,
        createdById: input.actorId
      },
      include: customEmojiInclude
    });

    return mapCustomEmoji(emoji);
  }

  public async updateCustomEmoji(
    emojiId: string,
    input: { actorId: string } & UpdateCustomEmojiRequest
  ): Promise<CustomEmojiView> {
    await this.assertAdmin(input.actorId);

    const data: { name?: string; imageUrl?: string } = {};

    if (input.name) {
      const name = normalizeCustomEmojiName(input.name);

      if (!name) {
        throw new HttpError(400, "Emoji name is required");
      }

      const existing = await this.prisma.customEmoji.findUnique({
        where: { name },
        select: { id: true }
      });

      if (existing && existing.id !== emojiId) {
        throw new HttpError(409, "An emoji with that name already exists");
      }

      data.name = name;
    }

    if (input.imageUrl) {
      data.imageUrl = input.imageUrl;
    }

    const emoji = await this.prisma.customEmoji.update({
      where: { id: emojiId },
      data,
      include: customEmojiInclude
    });

    return mapCustomEmoji(emoji);
  }

  public async deleteCustomEmoji(emojiId: string, input: { actorId: string }): Promise<CustomEmojiView[]> {
    await this.assertAdmin(input.actorId);

    await this.prisma.customEmoji.delete({ where: { id: emojiId } });
    return this.listCustomEmojis();
  }

  private async createAuditLog(input: {
    action: AuditAction;
    actorId: string;
    targetUserId?: string | null;
    messageId?: string | null;
    channelId?: string | null;
    calendarEventId?: string | null;
    metadata: Prisma.InputJsonValue;
  }) {
    const entry = await this.prisma.auditLog.create({
      data: {
        action: input.action,
        actorId: input.actorId,
        targetUserId: input.targetUserId,
        messageId: input.messageId,
        channelId: input.channelId,
        calendarEventId: input.calendarEventId,
        metadata: input.metadata
      },
      include: auditLogInclude
    });

    return mapAuditLog(entry);
  }

  private async markAuditLogRestored(logId: string, actorId: string) {
    const updated = await this.prisma.auditLog.update({
      where: { id: logId },
      data: { restoredAt: new Date(), restoredById: actorId },
      include: auditLogInclude
    });

    return mapAuditLog(updated);
  }

  private async assertAdmin(userId: string) {
    const user = await this.getProfile(userId);

    if (!user || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) {
      throw new HttpError(403, "Admin permission required");
    }
  }

  private async assertSuperAdmin(userId: string) {
    const user = await this.getProfile(userId);

    if (!user || user.role !== "SUPER_ADMIN") {
      throw new HttpError(403, "Super admin permission required");
    }
  }
}

function mapUserProfile(user: UserWithProfile): UserProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.profile?.displayName ?? user.username,
    bio: user.profile?.bio ?? "",
    avatarUrl: user.profile?.avatarUrl ?? null,
    createdAt: user.createdAt.toISOString(),
    role: user.role,
    bannedAt: user.bannedAt?.toISOString() ?? null
  };
}

function mapAuthRecord(
  user: { id: string; username: string; passwordHash: string; bannedAt: Date | null } | null
): UserAuthRecord | null {
  return user
    ? {
        id: user.id,
        username: user.username,
        passwordHash: user.passwordHash,
        bannedAt: user.bannedAt?.toISOString() ?? null
      }
    : null;
}

function mapChannel(channel: { id: string; serverId: string; name: string }): ChannelSummary {
  return {
    id: channel.id,
    serverId: channel.serverId,
    name: channel.name
  };
}

function normalizeChannelName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function mapMessage(message: MessageWithRelations): MessageView {
  return {
    id: message.id,
    channelId: message.channelId,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    author: mapUserProfile(message.author),
    attachments: message.attachments.map(mapAttachment),
    replyTo: message.replyTo ? mapMessageReply(message.replyTo) : null,
    reactions: mapMessageReactions(message.reactions)
  };
}

function mapMessageReply(message: MessageReplyWithRelations): MessageReplyView {
  return {
    id: message.id,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    author: mapUserProfile(message.author),
    attachments: message.attachments.map(mapAttachment)
  };
}

function mapAttachment(attachment: AttachmentView): AttachmentView {
  return {
    id: attachment.id,
    url: attachment.url,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size
  };
}

function mapMessageReactions(reactions: MessageReactionWithRelations[]): MessageReactionView[] {
  const grouped = new Map<string, MessageReactionView>();

  for (const reaction of reactions) {
    const user = mapUserProfile(reaction.user);
    const existing = grouped.get(reaction.emoji);

    if (existing) {
      existing.count += 1;
      existing.users.push(user);
    } else {
      grouped.set(reaction.emoji, {
        emoji: reaction.emoji,
        count: 1,
        users: [user]
      });
    }
  }

  return [...grouped.values()];
}

function mapCalendarEvent(
  event: CalendarEventWithRelations,
  viewerId: string
): CalendarEventView {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startAt: event.startAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
    deletedAt: event.deletedAt?.toISOString() ?? null,
    creator: mapUserProfile(event.creator),
    optIns: event.optIns.map((optIn) => ({
      user: mapUserProfile(optIn.user),
      createdAt: optIn.createdAt.toISOString()
    })),
    viewerOptedIn: event.optIns.some((optIn) => optIn.user.id === viewerId)
  };
}

function mapCustomEmoji(emoji: CustomEmojiWithRelations): CustomEmojiView {
  return {
    id: emoji.id,
    name: emoji.name,
    imageUrl: emoji.imageUrl,
    useCount: emoji.useCount,
    createdAt: emoji.createdAt.toISOString(),
    updatedAt: emoji.updatedAt.toISOString(),
    createdBy: mapUserProfile(emoji.createdBy)
  };
}

function mapAuditLog(entry: AuditLogWithRelations): AuditLogView {
  return {
    id: entry.id,
    action: entry.action,
    createdAt: entry.createdAt.toISOString(),
    actor: entry.actor ? mapUserProfile(entry.actor) : null,
    targetUser: entry.targetUser ? mapUserProfile(entry.targetUser) : null,
    messageId: entry.messageId,
    channelId: entry.channelId,
    calendarEventId: entry.calendarEventId,
    metadata: entry.metadata,
    restorable:
      !entry.restoredAt &&
      (entry.action === "MESSAGE_DELETE" || entry.action === "CALENDAR_EVENT_DELETE")
  };
}

function messageAuditSnapshot(message: MessageWithRelations): Prisma.InputJsonObject {
  return {
    id: message.id,
    channelId: message.channelId,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    author: mapUserProfile(message.author) as unknown as Prisma.InputJsonObject,
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      url: attachment.url,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size
    }))
  };
}

function calendarEventAuditSnapshot(event: CalendarEventWithRelations): Prisma.InputJsonObject {
  return {
    id: event.id,
    creatorId: event.creator.id,
    title: event.title,
    description: event.description,
    startAt: event.startAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
    optIns: event.optIns.map((optIn) => ({
      userId: optIn.user.id,
      createdAt: optIn.createdAt.toISOString()
    }))
  };
}

function readCalendarEventSnapshot(metadata: Prisma.JsonValue) {
  const root = metadata as {
    event?: {
      id?: unknown;
      creatorId?: unknown;
      title?: unknown;
      description?: unknown;
      startAt?: unknown;
      createdAt?: unknown;
      optIns?: Array<{ userId?: unknown; createdAt?: unknown }>;
    };
  };
  const event = root.event;

  if (
    !event ||
    typeof event.id !== "string" ||
    typeof event.creatorId !== "string" ||
    typeof event.title !== "string" ||
    typeof event.description !== "string" ||
    typeof event.startAt !== "string" ||
    typeof event.createdAt !== "string" ||
    !Array.isArray(event.optIns)
  ) {
    return null;
  }

  return {
    id: event.id,
    creatorId: event.creatorId,
    title: event.title,
    description: event.description,
    startAt: event.startAt,
    createdAt: event.createdAt,
    optIns: event.optIns
      .filter(
        (optIn): optIn is { userId: string; createdAt: string } =>
          typeof optIn.userId === "string" && typeof optIn.createdAt === "string"
      )
      .filter(
        (optIn, index, list) => list.findIndex((candidate) => candidate.userId === optIn.userId) === index
      )
  };
}

function normalizeCustomEmojiName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function extractCustomEmojiNames(content: string) {
  return [...content.matchAll(/:([a-z0-9_]{2,32}):/gi)]
    .map((match) => match[1]?.toLowerCase())
    .filter((name): name is string => Boolean(name));
}

function extractSingleCustomEmojiName(content: string) {
  const match = content.match(/^:([a-z0-9_]{2,32}):$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function countByName(names: string[]) {
  const counts = new Map<string, number>();

  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return counts;
}

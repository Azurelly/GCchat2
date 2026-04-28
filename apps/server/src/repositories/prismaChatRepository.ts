import { PrismaClient } from "@prisma/client";
import {
  GLOBAL_CHANNEL_NAME,
  GLOBAL_SERVER_NAME,
  type AttachmentView,
  type BootstrapPayload,
  type CalendarEventView,
  type ChannelSummary,
  type CreateChannelRequest,
  type CreateCalendarEventRequest,
  type CreateMessageRequest,
  type DeleteChannelRequest,
  type MessageView,
  type SetCalendarEventOptInRequest,
  type ServerMemberView,
  type ServerSummary,
  type UpdateAccountRequest,
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
  author: UserWithProfile;
  attachments: AttachmentView[];
};

type CalendarEventWithRelations = {
  id: string;
  title: string;
  description: string;
  startAt: Date;
  createdAt: Date;
  creator: UserWithProfile;
  optIns: Array<{
    createdAt: Date;
    user: UserWithProfile;
  }>;
};

const GLOBAL_SERVER_KEY = "global";

const calendarEventInclude = {
  creator: { include: { profile: true } },
  optIns: {
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
      where: { channelId },
      include: {
        author: { include: { profile: true } },
        attachments: { orderBy: { createdAt: "asc" } }
      },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    return messages.reverse().map(mapMessage);
  }

  public async createMessage(
    input: { channelId: string; authorId: string } & CreateMessageRequest
  ) {
    const message = await this.prisma.message.create({
      data: {
        channelId: input.channelId,
        authorId: input.authorId,
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
      include: {
        author: { include: { profile: true } },
        attachments: { orderBy: { createdAt: "asc" } }
      }
    });

    return mapMessage(message);
  }

  public async listCalendarEvents(viewerId: string): Promise<CalendarEventView[]> {
    const events = await this.prisma.calendarEvent.findMany({
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
    author: mapUserProfile(message.author),
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      url: attachment.url,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size
    }))
  };
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
    creator: mapUserProfile(event.creator),
    optIns: event.optIns.map((optIn) => ({
      user: mapUserProfile(optIn.user),
      createdAt: optIn.createdAt.toISOString()
    })),
    viewerOptedIn: event.optIns.some((optIn) => optIn.user.id === viewerId)
  };
}

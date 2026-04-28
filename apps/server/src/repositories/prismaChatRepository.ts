import { PrismaClient } from "@prisma/client";
import {
  GLOBAL_CHANNEL_NAME,
  GLOBAL_SERVER_NAME,
  type AttachmentView,
  type BootstrapPayload,
  type ChannelSummary,
  type CreateMessageRequest,
  type MessageView,
  type ServerMemberView,
  type ServerSummary,
  type UpdateProfileRequest,
  type UserProfile
} from "@gcchat/shared";
import type { ChatRepository, GlobalCommunity, UserAuthRecord } from "./chatRepository";
import { HttpError } from "../errors";

type UserWithProfile = {
  id: string;
  username: string;
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

const GLOBAL_SERVER_KEY = "global";

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

    const user = await this.prisma.user.create({
      data: {
        username: input.username,
        passwordHash: input.passwordHash,
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
      select: { id: true, username: true, passwordHash: true }
    });

    return user;
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

  public async listServerMembers(serverId: string): Promise<ServerMemberView[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { serverId },
      include: { user: { include: { profile: true } } },
      orderBy: { joinedAt: "asc" }
    });

    return memberships.map((membership) => ({
      ...mapUserProfile(membership.user),
      joinedAt: membership.joinedAt.toISOString()
    }));
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
}

function mapUserProfile(user: UserWithProfile): UserProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.profile?.displayName ?? user.username,
    bio: user.profile?.bio ?? "",
    avatarUrl: user.profile?.avatarUrl ?? null,
    createdAt: user.createdAt.toISOString()
  };
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

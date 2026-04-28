import { randomUUID } from "node:crypto";
import {
  GLOBAL_CHANNEL_NAME,
  GLOBAL_SERVER_NAME,
  type BootstrapPayload,
  type ChannelSummary,
  type CreateMessageRequest,
  type MessageView,
  type ServerMemberView,
  type ServerSummary,
  type UpdateProfileRequest,
  type UserProfile
} from "@gcchat/shared";
import type {
  ChatRepository,
  GlobalCommunity,
  UserAuthRecord
} from "../src/repositories/chatRepository";

interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
}

interface StoredProfile {
  userId: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
}

interface StoredMembership {
  userId: string;
  serverId: string;
  joinedAt: Date;
}

interface StoredMessage {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  attachments: Array<{
    id: string;
    url: string;
    fileName: string;
    mimeType: string;
    size: number;
  }>;
}

export class InMemoryChatRepository implements ChatRepository {
  private readonly server: ServerSummary = {
    id: "server-global",
    name: GLOBAL_SERVER_NAME,
    iconUrl: null
  };

  private readonly channel: ChannelSummary = {
    id: "channel-general",
    serverId: this.server.id,
    name: GLOBAL_CHANNEL_NAME
  };

  private readonly users = new Map<string, StoredUser>();
  private readonly profiles = new Map<string, StoredProfile>();
  private readonly memberships: StoredMembership[] = [];
  private readonly messages: StoredMessage[] = [];

  public async ensureGlobalCommunity(): Promise<GlobalCommunity> {
    return { server: this.server, channel: this.channel };
  }

  public async createUser(input: { username: string; passwordHash: string }) {
    const user: StoredUser = {
      id: randomUUID(),
      username: input.username,
      passwordHash: input.passwordHash,
      createdAt: new Date()
    };

    this.users.set(user.id, user);
    this.profiles.set(user.id, {
      userId: user.id,
      displayName: user.username,
      bio: "",
      avatarUrl: null
    });
    this.ensureMembership(user.id);

    return this.mapUser(user);
  }

  public async findUserAuthByUsername(username: string): Promise<UserAuthRecord | null> {
    const user = [...this.users.values()].find((candidate) => candidate.username === username);
    return user ? { id: user.id, username: user.username, passwordHash: user.passwordHash } : null;
  }

  public async getBootstrap(userId: string): Promise<BootstrapPayload> {
    this.ensureMembership(userId);
    const user = await this.getProfile(userId);

    if (!user) {
      throw new Error("User not found");
    }

    return {
      user,
      server: this.server,
      channel: this.channel,
      members: await this.listServerMembers(this.server.id)
    };
  }

  public async getProfile(userId: string): Promise<UserProfile | null> {
    const user = this.users.get(userId);
    return user ? this.mapUser(user) : null;
  }

  public async updateProfile(userId: string, input: UpdateProfileRequest): Promise<UserProfile> {
    const user = this.users.get(userId);

    if (!user) {
      throw new Error("User not found");
    }

    const profile = this.profiles.get(userId) ?? {
      userId,
      displayName: user.username,
      bio: "",
      avatarUrl: null
    };

    this.profiles.set(userId, {
      ...profile,
      displayName: input.displayName ?? profile.displayName,
      bio: input.bio ?? profile.bio,
      avatarUrl: input.avatarUrl === undefined ? profile.avatarUrl : input.avatarUrl
    });

    return this.mapUser(user);
  }

  public async listServerMembers(serverId: string): Promise<ServerMemberView[]> {
    return this.memberships
      .filter((membership) => membership.serverId === serverId)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .map((membership) => {
        const user = this.users.get(membership.userId);

        if (!user) {
          throw new Error("Missing user");
        }

        return { ...this.mapUser(user), joinedAt: membership.joinedAt.toISOString() };
      });
  }

  public async userHasServerAccess(userId: string, serverId: string) {
    return this.memberships.some(
      (membership) => membership.userId === userId && membership.serverId === serverId
    );
  }

  public async userHasChannelAccess(userId: string, channelId: string) {
    return channelId === this.channel.id && (await this.userHasServerAccess(userId, this.server.id));
  }

  public async listMessages(channelId: string, limit: number): Promise<MessageView[]> {
    return this.messages
      .filter((message) => message.channelId === channelId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-limit)
      .map((message) => this.mapMessage(message));
  }

  public async createMessage(
    input: { channelId: string; authorId: string } & CreateMessageRequest
  ): Promise<MessageView> {
    const message: StoredMessage = {
      id: randomUUID(),
      channelId: input.channelId,
      authorId: input.authorId,
      content: input.content,
      createdAt: new Date(Date.now() + this.messages.length),
      editedAt: null,
      attachments:
        input.attachments?.map((attachment) => ({ id: randomUUID(), ...attachment })) ?? []
    };

    this.messages.push(message);
    return this.mapMessage(message);
  }

  private ensureMembership(userId: string) {
    if (!this.memberships.some((membership) => membership.userId === userId)) {
      this.memberships.push({ userId, serverId: this.server.id, joinedAt: new Date() });
    }
  }

  private mapUser(user: StoredUser): UserProfile {
    const profile = this.profiles.get(user.id);

    return {
      id: user.id,
      username: user.username,
      displayName: profile?.displayName ?? user.username,
      bio: profile?.bio ?? "",
      avatarUrl: profile?.avatarUrl ?? null,
      createdAt: user.createdAt.toISOString()
    };
  }

  private mapMessage(message: StoredMessage): MessageView {
    const user = this.users.get(message.authorId);

    if (!user) {
      throw new Error("Missing author");
    }

    return {
      id: message.id,
      channelId: message.channelId,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      author: this.mapUser(user),
      attachments: message.attachments
    };
  }
}

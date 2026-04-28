import { randomUUID } from "node:crypto";
import {
  GLOBAL_CHANNEL_NAME,
  GLOBAL_SERVER_NAME,
  type BootstrapPayload,
  type CalendarEventView,
  type ChannelSummary,
  type CustomEmojiView,
  type CreateChannelRequest,
  type CreateCalendarEventRequest,
  type CreateCustomEmojiRequest,
  type CreateMessageRequest,
  type DeleteChannelRequest,
  type MessageView,
  type SetCalendarEventOptInRequest,
  type ServerMemberView,
  type ServerSummary,
  type ToggleMessageReactionRequest,
  type UpdateAccountRequest,
  type UpdateCustomEmojiRequest,
  type UpdateUserBanRequest,
  type UpdateProfileRequest,
  type UpdateUserRoleRequest,
  type UserRole,
  type UserProfile
} from "@gcchat/shared";
import type {
  ChatRepository,
  GlobalCommunity,
  UserAuthRecord
} from "../src/repositories/chatRepository";
import { HttpError } from "../src/errors";

interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  bannedAt: Date | null;
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
  replyToId: string | null;
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

interface StoredMessageReaction {
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: Date;
}

interface StoredCalendarEvent {
  id: string;
  creatorId: string;
  title: string;
  description: string;
  startAt: Date;
  createdAt: Date;
  optInUserIds: Set<string>;
}

interface StoredCustomEmoji {
  id: string;
  name: string;
  imageUrl: string;
  createdById: string;
  useCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export class InMemoryChatRepository implements ChatRepository {
  private readonly server: ServerSummary = {
    id: "server-global",
    name: GLOBAL_SERVER_NAME,
    iconUrl: null
  };

  private readonly channels: ChannelSummary[] = [{
    id: "channel-general",
    serverId: this.server.id,
    name: GLOBAL_CHANNEL_NAME
  }];

  private readonly users = new Map<string, StoredUser>();
  private readonly profiles = new Map<string, StoredProfile>();
  private readonly memberships: StoredMembership[] = [];
  private readonly messages: StoredMessage[] = [];
  private readonly messageReactions: StoredMessageReaction[] = [];
  private readonly calendarEvents: StoredCalendarEvent[] = [];
  private readonly customEmojis: StoredCustomEmoji[] = [];

  public async ensureGlobalCommunity(): Promise<GlobalCommunity> {
    return { server: this.server, channel: this.channels[0] };
  }

  public async createUser(input: { username: string; passwordHash: string }) {
    const user: StoredUser = {
      id: randomUUID(),
      username: input.username,
      passwordHash: input.passwordHash,
      role: this.users.size === 0 ? "SUPER_ADMIN" : "USER",
      bannedAt: null,
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
    return this.mapAuthRecord(user ?? null);
  }

  public async findUserAuthById(userId: string): Promise<UserAuthRecord | null> {
    return this.mapAuthRecord(this.users.get(userId) ?? null);
  }

  private mapAuthRecord(user: StoredUser | null): UserAuthRecord | null {
    return user
      ? {
          id: user.id,
          username: user.username,
          passwordHash: user.passwordHash,
          bannedAt: user.bannedAt?.toISOString() ?? null
        }
      : null;
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
      channel: this.channels[0],
      channels: await this.listChannels(this.server.id),
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

  public async updateAccount(
    userId: string,
    input: Omit<UpdateAccountRequest, "currentPassword"> & { passwordHash?: string }
  ): Promise<UserProfile> {
    const user = this.users.get(userId);

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    if (input.username) {
      user.username = input.username;
    }

    if (input.passwordHash) {
      user.passwordHash = input.passwordHash;
    }

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

        return {
          ...this.mapUser(user),
          joinedAt: membership.joinedAt.toISOString(),
          isOnline: false
        };
      });
  }

  public async listChannels(serverId: string): Promise<ChannelSummary[]> {
    return this.channels.filter((channel) => channel.serverId === serverId);
  }

  public async createChannel(
    input: { serverId: string; actorId: string } & CreateChannelRequest
  ): Promise<ChannelSummary> {
    await this.assertAdmin(input.actorId);
    const name = normalizeChannelName(input.name);

    if (!name) {
      throw new HttpError(400, "Channel name is required");
    }

    if (this.channels.some((channel) => channel.serverId === input.serverId && channel.name === name)) {
      throw new HttpError(409, "A channel with that name already exists");
    }

    const channel = {
      id: randomUUID(),
      serverId: input.serverId,
      name
    };

    this.channels.push(channel);
    return channel;
  }

  public async deleteChannel(
    channelId: string,
    input: { actorId: string } & DeleteChannelRequest
  ): Promise<ChannelSummary[]> {
    await this.assertSuperAdmin(input.actorId);
    const channel = this.channels.find((candidate) => candidate.id === channelId);

    if (!channel) {
      throw new HttpError(404, "Channel not found");
    }

    if (input.confirmationName !== channel.name) {
      throw new HttpError(400, "Type the channel name exactly to delete it");
    }

    const serverChannels = this.channels.filter((candidate) => candidate.serverId === channel.serverId);

    if (serverChannels.length <= 1) {
      throw new HttpError(400, "You cannot delete the last text channel");
    }

    this.channels.splice(this.channels.indexOf(channel), 1);
    return this.listChannels(channel.serverId);
  }

  public async setUserRole(
    targetUserId: string,
    input: { actorId: string } & UpdateUserRoleRequest
  ): Promise<UserProfile> {
    await this.assertSuperAdmin(input.actorId);

    const target = this.users.get(targetUserId);

    if (!target) {
      throw new HttpError(404, "User not found");
    }

    if (targetUserId === input.actorId) {
      throw new HttpError(400, "You cannot change your own role");
    }

    if (target.role === "SUPER_ADMIN") {
      throw new HttpError(400, "Super admins cannot be changed here");
    }

    target.role = input.role;
    return this.mapUser(target);
  }

  public async setUserBan(
    targetUserId: string,
    input: { actorId: string } & UpdateUserBanRequest
  ): Promise<UserProfile> {
    await this.assertSuperAdmin(input.actorId);

    const target = this.users.get(targetUserId);

    if (!target) {
      throw new HttpError(404, "User not found");
    }

    if (targetUserId === input.actorId) {
      throw new HttpError(400, "You cannot ban yourself");
    }

    if (target.role === "SUPER_ADMIN") {
      throw new HttpError(400, "Super admins cannot be banned");
    }

    target.bannedAt = input.banned ? new Date() : null;
    return this.mapUser(target);
  }

  public async userHasServerAccess(userId: string, serverId: string) {
    return this.memberships.some(
      (membership) => membership.userId === userId && membership.serverId === serverId
    );
  }

  public async userHasChannelAccess(userId: string, channelId: string) {
    const channel = this.channels.find((candidate) => candidate.id === channelId);
    return Boolean(channel) && (await this.userHasServerAccess(userId, this.server.id));
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
    const replyToId = input.replyToId ?? null;

    if (replyToId) {
      const replyTo = this.messages.find((candidate) => candidate.id === replyToId);

      if (!replyTo || replyTo.channelId !== input.channelId) {
        throw new HttpError(400, "Reply target must be in this channel");
      }
    }

    const message: StoredMessage = {
      id: randomUUID(),
      channelId: input.channelId,
      authorId: input.authorId,
      replyToId,
      content: input.content,
      createdAt: new Date(Date.now() + this.messages.length),
      editedAt: null,
      attachments:
        input.attachments?.map((attachment) => ({ id: randomUUID(), ...attachment })) ?? []
    };

    this.messages.push(message);
    const counts = countByName(extractCustomEmojiNames(message.content));

    for (const emoji of this.customEmojis) {
      emoji.useCount += counts.get(emoji.name) ?? 0;
    }

    return this.mapMessage(message);
  }

  public async toggleMessageReaction(
    messageId: string,
    input: { userId: string } & ToggleMessageReactionRequest
  ): Promise<MessageView> {
    const message = this.messages.find((candidate) => candidate.id === messageId);

    if (!message || !(await this.userHasChannelAccess(input.userId, message.channelId))) {
      throw new HttpError(404, "Message not found");
    }

    const emoji = input.emoji.trim();
    const existingIndex = this.messageReactions.findIndex(
      (reaction) =>
        reaction.messageId === messageId &&
        reaction.userId === input.userId &&
        reaction.emoji === emoji
    );

    if (existingIndex >= 0) {
      this.messageReactions.splice(existingIndex, 1);
    } else {
      this.messageReactions.push({
        messageId,
        userId: input.userId,
        emoji,
        createdAt: new Date(Date.now() + this.messageReactions.length)
      });
      const customEmojiName = extractSingleCustomEmojiName(emoji);

      if (customEmojiName) {
        const customEmoji = this.customEmojis.find((candidate) => candidate.name === customEmojiName);

        if (customEmoji) {
          customEmoji.useCount += 1;
        }
      }
    }

    return this.mapMessage(message);
  }

  public async listCalendarEvents(viewerId: string): Promise<CalendarEventView[]> {
    return this.calendarEvents
      .slice()
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .map((event) => this.mapCalendarEvent(event, viewerId));
  }

  public async createCalendarEvent(
    input: { creatorId: string } & CreateCalendarEventRequest
  ): Promise<CalendarEventView> {
    const event: StoredCalendarEvent = {
      id: randomUUID(),
      creatorId: input.creatorId,
      title: input.title,
      description: input.description ?? "",
      startAt: new Date(input.startAt),
      createdAt: new Date(Date.now() + this.calendarEvents.length),
      optInUserIds: new Set([input.creatorId])
    };

    this.calendarEvents.push(event);
    return this.mapCalendarEvent(event, input.creatorId);
  }

  public async setCalendarEventOptIn(
    userId: string,
    eventId: string,
    input: SetCalendarEventOptInRequest
  ): Promise<CalendarEventView> {
    const event = this.calendarEvents.find((candidate) => candidate.id === eventId);

    if (!event) {
      throw new Error("Calendar event not found");
    }

    if (input.optedIn) {
      event.optInUserIds.add(userId);
    } else {
      event.optInUserIds.delete(userId);
    }

    return this.mapCalendarEvent(event, userId);
  }

  public async listCustomEmojis(): Promise<CustomEmojiView[]> {
    return this.customEmojis
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((emoji) => this.mapCustomEmoji(emoji));
  }

  public async createCustomEmoji(
    input: { actorId: string } & CreateCustomEmojiRequest
  ): Promise<CustomEmojiView> {
    await this.assertAdmin(input.actorId);
    const name = normalizeCustomEmojiName(input.name);

    if (!name) {
      throw new HttpError(400, "Emoji name is required");
    }

    if (this.customEmojis.some((emoji) => emoji.name === name)) {
      throw new HttpError(409, "An emoji with that name already exists");
    }

    const emoji: StoredCustomEmoji = {
      id: randomUUID(),
      name,
      imageUrl: input.imageUrl,
      createdById: input.actorId,
      useCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.customEmojis.push(emoji);
    return this.mapCustomEmoji(emoji);
  }

  public async updateCustomEmoji(
    emojiId: string,
    input: { actorId: string } & UpdateCustomEmojiRequest
  ): Promise<CustomEmojiView> {
    await this.assertAdmin(input.actorId);
    const emoji = this.customEmojis.find((candidate) => candidate.id === emojiId);

    if (!emoji) {
      throw new HttpError(404, "Emoji not found");
    }

    if (input.name) {
      const name = normalizeCustomEmojiName(input.name);

      if (!name) {
        throw new HttpError(400, "Emoji name is required");
      }

      if (this.customEmojis.some((candidate) => candidate.name === name && candidate.id !== emojiId)) {
        throw new HttpError(409, "An emoji with that name already exists");
      }

      emoji.name = name;
    }

    if (input.imageUrl) {
      emoji.imageUrl = input.imageUrl;
    }

    emoji.updatedAt = new Date();
    return this.mapCustomEmoji(emoji);
  }

  public async deleteCustomEmoji(emojiId: string, input: { actorId: string }): Promise<CustomEmojiView[]> {
    await this.assertAdmin(input.actorId);
    const index = this.customEmojis.findIndex((candidate) => candidate.id === emojiId);

    if (index < 0) {
      throw new HttpError(404, "Emoji not found");
    }

    this.customEmojis.splice(index, 1);
    return this.listCustomEmojis();
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
      createdAt: user.createdAt.toISOString(),
      role: user.role,
      bannedAt: user.bannedAt?.toISOString() ?? null
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
      attachments: message.attachments,
      replyTo: message.replyToId ? this.mapMessageReply(message.replyToId) : null,
      reactions: this.mapMessageReactions(message.id)
    };
  }

  private mapMessageReply(messageId: string) {
    const message = this.messages.find((candidate) => candidate.id === messageId);

    if (!message) {
      return null;
    }

    const user = this.users.get(message.authorId);

    if (!user) {
      throw new Error("Missing author");
    }

    return {
      id: message.id,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      author: this.mapUser(user),
      attachments: message.attachments
    };
  }

  private mapMessageReactions(messageId: string) {
    const grouped = new Map<string, { emoji: string; count: number; users: UserProfile[] }>();

    for (const reaction of this.messageReactions.filter((candidate) => candidate.messageId === messageId)) {
      const user = this.users.get(reaction.userId);

      if (!user) {
        continue;
      }

      const existing = grouped.get(reaction.emoji);

      if (existing) {
        existing.count += 1;
        existing.users.push(this.mapUser(user));
      } else {
        grouped.set(reaction.emoji, {
          emoji: reaction.emoji,
          count: 1,
          users: [this.mapUser(user)]
        });
      }
    }

    return [...grouped.values()];
  }

  private mapCalendarEvent(event: StoredCalendarEvent, viewerId: string): CalendarEventView {
    const creator = this.users.get(event.creatorId);

    if (!creator) {
      throw new Error("Missing creator");
    }

    return {
      id: event.id,
      title: event.title,
      description: event.description,
      startAt: event.startAt.toISOString(),
      createdAt: event.createdAt.toISOString(),
      creator: this.mapUser(creator),
      optIns: [...event.optInUserIds].map((userId) => {
        const user = this.users.get(userId);

        if (!user) {
          throw new Error("Missing opt-in user");
        }

        return {
          user: this.mapUser(user),
          createdAt: event.createdAt.toISOString()
        };
      }),
      viewerOptedIn: event.optInUserIds.has(viewerId)
    };
  }

  private mapCustomEmoji(emoji: StoredCustomEmoji): CustomEmojiView {
    const creator = this.users.get(emoji.createdById);

    if (!creator) {
      throw new Error("Missing emoji creator");
    }

    return {
      id: emoji.id,
      name: emoji.name,
      imageUrl: emoji.imageUrl,
      useCount: emoji.useCount,
      createdAt: emoji.createdAt.toISOString(),
      updatedAt: emoji.updatedAt.toISOString(),
      createdBy: this.mapUser(creator)
    };
  }

  private async assertAdmin(userId: string) {
    const user = this.users.get(userId);

    if (!user || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) {
      throw new HttpError(403, "Admin permission required");
    }
  }

  private async assertSuperAdmin(userId: string) {
    const user = this.users.get(userId);

    if (!user || user.role !== "SUPER_ADMIN") {
      throw new HttpError(403, "Super admin permission required");
    }
  }
}

function normalizeChannelName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
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

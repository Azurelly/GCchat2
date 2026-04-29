import type {
  BootstrapPayload,
  AuditLogView,
  CalendarEventView,
  ChannelSummary,
  CustomEmojiView,
  CreateChannelRequest,
  CreateCalendarEventRequest,
  CreateCustomEmojiRequest,
  CreateMessageRequest,
  DeleteChannelRequest,
  MessagePageView,
  MessageView,
  RestoreAuditLogResponse,
  SetCalendarEventOptInRequest,
  ServerMemberView,
  ServerSummary,
  UpdateAccountRequest,
  UpdateCustomEmojiRequest,
  UpdateUserBanRequest,
  UpdateProfileRequest,
  UpdateUserRoleRequest,
  ToggleMessageReactionRequest,
  UpdateMessageRequest,
  UserProfile
} from "@gcchat/shared";

export interface UserAuthRecord {
  id: string;
  username: string;
  passwordHash: string;
  bannedAt: string | null;
}

export interface GlobalCommunity {
  server: ServerSummary;
  channel: ChannelSummary;
}

export interface ChatRepository {
  ensureGlobalCommunity(): Promise<GlobalCommunity>;
  createUser(input: { username: string; passwordHash: string }): Promise<UserProfile>;
  findUserAuthByUsername(username: string): Promise<UserAuthRecord | null>;
  findUserAuthById(userId: string): Promise<UserAuthRecord | null>;
  getBootstrap(userId: string): Promise<BootstrapPayload>;
  getProfile(userId: string): Promise<UserProfile | null>;
  updateProfile(userId: string, input: UpdateProfileRequest): Promise<UserProfile>;
  updateAccount(
    userId: string,
    input: Omit<UpdateAccountRequest, "currentPassword"> & { passwordHash?: string }
  ): Promise<UserProfile>;
  listServerMembers(serverId: string): Promise<ServerMemberView[]>;
  listChannels(serverId: string): Promise<ChannelSummary[]>;
  createChannel(
    input: { serverId: string; actorId: string } & CreateChannelRequest
  ): Promise<ChannelSummary>;
  deleteChannel(
    channelId: string,
    input: { actorId: string } & DeleteChannelRequest
  ): Promise<ChannelSummary[]>;
  setUserRole(
    targetUserId: string,
    input: { actorId: string } & UpdateUserRoleRequest
  ): Promise<UserProfile>;
  setUserBan(
    targetUserId: string,
    input: { actorId: string } & UpdateUserBanRequest
  ): Promise<UserProfile>;
  userHasServerAccess(userId: string, serverId: string): Promise<boolean>;
  userHasChannelAccess(userId: string, channelId: string): Promise<boolean>;
  listMessages(
    channelId: string,
    input: { limit: number; beforeMessageId?: string | null }
  ): Promise<MessagePageView>;
  createMessage(
    input: { channelId: string; authorId: string } & CreateMessageRequest
  ): Promise<MessageView>;
  updateMessage(
    messageId: string,
    input: { actorId: string } & UpdateMessageRequest
  ): Promise<MessageView>;
  deleteMessage(messageId: string, input: { actorId: string }): Promise<{ id: string; channelId: string }>;
  toggleMessageReaction(
    messageId: string,
    input: { userId: string } & ToggleMessageReactionRequest
  ): Promise<MessageView>;
  listCalendarEvents(viewerId: string): Promise<CalendarEventView[]>;
  createCalendarEvent(
    input: { creatorId: string } & CreateCalendarEventRequest
  ): Promise<CalendarEventView>;
  deleteCalendarEvent(eventId: string, input: { actorId: string }): Promise<{ id: string }>;
  setCalendarEventOptIn(
    userId: string,
    eventId: string,
    input: SetCalendarEventOptInRequest
  ): Promise<CalendarEventView>;
  listAuditLogs(actorId: string): Promise<AuditLogView[]>;
  restoreAuditLogEntry(logId: string, input: { actorId: string }): Promise<RestoreAuditLogResponse>;
  listCustomEmojis(): Promise<CustomEmojiView[]>;
  createCustomEmoji(
    input: { actorId: string } & CreateCustomEmojiRequest
  ): Promise<CustomEmojiView>;
  updateCustomEmoji(
    emojiId: string,
    input: { actorId: string } & UpdateCustomEmojiRequest
  ): Promise<CustomEmojiView>;
  deleteCustomEmoji(emojiId: string, input: { actorId: string }): Promise<CustomEmojiView[]>;
}

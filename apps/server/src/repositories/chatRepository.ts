import type {
  BootstrapPayload,
  CalendarEventView,
  ChannelSummary,
  CreateChannelRequest,
  CreateCalendarEventRequest,
  CreateMessageRequest,
  DeleteChannelRequest,
  MessageView,
  SetCalendarEventOptInRequest,
  ServerMemberView,
  ServerSummary,
  UpdateAccountRequest,
  UpdateUserBanRequest,
  UpdateProfileRequest,
  UpdateUserRoleRequest,
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
  listMessages(channelId: string, limit: number): Promise<MessageView[]>;
  createMessage(
    input: { channelId: string; authorId: string } & CreateMessageRequest
  ): Promise<MessageView>;
  listCalendarEvents(viewerId: string): Promise<CalendarEventView[]>;
  createCalendarEvent(
    input: { creatorId: string } & CreateCalendarEventRequest
  ): Promise<CalendarEventView>;
  setCalendarEventOptIn(
    userId: string,
    eventId: string,
    input: SetCalendarEventOptInRequest
  ): Promise<CalendarEventView>;
}

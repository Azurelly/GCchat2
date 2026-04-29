import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  AtSign,
  Ban,
  Bell,
  CalendarDays,
  Camera,
  CameraOff,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  FileAudio,
  FileUp,
  Hash,
  ImageUp,
  KeyRound,
  Link,
  Loader2,
  LogOut,
  MessageCircle,
  MonitorUp,
  MonitorX,
  Mic,
  MicOff,
  Minus,
  PhoneCall,
  PhoneOff,
  Plus,
  Palette,
  Paperclip,
  Pencil,
  Pause,
  Play,
  RefreshCw,
  Reply,
  RotateCcw,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Smile,
  SmilePlus,
  Sparkles,
  Trash2,
  Upload,
  User,
  Volume2,
  VolumeX,
  Users,
  X
} from "lucide-react";
import {
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication
} from "livekit-client";
import { io, type Socket } from "socket.io-client";
import type {
  AuthResponse,
  AuditLogView,
  BootstrapPayload,
  CalendarEventView,
  ChannelSummary,
  CustomEmojiView,
  CreateMessageRequest,
  MessageView,
  ServerMemberView,
  ServerToClientEvents,
  ClientToServerEvents,
  UserRole,
  UserProfile,
  VoiceModerationRequest,
  VoiceParticipantState,
  VoiceSelfStateRequest,
  VoiceStateView,
  YouTubeEmbedView
} from "@gcchat/shared";
import { API_URL, ApiClient } from "./api";

const tokenStorageKey = "gcchat.token";
const notificationStorageKey = "gcchat.notification-preferences";
const appearanceStorageKey = "gcchat.appearance-preferences";
const voiceVolumeStorageKey = "gcchat.voice-volumes";
const localVoiceMuteStorageKey = "gcchat.local-voice-mutes";
const eventTokenPattern = /\[\[gc-event:([^\]]+)]]/g;
const youtubeUrlPattern =
  /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?[^\s<)]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[^\s<)]*/gi;
const maxMessageAttachments = 4;

const defaultEmojis = [
  { name: "grinning", emoji: "😀" },
  { name: "joy", emoji: "😂" },
  { name: "sob", emoji: "😭" },
  { name: "skull", emoji: "💀" },
  { name: "fire", emoji: "🔥" },
  { name: "heart", emoji: "❤️" },
  { name: "thumbs_up", emoji: "👍" },
  { name: "eyes", emoji: "👀" },
  { name: "pray", emoji: "🙏" },
  { name: "party", emoji: "🎉" },
  { name: "cool", emoji: "😎" },
  { name: "thinking", emoji: "🤔" },
  { name: "flushed", emoji: "😳" },
  { name: "triumph", emoji: "😤" },
  { name: "celebrate", emoji: "🥳" },
  { name: "salute", emoji: "🫡" },
  { name: "handshake", emoji: "🤝" },
  { name: "check", emoji: "✅" },
  { name: "x", emoji: "❌" },
  { name: "hundred", emoji: "💯" },
  { name: "pizza", emoji: "🍕" },
  { name: "burger", emoji: "🍔" },
  { name: "car", emoji: "🚗" },
  { name: "controller", emoji: "🎮" },
  { name: "calendar", emoji: "📅" },
  { name: "star", emoji: "⭐" },
  { name: "smiling_devil", emoji: "😈" },
  { name: "suspicious", emoji: "🤨" },
  { name: "teary_smile", emoji: "🥲" },
  { name: "moai", emoji: "🗿" }
];

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type ActiveFeature = "chat" | "calendar" | "emojis" | "audit";
type ThemeName = "dark" | "light" | "midnight" | "forest" | "berry";
type NotificationSound = "ping" | "chime" | "alert" | "none";
type DefaultEmoji = (typeof defaultEmojis)[number];
type CalendarEventsStatus = "idle" | "loading" | "ready" | "error";
type VoiceStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";

interface NotificationPreferences {
  mentionToasts: boolean;
  mentionSound: boolean;
  desktopNotifications: boolean;
  sound: NotificationSound;
  volume: number;
}

interface AppearancePreferences {
  theme: ThemeName;
}

interface Session extends BootstrapPayload {
  token: string;
}

interface VoiceParticipantView {
  userId: string;
  name: string;
  isLocal: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isServerMuted: boolean;
  isServerDeafened: boolean;
  isSpeaking: boolean;
  isScreenSharing: boolean;
  isCameraOn: boolean;
  viewingStreamId: string | null;
  reconnecting: boolean;
  profile: UserProfile | null;
  volume: number;
  locallyMuted: boolean;
}

interface ScreenShareView {
  id: string;
  userId: string;
  name: string;
  kind: "screen" | "camera";
  isLocal: boolean;
  profile: UserProfile | null;
  track: LocalTrack | RemoteTrack | null;
  status: "starting" | "live" | "ended" | "unavailable";
}

interface MessageHistoryState {
  hasMore: boolean;
  loadingOlder: boolean;
}

interface VoiceDiagnosticEntry {
  id: number;
  at: string;
  event: string;
  details: string | null;
}

const api = new ApiClient();

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [activeFeature, setActiveFeature] = useState<ActiveFeature>("chat");
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [voiceViewOpen, setVoiceViewOpen] = useState(false);
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, MessageView[]>>({});
  const [messageHistoryState, setMessageHistoryState] = useState<Record<string, MessageHistoryState>>({});
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventView[]>([]);
  const [calendarEventsStatus, setCalendarEventsStatus] = useState<CalendarEventsStatus>("idle");
  const [customEmojis, setCustomEmojis] = useState<CustomEmojiView[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogView[]>([]);
  const [calendarFocusEventId, setCalendarFocusEventId] = useState<string | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<MessageView | null>(null);
  const [editingMessage, setEditingMessage] = useState<MessageView | null>(null);
  const [loading, setLoading] = useState(true);
  const [banned, setBanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteChannel, setDeleteChannel] = useState<ChannelSummary | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    phase: "idle",
    canRestart: false
  });
  const [notificationPrefs, setNotificationPrefs] = useState(loadNotificationPreferences);
  const [appearancePrefs, setAppearancePrefs] = useState(loadAppearancePreferences);
  const [toasts, setToasts] = useState<Array<{ id: string; message: MessageView }>>([]);
  const [socket, setSocket] = useState<ChatSocket | null>(null);
  const socketRef = useRef<ChatSocket | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("disconnected");
  const [voiceServerState, setVoiceServerState] = useState<VoiceStateView>({
    channelName: "General Voice",
    participants: []
  });
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipantView[]>([]);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceDeafened, setVoiceDeafened] = useState(false);
  const [voiceSharing, setVoiceSharing] = useState(false);
  const [voiceCameraOn, setVoiceCameraOn] = useState(false);
  const [screenShares, setScreenShares] = useState<ScreenShareView[]>([]);
  const [selectedStreamKey, setSelectedStreamKey] = useState<string | null>(null);
  const [screenSourcePicker, setScreenSourcePicker] = useState<ScreenSourcePreview[] | null>(null);
  const screenSourceResolverRef = useRef<((source: ScreenSourcePreview | null) => void) | null>(null);
  const [voiceDiagnosticsOpen, setVoiceDiagnosticsOpen] = useState(false);
  const [voiceDiagnostics, setVoiceDiagnostics] = useState<VoiceDiagnosticEntry[]>([]);
  const [voiceVolumes, setVoiceVolumes] = useState(loadVoiceVolumes);
  const [locallyMutedVoiceUsers, setLocallyMutedVoiceUsers] = useState(loadLocalVoiceMutes);
  const sessionRef = useRef<Session | null>(null);
  const voiceRoomRef = useRef<Room | null>(null);
  const voiceAudioElementsRef = useRef<Set<HTMLMediaElement>>(new Set());
  const voiceJoinedAtRef = useRef<string | null>(null);
  const screenShareStartingRef = useRef(false);
  const voiceServerStateRef = useRef<VoiceStateView>({
    channelName: "General Voice",
    participants: []
  });
  const voiceMutedRef = useRef(false);
  const voiceDeafenedRef = useRef(false);
  const voiceSharingRef = useRef(false);
  const voiceCameraOnRef = useRef(false);
  const cameraStartingRef = useRef(false);
  const voiceViewingStreamIdRef = useRef<string | null>(null);
  const voiceDiagnosticsRef = useRef<VoiceDiagnosticEntry[]>([]);
  const voiceDiagnosticCounterRef = useRef(0);
  const voiceParticipantsSignatureRef = useRef("");
  const staleVoiceRoomsRef = useRef<WeakSet<Room>>(new WeakSet());
  const voiceVolumesRef = useRef<Record<string, number>>({});
  const locallyMutedVoiceUsersRef = useRef<string[]>([]);
  const activeChannel = useMemo(() => {
    if (!session) {
      return null;
    }

    return (
      session.channels.find((channel) => channel.id === activeChannelId) ??
      session.channels[0] ??
      session.channel
    );
  }, [activeChannelId, session]);
  const messages = activeChannel ? messagesByChannel[activeChannel.id] ?? [] : [];
  const activeMessageHistory = activeChannel
    ? messageHistoryState[activeChannel.id] ?? { hasMore: false, loadingOlder: false }
    : { hasMore: false, loadingOlder: false };

  useEffect(() => {
    if (session && activeFeature === "emojis" && !hasAtLeastRole(session.user.role, "ADMIN")) {
      setActiveFeature("chat");
    }

    if (session && activeFeature === "audit" && session.user.role !== "SUPER_ADMIN") {
      setActiveFeature("chat");
    }
  }, [activeFeature, session]);

  useEffect(() => {
    if (!session || activeFeature !== "audit" || session.user.role !== "SUPER_ADMIN") {
      return;
    }

    api
      .getAuditLogs()
      .then(setAuditLogs)
      .catch((requestError) => setError(getMessage(requestError)));
  }, [activeFeature, session?.token, session?.user.role]);

  useEffect(() => {
    const token = localStorage.getItem(tokenStorageKey);

    if (!token) {
      setLoading(false);
      return;
    }

    api.setToken(token);
    api
      .me()
      .then((bootstrap) => {
        setSession({ ...bootstrap, token });
        setActiveChannelId(bootstrap.channel.id);
        setBanned(Boolean(bootstrap.user.bannedAt));
      })
      .catch((requestError) => {
        if (getMessage(requestError) === "You are banned") {
          setBanned(true);
        }

        localStorage.removeItem(tokenStorageKey);
        api.setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void window.gcchat.updates.getStatus().then(setUpdateStatus);
    const unsubscribe = window.gcchat.updates.onStatus(setUpdateStatus);

    return unsubscribe;
  }, []);

  useEffect(() => {
    localStorage.setItem(notificationStorageKey, JSON.stringify(notificationPrefs));
  }, [notificationPrefs]);

  useEffect(() => {
    localStorage.setItem(appearanceStorageKey, JSON.stringify(appearancePrefs));
  }, [appearancePrefs]);

  useEffect(() => {
    localStorage.setItem(voiceVolumeStorageKey, JSON.stringify(voiceVolumes));
  }, [voiceVolumes]);

  useEffect(() => {
    localStorage.setItem(localVoiceMuteStorageKey, JSON.stringify(locallyMutedVoiceUsers));
  }, [locallyMutedVoiceUsers]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    voiceMutedRef.current = voiceMuted;
  }, [voiceMuted]);

  useEffect(() => {
    voiceDeafenedRef.current = voiceDeafened;
  }, [voiceDeafened]);

  useEffect(() => {
    voiceSharingRef.current = voiceSharing;
  }, [voiceSharing]);

  useEffect(() => {
    voiceCameraOnRef.current = voiceCameraOn;
  }, [voiceCameraOn]);

  useEffect(() => {
    voiceServerStateRef.current = voiceServerState;
  }, [voiceServerState]);

  useEffect(() => {
    voiceVolumesRef.current = voiceVolumes;
  }, [voiceVolumes]);

  useEffect(() => {
    locallyMutedVoiceUsersRef.current = locallyMutedVoiceUsers;
  }, [locallyMutedVoiceUsers]);

  const appendVoiceDiagnostic = useCallback((event: string, details?: unknown) => {
    const entry: VoiceDiagnosticEntry = {
      id: voiceDiagnosticCounterRef.current + 1,
      at: new Date().toISOString(),
      event,
      details: details === undefined ? null : stringifyDiagnosticDetails(details)
    };

    voiceDiagnosticCounterRef.current = entry.id;
    voiceDiagnosticsRef.current = [...voiceDiagnosticsRef.current, entry].slice(-500);
    setVoiceDiagnostics(voiceDiagnosticsRef.current);
    console.info(`[voice] ${event}`, details ?? "");
  }, []);

  const clearVoiceDiagnostics = useCallback(() => {
    voiceDiagnosticsRef.current = [];
    setVoiceDiagnostics([]);
  }, []);

  const clearVoiceAudio = useCallback(() => {
    for (const element of voiceAudioElementsRef.current) {
      element.remove();
    }

    voiceAudioElementsRef.current.clear();
  }, []);

  const emitVoiceSelfState = useCallback((payload: VoiceSelfStateRequest) => {
    const currentSocket = socketRef.current;

    if (!currentSocket?.connected) {
      return Promise.resolve<VoiceStateView | null>(null);
    }

    return new Promise<VoiceStateView>((resolve, reject) => {
      currentSocket.emit("voice:self-state", payload, (response) => {
        if (response.ok) {
          resolve(response.state);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }, []);

  const emitVoiceJoin = useCallback(() => {
    const currentSocket = socketRef.current;

    if (!currentSocket?.connected) {
      return Promise.resolve<VoiceStateView | null>(null);
    }

    return new Promise<VoiceStateView>((resolve, reject) => {
      currentSocket.emit("voice:join", (response) => {
        if (response.ok) {
          resolve(response.state);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }, []);

  const announceVoicePresence = useCallback(async (reason = "presence") => {
    const room = voiceRoomRef.current;

    if (!room) {
      appendVoiceDiagnostic("presence:skipped", {
        reason,
        reasonDetails: "No LiveKit room is currently attached."
      });
      return null;
    }

    appendVoiceDiagnostic("presence:start", {
      reason,
      socketConnected: Boolean(socketRef.current?.connected),
      socketId: socketRef.current?.id ?? null,
      room: describeVoiceRoom(room),
      serverState: describeVoiceState(voiceServerStateRef.current, session?.user.id)
    });

    try {
      const joinedState = await emitVoiceJoin();

      if (!joinedState) {
        appendVoiceDiagnostic("presence:join-skipped", {
          reason,
          socketConnected: Boolean(socketRef.current?.connected)
        });
        return null;
      }

      appendVoiceDiagnostic("presence:join-ack", {
        reason,
        state: describeVoiceState(joinedState, session?.user.id)
      });

      const selfState = await emitVoiceSelfState({
        selfMuted: voiceMutedRef.current,
        selfDeafened: voiceDeafenedRef.current,
        screenSharing:
          voiceSharingRef.current ||
          screenShareStartingRef.current ||
          isParticipantScreenSharing(room.localParticipant),
        cameraOn:
          voiceCameraOnRef.current ||
          cameraStartingRef.current ||
          isParticipantCameraOn(room.localParticipant),
        viewingStreamId: voiceViewingStreamIdRef.current
      });

      appendVoiceDiagnostic("presence:self-state-ack", {
        reason,
        state: describeVoiceState(selfState, session?.user.id)
      });

      return selfState ?? joinedState;
    } catch (requestError) {
      appendVoiceDiagnostic("presence:error", {
        reason,
        error: getMessage(requestError),
        socketConnected: Boolean(socketRef.current?.connected),
        room: describeVoiceRoom(room)
      });
      throw requestError;
    }
  }, [appendVoiceDiagnostic, emitVoiceJoin, emitVoiceSelfState, session?.user.id]);

  const emitVoiceModeration = useCallback((payload: VoiceModerationRequest) => {
    const currentSocket = socketRef.current;

    if (!currentSocket?.connected) {
      return Promise.resolve<VoiceStateView | null>(null);
    }

    return new Promise<VoiceStateView>((resolve, reject) => {
      currentSocket.emit("voice:moderate", payload, (response) => {
        if (response.ok) {
          resolve(response.state);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }, []);

  const requestScreenSource = useCallback(async () => {
    const sources = await window.gcchat.screens.getSources();

    if (sources.length === 0) {
      return null;
    }

    if (sources.length === 1) {
      return sources[0] ?? null;
    }

    return new Promise<ScreenSourcePreview | null>((resolve) => {
      screenSourceResolverRef.current = resolve;
      setScreenSourcePicker(sources);
    });
  }, []);

  const resolveScreenSource = (source: ScreenSourcePreview | null) => {
    screenSourceResolverRef.current?.(source);
    screenSourceResolverRef.current = null;
    setScreenSourcePicker(null);
  };

  const applyVoiceAudioPreferences = useCallback(
    (room: Room | null) => {
      if (!room) {
        return;
      }

      for (const participant of room.remoteParticipants.values()) {
        const volume = getVoiceVolumeGain(
          participant.identity,
          voiceVolumesRef.current,
          locallyMutedVoiceUsersRef.current,
          voiceDeafenedRef.current
        );

        participant.setVolume(volume);
      }
    },
    []
  );

  const syncScreenShares = useCallback(
    (room: Room | null) => {
      if (!room || !session) {
        setScreenShares([]);
        voiceSharingRef.current = false;
        voiceCameraOnRef.current = false;
        setVoiceSharing(false);
        setVoiceCameraOn(false);
        return;
      }

      const nextShares: ScreenShareView[] = [];
      const addParticipantShare = (participant: Participant, isLocal: boolean) => {
        const profile =
          session.user.id === participant.identity
            ? session.user
            : session.members.find((member) => member.id === participant.identity) ?? null;
        const publications = Array.from(participant.videoTrackPublications.values()) as Array<{
          source: Track.Source;
          track?: LocalTrack | RemoteTrack | null;
          isMuted?: boolean;
        }>;

        for (const kind of ["screen", "camera"] as const) {
          const source = kind === "screen" ? Track.Source.ScreenShare : Track.Source.Camera;
          const publication = publications.find((candidate) => candidate.source === source);

          if (!publication) {
            continue;
          }

          const status = getParticipantVideoStatus(participant, source);

          nextShares.push({
            id: getVideoStreamId(participant.identity, kind),
            userId: participant.identity,
            name: profile?.displayName ?? participant.name ?? participant.identity,
            kind,
            isLocal,
            profile,
            track: publication.track ?? null,
            status: status ?? "starting"
          });
        }
      };

      addParticipantShare(room.localParticipant, true);
      for (const participant of room.remoteParticipants.values()) {
        addParticipantShare(participant, false);
      }

      setScreenShares(nextShares);
      const localSharing =
        screenShareStartingRef.current ||
        nextShares.some((share) => share.userId === session.user.id && share.kind === "screen" && share.status !== "ended");
      const localCameraOn =
        cameraStartingRef.current ||
        nextShares.some((share) => share.userId === session.user.id && share.kind === "camera" && share.status !== "ended");

      voiceSharingRef.current = localSharing;
      voiceCameraOnRef.current = localCameraOn;
      setVoiceSharing(localSharing);
      setVoiceCameraOn(localCameraOn);
    },
    [session]
  );

  const syncVoiceParticipants = useCallback(
    (room: Room | null) => {
      const currentSession = sessionRef.current;
      const currentServerState = voiceServerStateRef.current;

      if (!currentSession) {
        setVoiceParticipants([]);
        return;
      }

      const participantStates = [...currentServerState.participants];

      if (
        room &&
        !participantStates.some((participantState) => participantState.userId === currentSession.user.id)
      ) {
        const now = new Date().toISOString();

        participantStates.push({
          userId: currentSession.user.id,
          selfMuted: voiceMutedRef.current,
          selfDeafened: voiceDeafenedRef.current,
          serverMuted: false,
          serverDeafened: false,
          screenSharing: voiceSharingRef.current,
          cameraOn: voiceCameraOnRef.current,
          viewingStreamId: voiceViewingStreamIdRef.current,
          reconnecting: true,
          joinedAt: voiceJoinedAtRef.current ?? now,
          updatedAt: now
        });
      }

      participantStates.sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt));

      const nextParticipants = participantStates.map((participantState) => {
        const liveParticipant = room ? getLiveKitParticipant(room, participantState.userId) : null;
        const profile =
          currentSession.user.id === participantState.userId
            ? currentSession.user
            : currentSession.members.find((member) => member.id === participantState.userId) ?? null;
        const liveMuted = liveParticipant ? isParticipantAudioMuted(liveParticipant) : participantState.selfMuted;
        const liveScreenSharing = liveParticipant ? isParticipantScreenSharing(liveParticipant) : false;
        const liveCameraOn = liveParticipant ? isParticipantCameraOn(liveParticipant) : false;
        const locallyMuted = locallyMutedVoiceUsersRef.current.includes(participantState.userId);

        return {
          userId: participantState.userId,
          name: profile?.displayName ?? liveParticipant?.name ?? participantState.userId,
          isLocal: participantState.userId === currentSession.user.id,
          isMuted:
            participantState.serverMuted ||
            participantState.serverDeafened ||
            participantState.selfDeafened ||
            liveMuted,
          isDeafened: participantState.selfDeafened || participantState.serverDeafened,
          isServerMuted: participantState.serverMuted,
          isServerDeafened: participantState.serverDeafened,
          isSpeaking: liveParticipant?.isSpeaking ?? false,
          isScreenSharing: participantState.screenSharing || liveScreenSharing,
          isCameraOn: participantState.cameraOn || liveCameraOn,
          viewingStreamId: participantState.viewingStreamId ?? null,
          reconnecting: participantState.reconnecting,
          profile,
          volume: voiceVolumesRef.current[participantState.userId] ?? 100,
          locallyMuted
        };
      });

      setVoiceParticipants(nextParticipants);

      const signature = nextParticipants
        .map((participant) =>
          [
            participant.userId,
            participant.isMuted ? "m" : "u",
            participant.isDeafened ? "d" : "h",
            participant.isScreenSharing ? "s" : "n",
            participant.isCameraOn ? "cam" : "nocam",
            participant.viewingStreamId ?? "view:none",
            participant.reconnecting ? "r" : "c",
            participant.isSpeaking ? "talking" : "silent"
          ].join(":")
        )
        .join("|");

      if (signature !== voiceParticipantsSignatureRef.current) {
        voiceParticipantsSignatureRef.current = signature;
        appendVoiceDiagnostic("ui:voice-participants-synced", {
          count: nextParticipants.length,
          participantIds: nextParticipants.map((participant) => participant.userId),
          liveKitIds: room
            ? [room.localParticipant.identity, ...Array.from(room.remoteParticipants.keys())]
            : [],
          serverState: describeVoiceState(currentServerState, currentSession.user.id)
        });
      }
    },
    [appendVoiceDiagnostic]
  );

  const applySelfVoiceServerState = useCallback(
    (selfState: VoiceParticipantState, reason: string) => {
      const room = voiceRoomRef.current;
      const nextDeafened = selfState.selfDeafened || selfState.serverDeafened;
      const nextMuted =
        selfState.selfMuted || selfState.serverMuted || selfState.serverDeafened || nextDeafened;
      const mutedChanged = voiceMutedRef.current !== nextMuted;
      const deafenedChanged = voiceDeafenedRef.current !== nextDeafened;

      voiceDeafenedRef.current = nextDeafened;
      voiceMutedRef.current = nextMuted;
      setVoiceDeafened(nextDeafened);
      setVoiceMuted(nextMuted);
      applyVoiceAudioPreferences(room);

      if (room && mutedChanged) {
        void room.localParticipant.setMicrophoneEnabled(!nextMuted).catch((requestError) =>
          appendVoiceDiagnostic("voice:self-audio-sync-error", {
            reason,
            error: getMessage(requestError)
          })
        );
      }

      if (mutedChanged || deafenedChanged) {
        appendVoiceDiagnostic("voice:self-state-applied", {
          reason,
          nextMuted,
          nextDeafened,
          serverMuted: selfState.serverMuted,
          serverDeafened: selfState.serverDeafened
        });
      }
    },
    [appendVoiceDiagnostic, applyVoiceAudioPreferences]
  );

  const disconnectVoice = useCallback((notifyServer = true) => {
    const room = voiceRoomRef.current;

    appendVoiceDiagnostic("leave:start", {
      notifyServer,
      socketConnected: Boolean(socketRef.current?.connected),
      room: describeVoiceRoom(room),
      serverState: describeVoiceState(voiceServerStateRef.current, session?.user.id)
    });

    if (notifyServer) {
      socketRef.current?.emit("voice:leave");
    }

    if (room) {
      staleVoiceRoomsRef.current.add(room);
    }

    voiceRoomRef.current = null;
    voiceJoinedAtRef.current = null;
    void room?.localParticipant.setScreenShareEnabled(false).catch(() => undefined);
    void room?.localParticipant.setCameraEnabled(false).catch(() => undefined);
    room?.disconnect();
    screenShareStartingRef.current = false;
    cameraStartingRef.current = false;
    voiceMutedRef.current = false;
    voiceDeafenedRef.current = false;
    voiceSharingRef.current = false;
    voiceCameraOnRef.current = false;
    voiceViewingStreamIdRef.current = null;
    clearVoiceAudio();
    setVoiceStatus("disconnected");
    setVoiceMuted(false);
    setVoiceDeafened(false);
    setVoiceSharing(false);
    setVoiceCameraOn(false);
    setScreenShares([]);
    setSelectedStreamKey(null);
  }, [appendVoiceDiagnostic, clearVoiceAudio, session?.user.id]);

  const handleVoiceJoin = async () => {
    if (voiceStatus === "connecting" || voiceRoomRef.current) {
      appendVoiceDiagnostic("join:ignored", {
        voiceStatus,
        hasRoom: Boolean(voiceRoomRef.current)
      });
      return;
    }

    let room: Room | null = null;
    let joinedVoicePresence = false;
    setVoiceStatus("connecting");
    setError(null);
    appendVoiceDiagnostic("join:start", {
      userId: session?.user.id ?? null,
      socketConnected: Boolean(socketRef.current?.connected)
    });

    try {
      const credentials = await api.createVoiceToken();
      room = new Room({ adaptiveStream: true, dynacast: true });
      appendVoiceDiagnostic("join:token-created", {
        roomName: credentials.roomName,
        identity: credentials.identity,
        url: credentials.url
      });

      const attachAudio = (track: RemoteTrack, participant: RemoteParticipant) => {
        if (track.kind !== Track.Kind.Audio) {
          return;
        }

        const element = track.attach();
        element.autoplay = true;
        element.setAttribute("playsinline", "true");
        element.style.display = "none";
        element.volume = getVoiceVolumeGain(
          participant.identity,
          voiceVolumesRef.current,
          locallyMutedVoiceUsersRef.current,
          voiceDeafenedRef.current
        );
        document.body.appendChild(element);
        voiceAudioElementsRef.current.add(element);
        appendVoiceDiagnostic("livekit:audio-attached", {
          participantId: participant.identity,
          trackSid: track.sid ?? null,
          volume: element.volume
        });
      };

      const detachAudio = (track: RemoteTrack) => {
        for (const element of track.detach()) {
          element.remove();
          voiceAudioElementsRef.current.delete(element);
        }
        appendVoiceDiagnostic("livekit:audio-detached", {
          trackSid: track.sid ?? null
        });
      };

      const sync = () => {
        if (!room || staleVoiceRoomsRef.current.has(room)) {
          appendVoiceDiagnostic("livekit:stale-sync-ignored", {
            room: describeVoiceRoom(room)
          });
          return;
        }

        syncVoiceParticipants(room);
        syncScreenShares(room);
        applyVoiceAudioPreferences(room);
      };
      const syncLocalVideoPresence = () => {
        if (!room || staleVoiceRoomsRef.current.has(room)) {
          appendVoiceDiagnostic("video:stale-presence-ignored", {
            room: describeVoiceRoom(room)
          });
          return;
        }

        const wasSharing = voiceSharingRef.current;
        const wasCameraOn = voiceCameraOnRef.current;

        sync();

        const localSharing = screenShareStartingRef.current || isParticipantScreenSharing(room.localParticipant);
        const localCameraOn = cameraStartingRef.current || isParticipantCameraOn(room.localParticipant);

        if (wasSharing === localSharing && wasCameraOn === localCameraOn) {
          return;
        }

        voiceSharingRef.current = localSharing;
        voiceCameraOnRef.current = localCameraOn;
        setVoiceSharing(localSharing);
        setVoiceCameraOn(localCameraOn);
        void emitVoiceSelfState({ screenSharing: localSharing, cameraOn: localCameraOn })
          .then((state) => state && setVoiceServerState(state))
          .catch((requestError) =>
            appendVoiceDiagnostic("video:self-state-error", {
              error: getMessage(requestError),
              localSharing,
              localCameraOn
            })
          );
      };

      room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        appendVoiceDiagnostic("livekit:participant-connected", {
          participant: describeLiveKitParticipant(participant),
          room: describeVoiceRoom(room)
        });
        sync();
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        appendVoiceDiagnostic("livekit:participant-disconnected", {
          participant: describeLiveKitParticipant(participant),
          room: describeVoiceRoom(room)
        });
        sync();
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        appendVoiceDiagnostic("livekit:active-speakers", {
          speakers: speakers.map((speaker) => speaker.identity)
        });
        sync();
      });
      room.on(RoomEvent.TrackMuted, (publication, participant) => {
        appendVoiceDiagnostic("livekit:track-muted", {
          participant: participant.identity,
          source: publication.source,
          kind: publication.kind
        });
        sync();
      });
      room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
        appendVoiceDiagnostic("livekit:track-unmuted", {
          participant: participant.identity,
          source: publication.source,
          kind: publication.kind
        });
        sync();
      });
      room.on(RoomEvent.TrackPublished, (publication, participant) => {
        appendVoiceDiagnostic("livekit:track-published", {
          participant: participant.identity,
          source: publication.source,
          kind: publication.kind
        });
        sync();
      });
      room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
        appendVoiceDiagnostic("livekit:track-unpublished", {
          participant: participant.identity,
          source: publication.source,
          kind: publication.kind
        });
        sync();
      });
      room.on(RoomEvent.LocalTrackPublished, syncLocalVideoPresence);
      room.on(RoomEvent.LocalTrackUnpublished, syncLocalVideoPresence);
      room.on(RoomEvent.Reconnecting, () => {
        appendVoiceDiagnostic("livekit:reconnecting", describeVoiceRoom(room));
        setVoiceStatus("reconnecting");
      });
      room.on(RoomEvent.Reconnected, () => {
        appendVoiceDiagnostic("livekit:reconnected", describeVoiceRoom(room));
        setVoiceStatus("connected");
        void announceVoicePresence("livekit-reconnected").then((state) => state && setVoiceServerState(state)).catch((requestError) => {
          setError(getMessage(requestError));
        });
      });
      room.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
          appendVoiceDiagnostic("livekit:track-subscribed", {
            participant: _participant.identity,
            source: _publication.source,
            kind: track.kind,
            trackSid: track.sid ?? null
          });
          attachAudio(track, _participant);
          sync();
        }
      );
      room.on(
        RoomEvent.TrackUnsubscribed,
        (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
          appendVoiceDiagnostic("livekit:track-unsubscribed", {
            participant: _participant.identity,
            source: _publication.source,
            kind: track.kind,
            trackSid: track.sid ?? null
          });
          detachAudio(track);
          sync();
        }
      );
      room.on(RoomEvent.Disconnected, () => {
        appendVoiceDiagnostic("livekit:disconnected", describeVoiceRoom(room));
        if (room && staleVoiceRoomsRef.current.has(room)) {
          appendVoiceDiagnostic("livekit:stale-disconnect-ignored", describeVoiceRoom(room));
          return;
        }

        clearVoiceAudio();
        voiceRoomRef.current = null;
        voiceJoinedAtRef.current = null;
        voiceMutedRef.current = false;
        voiceDeafenedRef.current = false;
        voiceSharingRef.current = false;
        voiceCameraOnRef.current = false;
        voiceViewingStreamIdRef.current = null;
        setVoiceStatus("disconnected");
        setVoiceMuted(false);
        setVoiceDeafened(false);
        setVoiceSharing(false);
        setVoiceCameraOn(false);
        setScreenShares([]);
        setSelectedStreamKey(null);
      });

      await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(true);
      voiceRoomRef.current = room;
      voiceJoinedAtRef.current = new Date().toISOString();
      setVoiceStatus("connected");
      setVoiceMuted(false);
      setVoiceDeafened(false);
      setVoiceCameraOn(false);
      appendVoiceDiagnostic("join:livekit-connected", describeVoiceRoom(room));
      const voiceState = await announceVoicePresence("join");
      joinedVoicePresence = Boolean(voiceState);
      if (voiceState) {
        setVoiceServerState(voiceState);
      }
      syncVoiceParticipants(room);
      syncScreenShares(room);
      applyVoiceAudioPreferences(room);
    } catch (requestError) {
      if (joinedVoicePresence) {
        socketRef.current?.emit("voice:leave");
      }
      room?.disconnect();
      clearVoiceAudio();
      setVoiceStatus("failed");
      appendVoiceDiagnostic("join:error", {
        error: getMessage(requestError),
        joinedVoicePresence,
        socketConnected: Boolean(socketRef.current?.connected)
      });
      setError(getMessage(requestError));
    }
  };

  const handleVoiceMuteToggle = async () => {
    const room = voiceRoomRef.current;
    const selfState = voiceServerState.participants.find((participant) => participant.userId === session?.user.id);

    if (!room || voiceStatus !== "connected") {
      return;
    }

    if (selfState?.serverMuted || selfState?.serverDeafened) {
      setError("You are server muted and cannot unmute yourself.");
      return;
    }

    try {
      const nextMuted = !voiceMuted;
      voiceMutedRef.current = nextMuted;
      setVoiceMuted(nextMuted);
      syncVoiceParticipants(room);
      await room.localParticipant.setMicrophoneEnabled(!nextMuted);
      appendVoiceDiagnostic("mute:toggled", {
        nextMuted,
        room: describeVoiceRoom(room)
      });
      const state = await emitVoiceSelfState({ selfMuted: nextMuted });
      if (state) {
        setVoiceServerState(state);
      }
      syncVoiceParticipants(room);
    } catch (requestError) {
      voiceMutedRef.current = voiceMuted;
      setVoiceMuted(voiceMuted);
      syncVoiceParticipants(room);
      appendVoiceDiagnostic("mute:error", { error: getMessage(requestError) });
      setError(getMessage(requestError));
    }
  };

  const handleVoiceDeafenToggle = async () => {
    const room = voiceRoomRef.current;
    const selfState = voiceServerState.participants.find((participant) => participant.userId === session?.user.id);

    if (!room || voiceStatus !== "connected") {
      return;
    }

    try {
      const nextDeafened = !voiceDeafened;
      const forcedMuted = nextDeafened || Boolean(selfState?.serverMuted || selfState?.serverDeafened);
      voiceDeafenedRef.current = nextDeafened;
      voiceMutedRef.current = forcedMuted;
      setVoiceDeafened(nextDeafened);
      setVoiceMuted(forcedMuted);
      applyVoiceAudioPreferences(room);
      syncVoiceParticipants(room);
      await room.localParticipant.setMicrophoneEnabled(!forcedMuted);
      appendVoiceDiagnostic("deafen:toggled", {
        nextDeafened,
        forcedMuted,
        room: describeVoiceRoom(room)
      });
      const state = await emitVoiceSelfState({ selfDeafened: nextDeafened, selfMuted: forcedMuted });
      if (state) {
        setVoiceServerState(state);
      }
      applyVoiceAudioPreferences(room);
      syncVoiceParticipants(room);
    } catch (requestError) {
      voiceDeafenedRef.current = voiceDeafened;
      voiceMutedRef.current = voiceMuted;
      setVoiceDeafened(voiceDeafened);
      setVoiceMuted(voiceMuted);
      applyVoiceAudioPreferences(room);
      syncVoiceParticipants(room);
      appendVoiceDiagnostic("deafen:error", { error: getMessage(requestError) });
      setError(getMessage(requestError));
    }
  };

  const handleScreenShareToggle = async () => {
    const room = voiceRoomRef.current;

    if (!room || voiceStatus !== "connected" || !session) {
      setError("Join voice before sharing your screen.");
      return;
    }

    try {
      if (voiceSharing) {
        await room.localParticipant.setScreenShareEnabled(false);
        screenShareStartingRef.current = false;
        voiceSharingRef.current = false;
        setVoiceSharing(false);
        setSelectedStreamKey((current) => (current === getVideoStreamId(session.user.id, "screen") ? null : current));
        appendVoiceDiagnostic("screen-share:stop", describeVoiceRoom(room));
        const state = await emitVoiceSelfState({ screenSharing: false });
        if (state) {
          setVoiceServerState(state);
        }
        syncScreenShares(room);
        return;
      }

      const source = await requestScreenSource();

      if (!source) {
        appendVoiceDiagnostic("screen-share:cancelled");
        return;
      }

      appendVoiceDiagnostic("screen-share:start", {
        sourceId: source.id,
        sourceName: source.name
      });
      await window.gcchat.screens.selectSource(source.id);
      screenShareStartingRef.current = true;
      voiceSharingRef.current = true;
      setVoiceSharing(true);
      await room.localParticipant.setScreenShareEnabled(true);
      screenShareStartingRef.current = false;
      voiceSharingRef.current = true;
      setVoiceSharing(true);
      const state = await emitVoiceSelfState({ screenSharing: true });
      if (state) {
        setVoiceServerState(state);
      }
      setSelectedStreamKey(getVideoStreamId(session.user.id, "screen"));
      syncScreenShares(room);
    } catch (requestError) {
      screenShareStartingRef.current = false;
      voiceSharingRef.current = false;
      setVoiceSharing(false);
      void emitVoiceSelfState({ screenSharing: false });
      appendVoiceDiagnostic("screen-share:error", { error: getMessage(requestError) });
      setError(getMessage(requestError));
    }
  };

  const handleCameraToggle = async () => {
    const room = voiceRoomRef.current;

    if (!room || voiceStatus !== "connected" || !session) {
      setError("Join voice before turning on your camera.");
      return;
    }

    try {
      if (voiceCameraOn) {
        await room.localParticipant.setCameraEnabled(false);
        cameraStartingRef.current = false;
        voiceCameraOnRef.current = false;
        setVoiceCameraOn(false);
        setSelectedStreamKey((current) => (current === getVideoStreamId(session.user.id, "camera") ? null : current));
        appendVoiceDiagnostic("camera:stop", describeVoiceRoom(room));
        const state = await emitVoiceSelfState({ cameraOn: false });
        if (state) {
          setVoiceServerState(state);
        }
        syncScreenShares(room);
        return;
      }

      cameraStartingRef.current = true;
      voiceCameraOnRef.current = true;
      setVoiceCameraOn(true);
      appendVoiceDiagnostic("camera:start", describeVoiceRoom(room));
      await room.localParticipant.setCameraEnabled(true);
      cameraStartingRef.current = false;
      voiceCameraOnRef.current = true;
      setVoiceCameraOn(true);
      const state = await emitVoiceSelfState({ cameraOn: true });
      if (state) {
        setVoiceServerState(state);
      }
      setSelectedStreamKey(getVideoStreamId(session.user.id, "camera"));
      syncScreenShares(room);
    } catch (requestError) {
      cameraStartingRef.current = false;
      voiceCameraOnRef.current = false;
      setVoiceCameraOn(false);
      void emitVoiceSelfState({ cameraOn: false });
      appendVoiceDiagnostic("camera:error", { error: getMessage(requestError) });
      setError(getMessage(requestError));
    }
  };

  const handleVoiceModeration = async (payload: VoiceModerationRequest) => {
    setVoiceServerState((current) => ({
      ...current,
      participants: payload.disconnect
        ? current.participants.filter((participant) => participant.userId !== payload.targetUserId)
        : current.participants.map((participant) =>
            participant.userId === payload.targetUserId
              ? {
                  ...participant,
                  serverMuted: payload.serverMuted ?? participant.serverMuted,
                  serverDeafened: payload.serverDeafened ?? participant.serverDeafened,
                  selfMuted:
                    payload.serverMuted === false || payload.serverDeafened === false ? false : participant.selfMuted,
                  selfDeafened: payload.serverDeafened === false ? false : participant.selfDeafened
                }
              : participant
          )
    }));
    onErrorFromAsync(async () => {
      const state = await emitVoiceModeration(payload);
      if (state) {
        setVoiceServerState(state);
      }
    }, setError);
  };

  const repairMissingVoicePresence = useCallback(
    (state = voiceServerStateRef.current, reason = "repair") => {
      if (!session || !voiceRoomRef.current || !socketRef.current?.connected) {
        return;
      }

      const selfState = state.participants.find((participant) => participant.userId === session.user.id);

      if (selfState && !selfState.reconnecting) {
        return;
      }

      appendVoiceDiagnostic("presence:repair", {
        reason,
        selfState: selfState ?? null,
        serverState: describeVoiceState(state, session.user.id),
        room: describeVoiceRoom(voiceRoomRef.current)
      });

      void announceVoicePresence(reason)
        .then((nextState) => {
          if (nextState) {
            setVoiceServerState(nextState);
          }
        })
        .catch((requestError) =>
          appendVoiceDiagnostic("presence:repair-error", {
            reason,
            error: getMessage(requestError)
          })
        );
    },
    [announceVoicePresence, appendVoiceDiagnostic, session?.user.id]
  );

  useEffect(() => {
    return () => disconnectVoice();
  }, [disconnectVoice]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const repairTimer = window.setInterval(() => repairMissingVoicePresence(undefined, "repair-interval"), 3000);
    const heartbeatTimer = window.setInterval(() => {
      if (!voiceRoomRef.current) {
        return;
      }

      if (!socketRef.current?.connected) {
        appendVoiceDiagnostic("presence:heartbeat-skipped", {
          reason: "Socket is not connected.",
          room: describeVoiceRoom(voiceRoomRef.current)
        });
        return;
      }

      void announceVoicePresence("heartbeat")
        .then((state) => {
          if (state) {
            setVoiceServerState(state);
          }
        })
        .catch((requestError) =>
          appendVoiceDiagnostic("presence:heartbeat-error", {
            error: getMessage(requestError)
          })
        );
    }, 10000);

    return () => {
      window.clearInterval(repairTimer);
      window.clearInterval(heartbeatTimer);
    };
  }, [announceVoicePresence, appendVoiceDiagnostic, repairMissingVoicePresence, session?.user.id]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const repairOnFocus = () => repairMissingVoicePresence(undefined, "window-focus");
    const repairOnVisibility = () => {
      if (document.visibilityState === "visible") {
        repairMissingVoicePresence(undefined, "visibility-visible");
      }
    };

    window.addEventListener("focus", repairOnFocus);
    document.addEventListener("visibilitychange", repairOnVisibility);

    return () => {
      window.removeEventListener("focus", repairOnFocus);
      document.removeEventListener("visibilitychange", repairOnVisibility);
    };
  }, [repairMissingVoicePresence, session?.user.id]);

  useEffect(() => {
    syncVoiceParticipants(voiceRoomRef.current);
  }, [session?.members, session?.user, syncVoiceParticipants, voiceServerState]);

  useEffect(() => {
    applyVoiceAudioPreferences(voiceRoomRef.current);
    syncVoiceParticipants(voiceRoomRef.current);
  }, [applyVoiceAudioPreferences, locallyMutedVoiceUsers, syncVoiceParticipants, voiceDeafened, voiceVolumes]);

  useEffect(() => {
    if (!selectedStreamKey) {
      return;
    }

    const selectedShare = screenShares.find((share) => share.id === selectedStreamKey);

    if (!selectedShare) {
      setSelectedStreamKey(null);
    }
  }, [screenShares, selectedStreamKey]);

  useEffect(() => {
    const selectedShare = selectedStreamKey
      ? screenShares.find((share) => share.id === selectedStreamKey) ?? null
      : null;
    const viewingStreamId = selectedShare?.id ?? null;

    if (voiceViewingStreamIdRef.current === viewingStreamId) {
      return;
    }

    voiceViewingStreamIdRef.current = viewingStreamId;

    if (!voiceRoomRef.current || !socketRef.current?.connected) {
      return;
    }

    void emitVoiceSelfState({ viewingStreamId })
      .then((state) => state && setVoiceServerState(state))
      .catch((requestError) =>
        appendVoiceDiagnostic("stream-watch:self-state-error", {
          error: getMessage(requestError),
          viewingStreamId
        })
      );
  }, [appendVoiceDiagnostic, emitVoiceSelfState, screenShares, selectedStreamKey]);

  useEffect(() => {
    const room = voiceRoomRef.current;
    const selfState = voiceServerState.participants.find((participant) => participant.userId === session?.user.id);

    if (!room || !selfState) {
      return;
    }

    applySelfVoiceServerState(selfState, "server-state-effect");
  }, [applySelfVoiceServerState, session?.user.id, voiceServerState.participants]);

  const enterBannedState = () => {
    localStorage.removeItem(tokenStorageKey);
    api.setToken(null);
    disconnectVoice();
    socketRef.current?.disconnect();
    setBanned(true);
    setSession(null);
    setMessagesByChannel({});
    setMessageHistoryState({});
    setCalendarEvents([]);
    setCalendarEventsStatus("idle");
    setCustomEmojis([]);
    setAuditLogs([]);
    setSelectedProfile(null);
    setSettingsOpen(false);
  };

  useEffect(() => {
    if (!session) {
      disconnectVoice();
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
      setMessagesByChannel({});
      setMessageHistoryState({});
      setCalendarEvents([]);
      setCalendarEventsStatus("idle");
      setCustomEmojis([]);
      setAuditLogs([]);
      return;
    }

    api.setToken(session.token);
    let active = true;
    let calendarRetryTimer: number | null = null;
    let calendarLoadedOnce = false;

    const loadCalendarEvents = (attempt = 0) => {
      if (!active) {
        return;
      }

      if (calendarRetryTimer !== null) {
        window.clearTimeout(calendarRetryTimer);
        calendarRetryTimer = null;
      }

      if (!calendarLoadedOnce) {
        setCalendarEventsStatus("loading");
      }

      void api
        .getCalendarEvents()
        .then((events) => {
          if (!active) {
            return;
          }

          calendarLoadedOnce = true;
          setCalendarEvents(events);
          setCalendarEventsStatus("ready");
        })
        .catch(() => {
          if (!active) {
            return;
          }

          if (!calendarLoadedOnce) {
            setCalendarEventsStatus("error");
          }

          const retryDelay = Math.min(1000 * 2 ** attempt, 10000);
          calendarRetryTimer = window.setTimeout(() => loadCalendarEvents(attempt + 1), retryDelay);
        });
    };

    loadCalendarEvents();

    api
      .getCustomEmojis()
      .then((emojis) => {
        if (active) {
          setCustomEmojis(emojis);
        }
      })
      .catch((requestError) => setError(getMessage(requestError)));

    const socket: ChatSocket = io(API_URL, {
      auth: { token: session.token },
      transports: ["websocket", "polling"]
    });

    socket.on("connect", () => {
      appendVoiceDiagnostic("socket:connect", {
        socketId: socket.id,
        transport: socket.io.engine.transport.name,
        hasVoiceRoom: Boolean(voiceRoomRef.current)
      });

      for (const channel of session.channels) {
        socket.emit("channel:join", { channelId: channel.id });
      }

      if (voiceRoomRef.current) {
        void announceVoicePresence("socket-connect")
          .then((state) => state && setVoiceServerState(state))
          .catch((requestError) =>
            appendVoiceDiagnostic("socket:connect-presence-error", {
              error: getMessage(requestError)
            })
          );
      }
    });

    socket.on("disconnect", (reason) => {
      appendVoiceDiagnostic("socket:disconnect", {
        reason,
        hadVoiceRoom: Boolean(voiceRoomRef.current),
        serverState: describeVoiceState(voiceServerStateRef.current, session.user.id)
      });
    });

    socket.on("message:new", (message) => {
      setMessagesByChannel((current) => upsertMessageInChannel(current, normalizeMessage(message)));

      if (
        session.user.id !== message.author.id &&
        messageShouldNotifyUser(message, session.user) &&
        shouldNotifyMention(notificationPrefs)
      ) {
        showMentionNotification(message, notificationPrefs, setToasts);
      }
    });

    socket.on("message:updated", (message) => {
      setMessagesByChannel((current) => replaceMessageInChannel(current, message.id, normalizeMessage(message)));
    });

    socket.on("message:deleted", (payload) => {
      setMessagesByChannel((current) => removeMessageFromChannel(current, payload.channelId, payload.id));
    });

    socket.on("profile:updated", (profile) => {
      setSession((current) => (current ? applyProfileUpdate(current, profile) : current));
      setMessagesByChannel((current) => applyProfileUpdateToMessages(current, profile));
      setCalendarEvents((current) => applyProfileUpdateToCalendarEvents(current, profile));
      setSelectedProfile((current) => (current?.id === profile.id ? profile : current));
    });

    socket.on("members:updated", (members) => {
      setSession((current) => (current ? { ...current, members } : current));
    });

    socket.on("channels:updated", (channels) => {
      setSession((current) => {
        if (!current) {
          return current;
        }

        const fallbackChannel = channels[0] ?? current.channel;

        return {
          ...current,
          channels,
          channel: channels.find((channel) => channel.id === current.channel.id) ?? fallbackChannel
        };
      });
      setActiveChannelId((current) =>
        channels.some((channel) => channel.id === current) ? current : channels[0]?.id ?? null
      );
    });

    socket.on("session:banned", enterBannedState);

    socket.on("calendar:event:upsert", () => loadCalendarEvents());

    socket.on("calendar:event:deleted", (payload) => {
      setCalendarEvents((current) => current.filter((event) => event.id !== payload.id));
    });

    socket.on("audit:new", (entry) => {
      setAuditLogs((current) => [entry, ...current.filter((log) => log.id !== entry.id)].slice(0, 200));
    });

    socket.on("emojis:updated", setCustomEmojis);

    socket.on("voice:state", (state) => {
      appendVoiceDiagnostic("socket:voice-state", {
        state: describeVoiceState(state, session.user.id),
        room: describeVoiceRoom(voiceRoomRef.current)
      });
      setVoiceServerState(state);
      window.setTimeout(() => repairMissingVoicePresence(state, "server-state"), 250);
    });

    socket.on("voice:moderated", (state) => {
      if (state.userId !== session.user.id) {
        return;
      }

      appendVoiceDiagnostic("socket:voice-moderated", state);

      applySelfVoiceServerState(state, "socket:voice-moderated");
    });

    socket.on("voice:force-disconnect", () => {
      appendVoiceDiagnostic("socket:voice-force-disconnect");
      disconnectVoice(false);
      setError("You were disconnected from voice by an admin.");
    });

    socket.on("connect_error", (socketError) => {
      appendVoiceDiagnostic("socket:connect-error", {
        message: socketError.message
      });
      setError(socketError.message);
    });
    socketRef.current = socket;
    setSocket(socket);

    return () => {
      active = false;
      if (calendarRetryTimer !== null) {
        window.clearTimeout(calendarRetryTimer);
      }
      socket.disconnect();
      setSocket(null);
    };
  }, [applySelfVoiceServerState, notificationPrefs, session?.token]);

  useEffect(() => {
    if (!session || !activeChannel) {
      return;
    }

    socketRef.current?.emit("channel:join", { channelId: activeChannel.id });

    if (messagesByChannel[activeChannel.id]) {
      return;
    }

    let active = true;

    api
      .getMessages(activeChannel.id)
      .then((page) => {
        if (active) {
          setMessagesByChannel((current) => ({
            ...current,
            [activeChannel.id]: page.messages.map(normalizeMessage)
          }));
          setMessageHistoryState((current) => ({
            ...current,
            [activeChannel.id]: { hasMore: page.hasMore, loadingOlder: false }
          }));
        }
      })
      .catch((requestError) => setError(getMessage(requestError)));

    return () => {
      active = false;
    };
  }, [activeChannel?.id, messagesByChannel, session]);

  useEffect(() => {
    setReplyToMessage(null);
  }, [activeChannel?.id]);

  const handleLoadOlderMessages = async (channelId: string) => {
    const state = messageHistoryState[channelId];
    const currentMessages = messagesByChannel[channelId] ?? [];
    const before = currentMessages[0]?.id;

    if (!before || state?.loadingOlder || state?.hasMore === false) {
      return;
    }

    setMessageHistoryState((current) => ({
      ...current,
      [channelId]: { hasMore: current[channelId]?.hasMore ?? true, loadingOlder: true }
    }));

    try {
      const page = await api.getMessages(channelId, { before });
      const existingIds = new Set((messagesByChannel[channelId] ?? []).map((message) => message.id));
      const olderMessages = page.messages.map(normalizeMessage).filter((message) => !existingIds.has(message.id));

      setMessagesByChannel((current) => ({
        ...current,
        [channelId]: [...olderMessages, ...(current[channelId] ?? [])]
      }));
      setMessageHistoryState((current) => ({
        ...current,
        [channelId]: { hasMore: page.hasMore, loadingOlder: false }
      }));
    } catch (requestError) {
      setMessageHistoryState((current) => ({
        ...current,
        [channelId]: { hasMore: current[channelId]?.hasMore ?? true, loadingOlder: false }
      }));
      setError(getMessage(requestError));
    }
  };

  const handleAuth = (auth: AuthResponse) => {
    localStorage.setItem(tokenStorageKey, auth.token);
    api.setToken(auth.token);
    setSession(auth);
    setActiveChannelId(auth.channel.id);
    setBanned(Boolean(auth.user.bannedAt));
    setError(null);
  };

  const handleLogout = () => {
    localStorage.removeItem(tokenStorageKey);
    api.setToken(null);
    disconnectVoice();
    socketRef.current?.disconnect();
    setSession(null);
    setActiveChannelId(null);
    setMessagesByChannel({});
    setMessageHistoryState({});
    setCustomEmojis([]);
    setBanned(false);
    setSelectedProfile(null);
    setSettingsOpen(false);
  };

  const handleProfileSaved = (profile: UserProfile) => {
    setSession((current) => (current ? applyProfileUpdate(current, profile) : current));
    setSettingsOpen(false);
  };

  const handleCalendarEventCreated = (event: CalendarEventView) => {
    setCalendarEvents((current) => upsertCalendarEvent(current, event));
  };

  const handleCalendarEventUpdated = (event: CalendarEventView) => {
    setCalendarEvents((current) => upsertCalendarEvent(current, event));
  };

  const handleChannelCreated = (channel: ChannelSummary) => {
    setSession((current) =>
      current
        ? {
            ...current,
            channels: current.channels.some((existing) => existing.id === channel.id)
              ? current.channels
              : [...current.channels, channel]
          }
        : current
    );
    setVoiceViewOpen(false);
    setActiveChannelId(channel.id);
  };

  const handleChannelsChanged = (channels: ChannelSummary[]) => {
    setSession((current) => {
      if (!current) {
        return current;
      }

      const fallbackChannel = channels[0] ?? current.channel;

      return {
        ...current,
        channels,
        channel: channels.find((channel) => channel.id === current.channel.id) ?? fallbackChannel
      };
    });
    setActiveChannelId((current) =>
      channels.some((channel) => channel.id === current) ? current : channels[0]?.id ?? null
    );
    setVoiceViewOpen(false);
  };

  const handleManagedProfile = (profile: UserProfile) => {
    setSession((current) => (current ? applyProfileUpdate(current, profile) : current));
    setSelectedProfile(profile);
  };

  const handleOptimisticMessage = (message: MessageView) => {
    setMessagesByChannel((current) => upsertMessageInChannel(current, message));
  };

  const handleConfirmedMessage = (temporaryId: string, message: MessageView) => {
    setMessagesByChannel((current) => replaceMessageInChannel(current, temporaryId, message));
  };

  const handleFailedMessage = (temporaryId: string, channelId: string) => {
    setMessagesByChannel((current) => removeMessageFromChannel(current, channelId, temporaryId));
  };

  const handleReaction = async (message: MessageView, emoji: string) => {
    if (!session || message.id.startsWith("temp-")) {
      return;
    }

    setMessagesByChannel((current) => applyReactionOptimistically(current, message, emoji, session.user));
    setError(null);

    try {
      const updated = await api.toggleMessageReaction(message.id, { emoji });
      setMessagesByChannel((current) => replaceMessageInChannel(current, message.id, updated));
    } catch (requestError) {
      setError(getMessage(requestError));
      void api.getMessages(message.channelId).then((page) => {
        setMessagesByChannel((current) => ({
          ...current,
          [message.channelId]: page.messages.map(normalizeMessage)
        }));
        setMessageHistoryState((current) => ({
          ...current,
          [message.channelId]: { hasMore: page.hasMore, loadingOlder: false }
        }));
      });
    }
  };

  const handleMessageEdited = (message: MessageView) => {
    setMessagesByChannel((current) => replaceMessageInChannel(current, message.id, message));
    setEditingMessage(null);
  };

  const handleMessageDelete = async (message: MessageView) => {
    onErrorFromAsync(async () => {
      const deleted = await api.deleteMessage(message.id);
      setMessagesByChannel((current) => removeMessageFromChannel(current, deleted.channelId, deleted.id));
    }, setError);
  };

  const handleCalendarEventDeleted = (eventId: string) => {
    setCalendarEvents((current) => current.filter((event) => event.id !== eventId));
  };

  const handleAuditRestore = async (entry: AuditLogView) => {
    onErrorFromAsync(async () => {
      const restored = await api.restoreAuditLogEntry(entry.id);
      setAuditLogs((current) => current.map((log) => (log.id === restored.auditLog.id ? restored.auditLog : log)));

      if (restored.message) {
        setMessagesByChannel((current) => upsertMessageInChannel(current, restored.message!));
      }

      if (restored.event) {
        setCalendarEvents((current) => upsertCalendarEvent(current, restored.event!));
      }
    }, setError);
  };

  const handleOpenCalendarEvent = (eventId: string) => {
    setCalendarFocusEventId(eventId);
    setActiveFeature("calendar");
  };

  const handleCustomEmojisChanged = (emojis: CustomEmojiView[]) => {
    setCustomEmojis(emojis);
  };

  if (loading) {
    return (
      <AppFrame updateStatus={updateStatus} theme={appearancePrefs.theme}>
        <div className="loading-screen">
          <Loader2 className="spin" size={28} />
        </div>
      </AppFrame>
    );
  }

  if (banned) {
    return (
      <AppFrame updateStatus={updateStatus} theme={appearancePrefs.theme}>
        <BannedScreen onLogout={handleLogout} />
      </AppFrame>
    );
  }

  if (!session) {
    return (
      <AppFrame updateStatus={updateStatus} theme={appearancePrefs.theme}>
        <AuthScreen onAuth={handleAuth} onBanned={() => setBanned(true)} />
      </AppFrame>
    );
  }

  const currentChannel = activeChannel ?? session.channel;
  const canManageEmojis = hasAtLeastRole(session.user.role, "ADMIN");
  const canViewAudit = session.user.role === "SUPER_ADMIN";
  const selectedStream = selectedStreamKey
    ? screenShares.find((share) => share.id === selectedStreamKey) ?? null
    : null;

  return (
    <AppFrame updateStatus={updateStatus} theme={appearancePrefs.theme}>
    <div className={`app-shell ${activeFeature}-shell`}>
      <aside className="server-rail">
        <button
          className={`server-pill ${activeFeature === "chat" ? "active" : ""}`}
          onClick={() => setActiveFeature("chat")}
          aria-label="Chat"
          title="Chat"
        >
          <MessageCircle size={25} />
        </button>
        <button
          className={`server-pill ${activeFeature === "calendar" ? "active" : ""}`}
          onClick={() => setActiveFeature("calendar")}
          aria-label="GC calendar"
          title="GC calendar"
        >
          <CalendarDays size={24} />
        </button>
        {canManageEmojis ? (
          <button
            className={`server-pill ${activeFeature === "emojis" ? "active" : ""}`}
            onClick={() => setActiveFeature("emojis")}
            aria-label="Emoji studio"
            title="Emoji studio"
          >
            <SmilePlus size={24} />
          </button>
        ) : null}
        {canViewAudit ? (
          <button
            className={`server-pill ${activeFeature === "audit" ? "active" : ""}`}
            onClick={() => setActiveFeature("audit")}
            aria-label="Audit log"
            title="Audit log"
          >
            <ClipboardList size={24} />
          </button>
        ) : null}
      </aside>

      {activeFeature === "chat" ? (
        <ChannelSidebar
          session={session}
          activeChannelId={currentChannel.id}
          activeVoiceView={voiceViewOpen}
          onChannelSelect={(channelId) => {
            setVoiceViewOpen(false);
            setSelectedStreamKey(null);
            setActiveChannelId(channelId);
          }}
          onVoiceChannelSelect={() => {
            setActiveFeature("chat");
            setVoiceViewOpen(true);
            setSelectedStreamKey(null);
          }}
          onChannelCreated={handleChannelCreated}
          onDeleteChannel={setDeleteChannel}
          onProfile={() => setSelectedProfile(session.user)}
          onSettings={() => setSettingsOpen(true)}
          onLogout={handleLogout}
          onError={setError}
          voiceStatus={voiceStatus}
          voiceMuted={voiceMuted}
          voiceDeafened={voiceDeafened}
          voiceSharing={voiceSharing}
          voiceCameraOn={voiceCameraOn}
          voiceParticipants={voiceParticipants}
          screenShares={screenShares}
          onVoiceJoin={() => void handleVoiceJoin()}
          onVoiceLeave={disconnectVoice}
          onVoiceMuteToggle={() => void handleVoiceMuteToggle()}
          onVoiceDeafenToggle={() => void handleVoiceDeafenToggle()}
          onScreenShareToggle={() => void handleScreenShareToggle()}
          onCameraToggle={() => void handleCameraToggle()}
          onWatchStream={setSelectedStreamKey}
          onVoiceProfile={setSelectedProfile}
          voiceDiagnosticsCount={voiceDiagnostics.length}
          onOpenVoiceDiagnostics={() => setVoiceDiagnosticsOpen(true)}
          onSetVoiceVolume={(userId, volume) => {
            const normalized = normalizeVoiceVolume(volume);
            const nextVolumes = { ...voiceVolumesRef.current, [userId]: normalized };
            appendVoiceDiagnostic("volume:set", { userId, volume: normalized });
            voiceVolumesRef.current = nextVolumes;
            setVoiceVolumes(nextVolumes);
            applyVoiceAudioPreferences(voiceRoomRef.current);
            syncVoiceParticipants(voiceRoomRef.current);
          }}
          onToggleLocalVoiceMute={(userId) => {
            appendVoiceDiagnostic("volume:toggle-local-mute", { userId });
            const current = locallyMutedVoiceUsersRef.current;
            const nextMutedUsers = current.includes(userId)
              ? current.filter((existing) => existing !== userId)
              : [...current, userId];
            locallyMutedVoiceUsersRef.current = nextMutedUsers;
            setLocallyMutedVoiceUsers(nextMutedUsers);
            applyVoiceAudioPreferences(voiceRoomRef.current);
            syncVoiceParticipants(voiceRoomRef.current);
          }}
          onVoiceModeration={(payload) => void handleVoiceModeration(payload)}
        />
      ) : null}

      {activeFeature === "chat" ? (
        <main className="chat-panel">
          <header className="chat-header">
            <div className="chat-title">
              {voiceViewOpen ? <Volume2 size={22} /> : <Hash size={22} />}
              <span>{voiceViewOpen ? "General Voice" : currentChannel.name}</span>
            </div>
          </header>

          {error ? (
            <div className="error-banner">
              <span>{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          ) : null}

          {selectedStream ? (
            <ScreenShareStage
              stream={selectedStream}
              allStreams={screenShares}
              participants={voiceParticipants}
              voiceStatus={voiceStatus}
              muted={voiceMuted}
              deafened={voiceDeafened}
              sharing={voiceSharing}
              cameraOn={voiceCameraOn}
              onSelectStream={setSelectedStreamKey}
              onExit={() => setSelectedStreamKey(null)}
              onToggleMute={() => void handleVoiceMuteToggle()}
              onToggleDeafen={() => void handleVoiceDeafenToggle()}
              onToggleScreenShare={() => void handleScreenShareToggle()}
              onToggleCamera={() => void handleCameraToggle()}
              onDisconnect={disconnectVoice}
            />
          ) : voiceViewOpen ? (
            <VoicePreviewStage
              participants={voiceParticipants}
              screenShares={screenShares}
              status={voiceStatus}
              muted={voiceMuted}
              deafened={voiceDeafened}
              sharing={voiceSharing}
              cameraOn={voiceCameraOn}
              onJoin={() => void handleVoiceJoin()}
              onToggleMute={() => void handleVoiceMuteToggle()}
              onToggleDeafen={() => void handleVoiceDeafenToggle()}
              onToggleScreenShare={() => void handleScreenShareToggle()}
              onToggleCamera={() => void handleCameraToggle()}
              onWatchStream={setSelectedStreamKey}
            />
          ) : (
            <>
              <MessageList
                messages={messages}
                hasMore={activeMessageHistory.hasMore}
                loadingOlder={activeMessageHistory.loadingOlder}
                members={session.members}
                calendarEvents={calendarEvents}
                calendarEventsStatus={calendarEventsStatus}
                customEmojis={customEmojis}
                currentUser={session.user}
                onProfile={setSelectedProfile}
                onReply={setReplyToMessage}
                onEdit={setEditingMessage}
                onDelete={(message) => void handleMessageDelete(message)}
                onReact={(message, emoji) => void handleReaction(message, emoji)}
                onEventUpdated={handleCalendarEventUpdated}
                onOpenCalendarEvent={handleOpenCalendarEvent}
                onLoadOlder={() => handleLoadOlderMessages(currentChannel.id)}
                onError={setError}
              />
              <Composer
                channel={currentChannel}
                currentUser={session.user}
                members={session.members}
                calendarEvents={calendarEvents}
                customEmojis={customEmojis}
                replyTo={replyToMessage}
                editingMessage={editingMessage}
                socket={socket}
                onCancelReply={() => setReplyToMessage(null)}
                onCancelEdit={() => setEditingMessage(null)}
                onError={setError}
                onOptimisticMessage={handleOptimisticMessage}
                onConfirmedMessage={handleConfirmedMessage}
                onFailedMessage={handleFailedMessage}
                onEdited={handleMessageEdited}
              />
            </>
          )}
        </main>
      ) : activeFeature === "calendar" ? (
        <CalendarView
          events={calendarEvents}
          eventsStatus={calendarEventsStatus}
          currentUser={session.user}
          focusEventId={calendarFocusEventId}
          onFocusHandled={() => setCalendarFocusEventId(null)}
          onCreated={handleCalendarEventCreated}
          onUpdated={handleCalendarEventUpdated}
          onDeleted={handleCalendarEventDeleted}
          onProfile={setSelectedProfile}
          onError={setError}
          error={error}
          onDismissError={() => setError(null)}
        />
      ) : activeFeature === "audit" ? (
        <AuditLogPanel
          entries={auditLogs}
          onRestore={(entry) => void handleAuditRestore(entry)}
          onError={setError}
          error={error}
          onDismissError={() => setError(null)}
        />
      ) : (
        <EmojiStudio
          emojis={customEmojis}
          onChanged={handleCustomEmojisChanged}
          onError={setError}
          error={error}
          onDismissError={() => setError(null)}
        />
      )}

      {activeFeature === "chat" ? (
        <MembersPanel members={session.members} onProfile={setSelectedProfile} />
      ) : activeFeature === "calendar" ? (
        <CalendarSidePanel
          events={calendarEvents}
          onProfile={setSelectedProfile}
          onOpenEvent={handleOpenCalendarEvent}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsPage
          user={session.user}
          notificationPrefs={notificationPrefs}
          appearancePrefs={appearancePrefs}
          onClose={() => setSettingsOpen(false)}
          onSaved={handleProfileSaved}
          onNotificationPrefsChange={setNotificationPrefs}
          onAppearancePrefsChange={setAppearancePrefs}
          onError={setError}
        />
      ) : null}
      {voiceDiagnosticsOpen ? (
        <VoiceDiagnosticsModal
          entries={voiceDiagnostics}
          onClose={() => setVoiceDiagnosticsOpen(false)}
          onClear={clearVoiceDiagnostics}
        />
      ) : null}
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />

      {selectedProfile ? (
        <ProfileCard
          profile={selectedProfile}
          viewer={session.user}
          onClose={() => setSelectedProfile(null)}
          onManaged={handleManagedProfile}
          onBanned={enterBannedState}
          onError={setError}
        />
      ) : null}
      {deleteChannel ? (
        <DeleteChannelModal
          channel={deleteChannel}
          onClose={() => setDeleteChannel(null)}
          onDeleted={(channels) => {
            handleChannelsChanged(channels);
            setDeleteChannel(null);
          }}
          onError={setError}
        />
      ) : null}
      {screenSourcePicker ? (
        <ScreenSourcePicker
          sources={screenSourcePicker}
          onSelect={resolveScreenSource}
          onCancel={() => resolveScreenSource(null)}
        />
      ) : null}
    </div>
    </AppFrame>
  );
}

function AppFrame({
  updateStatus,
  theme,
  children
}: {
  updateStatus: UpdateStatus;
  theme: ThemeName;
  children: ReactNode;
}) {
  return (
    <div className={`desktop-frame theme-${theme}`}>
      <TitleBar updateStatus={updateStatus} />
      {children}
    </div>
  );
}

function TitleBar({ updateStatus }: { updateStatus: UpdateStatus }) {
  return (
    <header className="titlebar">
      <div className="titlebar-drag">
        <span className="titlebar-mark">
          <MessageCircle size={15} />
        </span>
        <span>GCChat</span>
      </div>
      <div className="titlebar-actions">
        <UpdateButton status={updateStatus} />
        <button className="window-button" onClick={() => window.gcchat.window.minimize()} aria-label="Minimize">
          <Minus size={14} />
        </button>
        <button
          className="window-button"
          onClick={() => window.gcchat.window.toggleMaximize()}
          aria-label="Maximize"
        >
          <span className="maximize-icon" />
        </button>
        <button className="window-button close" onClick={() => window.gcchat.window.close()} aria-label="Close">
          <X size={15} />
        </button>
      </div>
    </header>
  );
}

function UpdateButton({ status }: { status: UpdateStatus }) {
  if (status.phase === "downloaded") {
    return (
      <button
        className="update-button ready"
        onClick={() => window.gcchat.updates.restartAndInstall()}
        title="Restart and install update"
      >
        <Download size={16} />
        Update
      </button>
    );
  }

  if (status.phase === "downloading" || status.phase === "checking") {
    return (
      <button className="update-button" disabled title="Checking for updates">
        <Loader2 className="spin" size={15} />
        {status.phase === "checking" ? "Check" : "Updating"}
      </button>
    );
  }

  return (
    <button
      className="update-button"
      onClick={() => void window.gcchat.updates.checkNow()}
      title={status.message ?? "Check for updates"}
    >
      <RefreshCw size={15} />
      Check
    </button>
  );
}

function BannedScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <main className="banned-screen">
      <section className="banned-card">
        <Ban size={34} />
        <h1>You are banned</h1>
        <button className="primary-button" onClick={onLogout}>
          <LogOut size={17} />
          Log out
        </button>
      </section>
    </main>
  );
}

function AuthScreen({
  onAuth,
  onBanned
}: {
  onAuth: (auth: AuthResponse) => void;
  onBanned: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const auth =
        mode === "register"
          ? await api.register(username, password)
          : await api.login(username, password);
      onAuth(auth);
    } catch (requestError) {
      const message = getMessage(requestError);

      if (message === "You are banned") {
        onBanned();
        return;
      }

      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-mark">
          <MessageCircle size={30} />
        </div>
        <h1>{mode === "register" ? "Create an account" : "Welcome back"}</h1>
        <form onSubmit={submit} className="auth-form">
          <label>
            Username
            <input
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="username"
            />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder="8+ characters"
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button" disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : null}
            {mode === "register" ? "Continue" : "Log in"}
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setMode(mode === "register" ? "login" : "register");
            setError(null);
          }}
        >
          {mode === "register" ? "Already have an account?" : "Need an account?"}
        </button>
      </section>
    </main>
  );
}

function ChannelSidebar({
  session,
  activeChannelId,
  activeVoiceView,
  onChannelSelect,
  onVoiceChannelSelect,
  onChannelCreated,
  onDeleteChannel,
  onProfile,
  onSettings,
  onLogout,
  onError,
  voiceStatus,
  voiceMuted,
  voiceDeafened,
  voiceSharing,
  voiceCameraOn,
  voiceParticipants,
  screenShares,
  onVoiceJoin,
  onVoiceLeave,
  onVoiceMuteToggle,
  onVoiceDeafenToggle,
  onScreenShareToggle,
  onCameraToggle,
  onWatchStream,
  onVoiceProfile,
  voiceDiagnosticsCount,
  onOpenVoiceDiagnostics,
  onSetVoiceVolume,
  onToggleLocalVoiceMute,
  onVoiceModeration
}: {
  session: Session;
  activeChannelId: string;
  activeVoiceView: boolean;
  onChannelSelect: (channelId: string) => void;
  onVoiceChannelSelect: () => void;
  onChannelCreated: (channel: ChannelSummary) => void;
  onDeleteChannel: (channel: ChannelSummary) => void;
  onProfile: () => void;
  onSettings: () => void;
  onLogout: () => void;
  onError: (error: string | null) => void;
  voiceStatus: VoiceStatus;
  voiceMuted: boolean;
  voiceDeafened: boolean;
  voiceSharing: boolean;
  voiceCameraOn: boolean;
  voiceParticipants: VoiceParticipantView[];
  screenShares: ScreenShareView[];
  onVoiceJoin: () => void;
  onVoiceLeave: () => void;
  onVoiceMuteToggle: () => void;
  onVoiceDeafenToggle: () => void;
  onScreenShareToggle: () => void;
  onCameraToggle: () => void;
  onWatchStream: (streamId: string) => void;
  onVoiceProfile: (profile: UserProfile) => void;
  voiceDiagnosticsCount: number;
  onOpenVoiceDiagnostics: () => void;
  onSetVoiceVolume: (userId: string, volume: number) => void;
  onToggleLocalVoiceMute: (userId: string) => void;
  onVoiceModeration: (payload: VoiceModerationRequest) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const canCreateChannel = hasAtLeastRole(session.user.role, "ADMIN");
  const canDeleteChannel = session.user.role === "SUPER_ADMIN" && session.channels.length > 1;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!name.trim() || busy) {
      return;
    }

    setBusy(true);
    onError(null);

    try {
      const channel = await api.createChannel({ name });
      onChannelCreated(channel);
      setName("");
      setCreating(false);
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="channel-sidebar">
      <div className="server-header">
        <span>{session.server.name}</span>
        <Sparkles size={16} />
      </div>

      <div className="channel-group">
        <div className="channel-group-title channel-title-row">
          <span>Text Channels</span>
          {canCreateChannel ? (
            <button
              className="channel-title-action"
              onClick={() => setCreating((current) => !current)}
              aria-label="Create text channel"
              title="Create text channel"
            >
              <Plus size={14} />
            </button>
          ) : null}
        </div>

        {creating ? (
          <form className="channel-create-form" onSubmit={submit}>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="new-channel"
              maxLength={32}
            />
            <button className="icon-button" disabled={busy || !name.trim()} aria-label="Create">
              {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
            </button>
          </form>
        ) : null}

        <div className="channel-list">
          {session.channels.map((channel) => (
            <div className={`channel-row ${canDeleteChannel ? "can-delete" : ""}`} key={channel.id}>
              <button
                className={`channel-link ${!activeVoiceView && channel.id === activeChannelId ? "active" : ""}`}
                onClick={() => onChannelSelect(channel.id)}
              >
                <Hash size={18} />
                <span>{channel.name}</span>
              </button>
              {canDeleteChannel ? (
                <button
                  className="channel-action"
                  onClick={() => onDeleteChannel(channel)}
                  aria-label={`Delete ${channel.name}`}
                  title={`Delete ${channel.name}`}
                >
                  <Trash2 size={15} />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <VoiceChannelSection
          currentUser={session.user}
          status={voiceStatus}
          muted={voiceMuted}
          deafened={voiceDeafened}
          sharing={voiceSharing}
          cameraOn={voiceCameraOn}
          participants={voiceParticipants}
          screenShares={screenShares}
          selected={activeVoiceView}
          onOpen={onVoiceChannelSelect}
          onJoin={onVoiceJoin}
          onLeave={onVoiceLeave}
          onToggleMute={onVoiceMuteToggle}
          onToggleDeafen={onVoiceDeafenToggle}
          onToggleScreenShare={onScreenShareToggle}
          onToggleCamera={onCameraToggle}
          onWatchStream={onWatchStream}
          onProfile={onVoiceProfile}
          onSetVolume={onSetVoiceVolume}
          onToggleLocalMute={onToggleLocalVoiceMute}
          onModerate={onVoiceModeration}
        />
      </div>

      <div className="channel-bottom">
        <VoiceStatusBar
          status={voiceStatus}
          muted={voiceMuted}
          deafened={voiceDeafened}
          sharing={voiceSharing}
          cameraOn={voiceCameraOn}
          participants={voiceParticipants}
          onJoin={onVoiceJoin}
          onLeave={onVoiceLeave}
          onToggleMute={onVoiceMuteToggle}
          onToggleDeafen={onVoiceDeafenToggle}
          onToggleScreenShare={onScreenShareToggle}
          onToggleCamera={onCameraToggle}
          diagnosticsCount={voiceDiagnosticsCount}
          onOpenDiagnostics={onOpenVoiceDiagnostics}
        />
      <div className="user-panel">
        <button className="user-identity" onClick={onProfile}>
          <Avatar profile={session.user} size="sm" status="online" />
          <span>
            <strong>{session.user.displayName}</strong>
            <small>@{session.user.username}</small>
          </span>
        </button>
        <button className="icon-button" onClick={onSettings} aria-label="Settings">
          <Settings size={18} />
        </button>
        <button className="icon-button" onClick={onLogout} aria-label="Log out">
          <LogOut size={18} />
        </button>
      </div>
      </div>
    </aside>
  );
}

function VoiceChannelSection({
  currentUser,
  status,
  muted,
  deafened,
  sharing,
  cameraOn,
  participants,
  screenShares,
  selected,
  onOpen,
  onJoin,
  onLeave,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onToggleCamera,
  onWatchStream,
  onProfile,
  onSetVolume,
  onToggleLocalMute,
  onModerate
}: {
  currentUser: UserProfile;
  status: VoiceStatus;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  cameraOn: boolean;
  participants: VoiceParticipantView[];
  screenShares: ScreenShareView[];
  selected: boolean;
  onOpen: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onToggleCamera: () => void;
  onWatchStream: (streamId: string) => void;
  onProfile: (profile: UserProfile) => void;
  onSetVolume: (userId: string, volume: number) => void;
  onToggleLocalMute: (userId: string) => void;
  onModerate: (payload: VoiceModerationRequest) => void;
}) {
  const connected = status === "connected";
  const connecting = status === "connecting";
  const active = participants.length > 0;
  const canModerate = hasAtLeastRole(currentUser.role, "ADMIN");
  const [contextMenu, setContextMenu] = useState<{
    participant: VoiceParticipantView;
    x: number;
    y: number;
  } | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{
    participant: VoiceParticipantView;
    x: number;
    y: number;
  } | null>(null);
  const previewCloseTimerRef = useRef<number | null>(null);

  const clearPreviewCloseTimer = () => {
    if (previewCloseTimerRef.current !== null) {
      window.clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }
  };

  const schedulePreviewClose = () => {
    clearPreviewCloseTimer();
    previewCloseTimerRef.current = window.setTimeout(() => setHoverPreview(null), 120);
  };

  const openStreamPreview = (event: React.MouseEvent<HTMLElement>, participant: VoiceParticipantView) => {
    if (!participant.isScreenSharing && !participant.isCameraOn) {
      return;
    }

    clearPreviewCloseTimer();
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 270;
    const height = 244;
    const gutter = 10;
    const x = Math.max(gutter, Math.min(rect.right + gutter, window.innerWidth - width - gutter));
    const y = Math.max(40, Math.min(rect.top - 18, window.innerHeight - height - gutter));

    setHoverPreview({ participant, x, y });
  };

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const close = () => setContextMenu(null);
    window.addEventListener("click", close);

    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  useEffect(() => {
    return clearPreviewCloseTimer;
  }, []);

  return (
    <section className="voice-channel-section">
      <div className="channel-group-title voice-title">Voice Channels</div>
      <button
        className={`channel-link voice-channel-link ${selected ? "active" : ""}`}
        onClick={onOpen}
        disabled={connecting}
        type="button"
      >
        {connecting ? <Loader2 className="spin" size={18} /> : <Volume2 size={18} />}
        <span>General Voice</span>
        {active && !connected ? <em className="voice-active-pill">Live</em> : null}
      </button>

      {connected || connecting || active ? (
        <div className="voice-connection-card">
          <div className="voice-status-row">
            <PhoneCall size={15} />
            <span>{voiceStatusLabel(status, active)}</span>
            {!connected && active ? (
              <button className="mini-join-button" type="button" onClick={onJoin}>
                Join
              </button>
            ) : null}
          </div>

          {participants.length > 0 ? (
            <div className="voice-participant-list">
              {participants.map((participant) => (
                <div
                  className={`voice-participant-row ${
                    participant.isScreenSharing || participant.isCameraOn ? "has-stream" : ""
                  }`}
                  key={participant.userId}
                  onMouseEnter={(event) => openStreamPreview(event, participant)}
                  onMouseLeave={schedulePreviewClose}
                >
                <button
                  className={`voice-participant ${participant.isSpeaking ? "speaking" : ""} ${
                    participant.reconnecting ? "reconnecting" : ""
                  }`}
                  type="button"
                  disabled={!participant.profile}
                  onClick={() => participant.profile && onProfile(participant.profile)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({
                      participant,
                      x: event.clientX,
                      y: event.clientY
                    });
                  }}
                  title={participant.isLocal ? "You" : participant.name}
                >
                  {participant.profile ? (
                    <Avatar profile={participant.profile} size="xs" />
                  ) : (
                    <span className="voice-fallback-avatar">{participant.name.slice(0, 2).toUpperCase()}</span>
                  )}
                  <span>{participant.isLocal ? `${participant.name} (you)` : participant.name}</span>
                  {participant.isCameraOn || participant.isScreenSharing ? (
                    <span className="video-badges">
                      {participant.isCameraOn ? (
                        <span
                          className="camera-badge"
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            onWatchStream(getVideoStreamId(participant.userId, "camera"));
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              onWatchStream(getVideoStreamId(participant.userId, "camera"));
                            }
                          }}
                          title="Camera on"
                        >
                          <Camera size={13} />
                        </span>
                      ) : null}
                      {participant.isScreenSharing ? (
                        <span
                          className="live-badge"
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            onWatchStream(getVideoStreamId(participant.userId, "screen"));
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              onWatchStream(getVideoStreamId(participant.userId, "screen"));
                            }
                          }}
                          title="Sharing screen"
                        >
                          LIVE
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  {participant.isServerMuted ? (
                    <MicOff className="server-muted-icon" size={13} aria-label="Server muted" />
                  ) : participant.isMuted ? (
                    <MicOff size={13} aria-label="Muted" />
                  ) : null}
                  {participant.isDeafened ? <VolumeX size={13} aria-label="Deafened" /> : null}
                  {participant.locallyMuted ? (
                    <VolumeX className="local-muted-icon" size={13} aria-label="Muted locally" />
                  ) : null}
                </button>
                </div>
              ))}
            </div>
          ) : null}

          {connected ? <VoiceControlRow
            muted={muted}
            deafened={deafened}
            sharing={sharing}
            cameraOn={cameraOn}
            onToggleMute={onToggleMute}
            onToggleDeafen={onToggleDeafen}
            onToggleScreenShare={onToggleScreenShare}
            onToggleCamera={onToggleCamera}
            onLeave={onLeave}
          /> : null}
          {contextMenu ? (
            <VoiceUserContextMenu
              state={contextMenu}
              canModerate={canModerate}
              currentUser={currentUser}
              onClose={() => setContextMenu(null)}
              onProfile={(profile) => {
                onProfile(profile);
                setContextMenu(null);
              }}
              onSetVolume={onSetVolume}
              onToggleLocalMute={onToggleLocalMute}
              onModerate={onModerate}
            />
          ) : null}
          {hoverPreview ? (
            <StreamHoverPreview
              stream={getPreferredVideoStream(screenShares, hoverPreview.participant.userId)}
              position={{ x: hoverPreview.x, y: hoverPreview.y }}
              onMouseEnter={clearPreviewCloseTimer}
              onMouseLeave={schedulePreviewClose}
              onWatch={() => {
                const stream = getPreferredVideoStream(screenShares, hoverPreview.participant.userId);
                if (stream) {
                  onWatchStream(stream.id);
                }
                setHoverPreview(null);
              }}
            />
          ) : null}
        </div>
      ) : status === "failed" ? (
        <p className="voice-error">Failed to connect.</p>
      ) : null}
    </section>
  );
}

function VoiceControlRow({
  muted,
  deafened,
  sharing,
  cameraOn,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onToggleCamera,
  onLeave
}: {
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  cameraOn: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="voice-controls">
            <button
              className={`voice-control-button ${muted ? "danger" : ""}`}
              type="button"
              onClick={onToggleMute}
              title={muted ? "Unmute microphone" : "Mute microphone"}
            >
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button
              className={`voice-control-button ${deafened ? "danger" : ""}`}
              type="button"
              onClick={onToggleDeafen}
              title={deafened ? "Undeafen" : "Deafen"}
            >
              {deafened ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <button
              className={`voice-control-button ${sharing ? "active" : ""}`}
              type="button"
              onClick={onToggleScreenShare}
              title={sharing ? "Stop sharing screen" : "Share screen"}
            >
              {sharing ? <MonitorX size={16} /> : <MonitorUp size={16} />}
            </button>
            <button
              className={`voice-control-button ${cameraOn ? "active" : ""}`}
              type="button"
              onClick={onToggleCamera}
              title={cameraOn ? "Turn off camera" : "Turn on camera"}
            >
              {cameraOn ? <Camera size={16} /> : <CameraOff size={16} />}
            </button>
            <button
              className="voice-control-button danger"
              type="button"
              onClick={onLeave}
              title="Disconnect"
            >
              <PhoneOff size={16} />
            </button>
          </div>
  );
}

function VoiceStatusBar({
  status,
  muted,
  deafened,
  sharing,
  cameraOn,
  participants,
  onJoin,
  onLeave,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onToggleCamera,
  diagnosticsCount,
  onOpenDiagnostics
}: {
  status: VoiceStatus;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  cameraOn: boolean;
  participants: VoiceParticipantView[];
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onToggleCamera: () => void;
  diagnosticsCount: number;
  onOpenDiagnostics: () => void;
}) {
  const connected = status === "connected" || status === "reconnecting";
  const active = participants.length > 0;

  if (!connected && !active && status !== "failed") {
    return null;
  }

  return (
    <section className={`voice-status-bar ${connected ? "connected" : ""}`}>
      <div className="voice-status-main">
        <PhoneCall size={16} />
        <div>
          <strong>{voiceStatusLabel(status, active)}</strong>
          <small>General Voice / {active ? `${participants.length} connected` : "ready"}</small>
        </div>
      </div>
      <div className="voice-status-tools">
        {connected ? (
          <>
            <button
              type="button"
              className={`voice-status-button ${muted ? "danger" : ""}`}
              onClick={onToggleMute}
              title={muted ? "Muted" : "Mute"}
            >
              {muted ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <button
              type="button"
              className={`voice-status-button ${deafened ? "danger" : ""}`}
              onClick={onToggleDeafen}
              title={deafened ? "Deafened" : "Deafen"}
            >
              {deafened ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <button
              type="button"
              className={`voice-status-button ${sharing ? "active" : ""}`}
              onClick={onToggleScreenShare}
              title={sharing ? "Stop sharing" : "Share screen"}
            >
              {sharing ? <MonitorX size={15} /> : <MonitorUp size={15} />}
            </button>
            <button
              type="button"
              className={`voice-status-button ${cameraOn ? "active" : ""}`}
              onClick={onToggleCamera}
              title={cameraOn ? "Turn off camera" : "Turn on camera"}
            >
              {cameraOn ? <Camera size={15} /> : <CameraOff size={15} />}
            </button>
            <button type="button" className="voice-status-button danger" onClick={onLeave} title="Disconnect">
              <PhoneOff size={15} />
            </button>
            <button
              type="button"
              className="voice-status-button"
              onClick={onOpenDiagnostics}
              title={`Voice diagnostics (${diagnosticsCount})`}
            >
              <ClipboardList size={15} />
            </button>
          </>
        ) : (
          <>
            <button type="button" className="voice-status-join" onClick={onJoin}>
              Join Voice
            </button>
            <button type="button" className="voice-status-debug" onClick={onOpenDiagnostics}>
              <ClipboardList size={14} />
              Logs
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function VoiceDiagnosticsModal({
  entries,
  onClose,
  onClear
}: {
  entries: VoiceDiagnosticEntry[];
  onClose: () => void;
  onClear: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => formatVoiceDiagnostics(entries), [entries]);

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(text || "No voice diagnostics captured yet.");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <section className="voice-diagnostics-modal">
        <header>
          <div>
            <h2>Voice Diagnostics</h2>
            <p>Copy this log when voice presence, audio, or screen sharing acts weird.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close voice diagnostics">
            <X size={18} />
          </button>
        </header>
        <div className="voice-diagnostics-actions">
          <button className="primary-button" type="button" onClick={copyLogs}>
            <ClipboardList size={16} />
            {copied ? "Copied" : "Copy logs"}
          </button>
          <button className="secondary-button" type="button" onClick={onClear}>
            Clear
          </button>
          <span>{entries.length} entries</span>
        </div>
        <pre>{text || "No voice diagnostics captured yet. Join voice and try the broken action again."}</pre>
      </section>
    </div>
  );
}

function VoiceUserContextMenu({
  state,
  canModerate,
  currentUser,
  onClose,
  onProfile,
  onSetVolume,
  onToggleLocalMute,
  onModerate
}: {
  state: { participant: VoiceParticipantView; x: number; y: number };
  canModerate: boolean;
  currentUser: UserProfile;
  onClose: () => void;
  onProfile: (profile: UserProfile) => void;
  onSetVolume: (userId: string, volume: number) => void;
  onToggleLocalMute: (userId: string) => void;
  onModerate: (payload: VoiceModerationRequest) => void;
}) {
  const participant = state.participant;
  const canModerateParticipant =
    canModerate && !participant.isLocal && canModerateVoiceParticipant(currentUser, participant.profile);
  const [localVolume, setLocalVolume] = useState(() => normalizeVoiceVolume(participant.volume));

  useEffect(() => {
    setLocalVolume(normalizeVoiceVolume(participant.volume));
  }, [participant.userId, participant.volume]);

  return (
    <div
      className="voice-context-menu"
      style={{ left: state.x, top: state.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {participant.profile ? (
        <button type="button" onClick={() => onProfile(participant.profile!)}>
          <User size={16} />
          View Profile
        </button>
      ) : null}
      <label className="voice-volume-control">
        <span>User Volume</span>
        <input
          type="range"
          min="0"
          max="100"
          value={localVolume}
          onChange={(event) => {
            const nextVolume = normalizeVoiceVolume(event.target.value);
            setLocalVolume(nextVolume);
            onSetVolume(participant.userId, nextVolume);
          }}
        />
        <small>{participant.locallyMuted ? `Muted locally (${localVolume}%)` : `${localVolume}%`}</small>
      </label>
      <button
        type="button"
        onClick={() => {
          onToggleLocalMute(participant.userId);
          onClose();
        }}
      >
        {participant.locallyMuted ? <Volume2 size={16} /> : <VolumeX size={16} />}
        {participant.locallyMuted ? "Unmute Locally" : "Mute Locally"}
      </button>
      {canModerateParticipant ? (
        <>
          <hr />
          <button
            type="button"
            onClick={() => {
              onModerate({
                targetUserId: participant.userId,
                serverMuted: !participant.isServerMuted
              });
              onClose();
            }}
          >
            <MicOff size={16} />
            {participant.isServerMuted ? "Remove Server Mute" : "Server Mute"}
          </button>
          <button
            type="button"
            onClick={() => {
              onModerate({
                targetUserId: participant.userId,
                serverDeafened: !participant.isServerDeafened
              });
              onClose();
            }}
          >
            <VolumeX size={16} />
            {participant.isServerDeafened ? "Remove Server Deafen" : "Server Deafen"}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              onModerate({ targetUserId: participant.userId, disconnect: true });
              onClose();
            }}
          >
            <PhoneOff size={16} />
            Disconnect from Voice
          </button>
        </>
      ) : null}
    </div>
  );
}

function StreamHoverPreview({
  stream,
  position,
  onMouseEnter,
  onMouseLeave,
  onWatch
}: {
  stream: ScreenShareView | null;
  position: { x: number; y: number };
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onWatch: () => void;
}) {
  return (
    <div
      className="stream-hover-preview"
      style={{ left: position.x, top: position.y }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="stream-hover-header">
        <span>{stream?.kind === "camera" ? "Camera On" : "Streaming Now"}</span>
        {stream?.kind === "camera" ? (
          <em className="camera-live-badge">
            <Camera size={12} />
          </em>
        ) : (
          <em>LIVE</em>
        )}
      </div>
      <div className="stream-preview-frame">
        {stream?.track && stream.status === "live" ? (
          <TrackVideo track={stream.track} muted />
        ) : (
          <span>{stream?.status === "unavailable" ? "Stream unavailable" : "Starting stream..."}</span>
        )}
      </div>
      <button type="button" onClick={onWatch}>
        {stream?.kind === "camera" ? <Camera size={16} /> : <MonitorUp size={16} />}
        {stream?.kind === "camera" ? "Watch Camera" : "Watch Stream"}
      </button>
    </div>
  );
}

function VoicePreviewStage({
  participants,
  screenShares,
  status,
  muted,
  deafened,
  sharing,
  cameraOn,
  onJoin,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onToggleCamera,
  onWatchStream
}: {
  participants: VoiceParticipantView[];
  screenShares: ScreenShareView[];
  status: VoiceStatus;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  cameraOn: boolean;
  onJoin: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onToggleCamera: () => void;
  onWatchStream: (streamId: string) => void;
}) {
  const connected = status === "connected";
  const connecting = status === "connecting";

  return (
    <section className="voice-preview-stage">
      <div className="voice-preview-grid">
        {participants.length > 0 ? (
          participants.map((participant) => {
            const stream = getPreferredVideoStream(screenShares, participant.userId);
            const hasVideo = participant.isScreenSharing || participant.isCameraOn || Boolean(stream);

            return (
              <article className={`voice-preview-card ${hasVideo ? "streaming" : ""}`} key={participant.userId}>
                <div className="voice-preview-frame">
                  {stream?.track && stream.status === "live" ? (
                    <TrackVideo track={stream.track} muted />
                  ) : hasVideo ? (
                    <div className="voice-preview-stream-placeholder">
                      {participant.isCameraOn && !participant.isScreenSharing ? <Camera size={30} /> : <MonitorUp size={30} />}
                      <span>{stream?.status === "unavailable" ? "Video unavailable" : "Starting video..."}</span>
                    </div>
                  ) : participant.profile ? (
                    <Avatar profile={participant.profile} size="xl" />
                  ) : (
                    <span className="voice-preview-fallback">{participant.name.slice(0, 2).toUpperCase()}</span>
                  )}
                  {hasVideo ? (
                    <button
                      type="button"
                      className="watch-stream-button"
                      onClick={() => (stream ? onWatchStream(stream.id) : onJoin())}
                    >
                      {stream?.kind === "camera" ? <Camera size={16} /> : <MonitorUp size={16} />}
                      {stream ? `Watch ${stream.kind === "camera" ? "Camera" : "Stream"}` : "Join to Watch"}
                    </button>
                  ) : null}
                </div>
                <footer>
                  <span>{participant.isLocal ? `${participant.name} (you)` : participant.name}</span>
                  {participant.isCameraOn ? (
                    <em className="camera-live-badge">
                      <Camera size={12} />
                    </em>
                  ) : null}
                  {participant.isScreenSharing ? <em>LIVE</em> : null}
                  {participant.isServerMuted ? (
                    <MicOff className="server-muted-icon" size={15} />
                  ) : participant.isMuted ? (
                    <MicOff size={15} />
                  ) : null}
                  {participant.isDeafened ? <VolumeX size={15} /> : null}
                </footer>
              </article>
            );
          })
        ) : (
          <div className="voice-preview-empty">
            <Volume2 size={36} />
            <h2>No one is in General Voice</h2>
            <p>Join the channel to start a call.</p>
          </div>
        )}
      </div>
      <div className="voice-preview-controls">
        {connected ? (
          <>
            <button type="button" className={muted ? "active" : ""} onClick={onToggleMute}>
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
              <span>{muted ? "Unmute" : "Mute"}</span>
            </button>
            <button type="button" className={deafened ? "active" : ""} onClick={onToggleDeafen}>
              {deafened ? <VolumeX size={18} /> : <Volume2 size={18} />}
              <span>{deafened ? "Undeafen" : "Deafen"}</span>
            </button>
            <button type="button" className={sharing ? "active" : ""} onClick={onToggleScreenShare}>
              {sharing ? <MonitorX size={18} /> : <MonitorUp size={18} />}
              <span>{sharing ? "Stop Sharing" : "Share Screen"}</span>
            </button>
            <button type="button" className={cameraOn ? "active" : ""} onClick={onToggleCamera}>
              {cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}
              <span>{cameraOn ? "Stop Video" : "Video"}</span>
            </button>
          </>
        ) : (
          <button type="button" className="join-call-button" onClick={onJoin} disabled={connecting}>
            {connecting ? <Loader2 className="spin" size={18} /> : <PhoneCall size={18} />}
            <span>{connecting ? "Connecting" : "Join Voice"}</span>
          </button>
        )}
      </div>
    </section>
  );
}

function ScreenShareStage({
  stream,
  allStreams,
  participants,
  voiceStatus,
  muted,
  deafened,
  sharing,
  cameraOn,
  onSelectStream,
  onExit,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onToggleCamera,
  onDisconnect
}: {
  stream: ScreenShareView;
  allStreams: ScreenShareView[];
  participants: VoiceParticipantView[];
  voiceStatus: VoiceStatus;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  cameraOn: boolean;
  onSelectStream: (streamId: string) => void;
  onExit: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onToggleCamera: () => void;
  onDisconnect: () => void;
}) {
  useEffect(() => {
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onExit();
      }
    };

    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [onExit]);

  const liveStreams = allStreams.filter((candidate) => candidate.status === "live");
  const streamWatchers = participants.filter(
    (participant) => participant.viewingStreamId === stream.id && participant.profile
  );
  const streamNoun = stream.kind === "camera" ? "camera" : "stream";

  return (
    <section className="screen-share-stage">
      <header className="stream-stage-header">
        <div>
          <strong>{stream.name}</strong>
          <span>Watching {stream.isLocal ? `your ${streamNoun}` : `${stream.name}'s ${streamNoun}`}</span>
        </div>
        <div className="stream-stage-actions">
          <button type="button" onClick={onToggleMute} title={muted ? "Muted" : "Mute self"}>
            {muted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <button type="button" onClick={onToggleDeafen} title={deafened ? "Deafened" : "Deafen"}>
            {deafened ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button type="button" onClick={onDisconnect} title="Disconnect">
            <PhoneOff size={16} />
          </button>
          <button type="button" onClick={onExit} title="Back to chat">
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="stream-stage-body">
        <StreamWatchers watchers={streamWatchers} />
        {stream.track && stream.status === "live" ? (
          <TrackVideo track={stream.track} />
        ) : (
          <div className="stream-ended-state">
            {stream.kind === "camera" ? <CameraOff size={34} /> : <MonitorX size={34} />}
            <h2>{stream.status === "unavailable" ? "Video unavailable" : "Starting video..."}</h2>
            <p>
              {stream.status === "unavailable"
                ? "The video is having trouble loading."
                : "GCChat is waiting for LiveKit to publish the video track."}
            </p>
            <button className="secondary-button" type="button" onClick={onExit}>
              Back to chat
            </button>
          </div>
        )}
      </div>
      <footer className="stream-stage-footer discord-stream-footer">
        <div className="stream-call-strip">
          {liveStreams.map((participantStream) => (
            <button
              className={`stream-call-tile ${participantStream.id === stream.id ? "active" : ""}`}
              key={participantStream.id}
              type="button"
              onClick={() => onSelectStream(participantStream.id)}
            >
              <div>
                {participantStream.track ? (
                  <TrackVideo track={participantStream.track} muted />
                ) : participantStream.profile ? (
                  <Avatar profile={participantStream.profile} size="lg" />
                ) : (
                  <span className="voice-preview-fallback">{participantStream.name.slice(0, 2).toUpperCase()}</span>
                )}
                {participantStream.kind === "camera" ? (
                  <em className="camera-live-badge">
                    <Camera size={12} />
                  </em>
                ) : (
                  <em>LIVE</em>
                )}
              </div>
              <span>
                {participantStream.isLocal ? "You" : participantStream.name}
                {participantStream.kind === "camera" ? " camera" : " stream"}
              </span>
            </button>
          ))}
        </div>
        <div className="stream-control-dock">
          <button type="button" onClick={onExit}>
            <MonitorX size={18} />
            <span>Stop Watching</span>
          </button>
          <button type="button" className={muted ? "active" : ""} onClick={onToggleMute}>
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
            <span>{muted ? "Unmute" : "Mute"}</span>
          </button>
          <button type="button" className={sharing ? "active" : ""} onClick={onToggleScreenShare}>
            {sharing ? <MonitorX size={18} /> : <MonitorUp size={18} />}
            <span>{sharing ? "Stop Sharing" : "Share Screen"}</span>
          </button>
          <button type="button" className={cameraOn ? "active" : ""} onClick={onToggleCamera}>
            {cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}
            <span>{cameraOn ? "Stop Video" : "Video"}</span>
          </button>
          <button type="button" className={deafened ? "active" : ""} onClick={onToggleDeafen}>
            {deafened ? <VolumeX size={18} /> : <Volume2 size={18} />}
            <span>{deafened ? "Undeafen" : "Deafen"}</span>
          </button>
          <button type="button" className="danger" onClick={onDisconnect}>
            <PhoneOff size={18} />
            <span>Disconnect</span>
          </button>
        </div>
        <span className={voiceStatus === "reconnecting" ? "reconnecting" : ""}>
          {voiceStatus === "reconnecting" ? "Reconnecting..." : "Voice connected"}
        </span>
      </footer>
    </section>
  );
}

function StreamWatchers({ watchers }: { watchers: VoiceParticipantView[] }) {
  if (watchers.length === 0) {
    return null;
  }

  return (
    <div className="stream-watchers" title={`${watchers.length} watching`}>
      <span>Watching</span>
      <div>
        {watchers.slice(0, 5).map((watcher) =>
          watcher.profile ? <Avatar key={watcher.userId} profile={watcher.profile} size="xs" /> : null
        )}
        {watchers.length > 5 ? <em>+{watchers.length - 5}</em> : null}
      </div>
    </div>
  );
}

function TrackVideo({
  track,
  muted = false
}: {
  track: LocalTrack | RemoteTrack;
  muted?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    track.attach(element);
    element.muted = muted;
    element.play().catch(() => undefined);

    return () => {
      track.detach(element);
    };
  }, [muted, track]);

  return <video ref={ref} autoPlay playsInline muted={muted} />;
}

function ScreenSourcePicker({
  sources,
  onSelect,
  onCancel
}: {
  sources: ScreenSourcePreview[];
  onSelect: (source: ScreenSourcePreview) => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop screen-source-backdrop">
      <section className="screen-source-modal">
        <header>
          <div>
            <h2>Share Your Screen</h2>
            <p>Choose a screen or window to share in General Voice.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cancel">
            <X size={18} />
          </button>
        </header>
        <div className="screen-source-grid">
          {sources.map((source) => (
            <button type="button" key={source.id} onClick={() => onSelect(source)}>
              <img src={source.thumbnail} alt="" />
              <span>{source.name}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function MessageList({
  messages,
  hasMore,
  loadingOlder,
  members,
  calendarEvents,
  calendarEventsStatus,
  customEmojis,
  currentUser,
  onProfile,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onEventUpdated,
  onOpenCalendarEvent,
  onLoadOlder,
  onError
}: {
  messages: MessageView[];
  hasMore: boolean;
  loadingOlder: boolean;
  members: ServerMemberView[];
  calendarEvents: CalendarEventView[];
  calendarEventsStatus: CalendarEventsStatus;
  customEmojis: CustomEmojiView[];
  currentUser: UserProfile;
  onProfile: (profile: UserProfile) => void;
  onReply: (message: MessageView) => void;
  onEdit: (message: MessageView) => void;
  onDelete: (message: MessageView) => void;
  onReact: (message: MessageView, emoji: string) => void;
  onEventUpdated: (event: CalendarEventView) => void;
  onOpenCalendarEvent: (eventId: string) => void;
  onLoadOlder: () => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const listRef = useRef<HTMLElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLElement>());
  const loadingOlderRef = useRef(false);
  const previousMessageEdgeRef = useRef<{ count: number; lastId: string | null }>({ count: 0, lastId: null });
  const [contextMenu, setContextMenu] = useState<{
    message: MessageView;
    x: number;
    y: number;
    mode: "actions" | "reactions";
  } | null>(null);
  const [expandedImage, setExpandedImage] = useState<MessageView["attachments"][number] | null>(null);

  useEffect(() => {
    const previous = previousMessageEdgeRef.current;
    const lastId = messages[messages.length - 1]?.id ?? null;
    const list = listRef.current;
    const nearBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 160;

    if (messages.length > 0 && (previous.count === 0 || (previous.lastId !== lastId && nearBottom))) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }

    previousMessageEdgeRef.current = { count: messages.length, lastId };
  }, [messages]);

  const loadOlder = async () => {
    const list = listRef.current;

    if (!list || !hasMore || loadingOlder || loadingOlderRef.current) {
      return;
    }

    loadingOlderRef.current = true;
    const previousHeight = list.scrollHeight;
    const previousTop = list.scrollTop;

    try {
      await onLoadOlder();
      window.requestAnimationFrame(() => {
        const currentList = listRef.current;

        if (currentList) {
          currentList.scrollTop = currentList.scrollHeight - previousHeight + previousTop;
        }
      });
    } finally {
      loadingOlderRef.current = false;
    }
  };

  const handleScroll = () => {
    const list = listRef.current;

    if (!list || list.scrollTop > 120) {
      return;
    }

    void loadOlder();
  };

  const scrollToMessage = (messageId: string) => {
    const element = messageRefs.current.get(messageId);

    if (!element) {
      return;
    }

    element.scrollIntoView({ block: "center", behavior: "smooth" });
    element.classList.add("message-flash");
    window.setTimeout(() => element.classList.remove("message-flash"), 1400);
  };

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  if (messages.length === 0) {
    return (
      <section className="message-list empty" ref={listRef}>
        <div className="empty-state">
          <Hash size={34} />
          <h2>general</h2>
        </div>
      </section>
    );
  }

  return (
    <section className="message-list" ref={listRef} onScroll={handleScroll}>
      {hasMore || loadingOlder ? (
        <div className="message-history-loader">
          {loadingOlder ? <Loader2 className="spin" size={16} /> : null}
          <span>{loadingOlder ? "Loading older messages..." : "Scroll up to load older messages"}</span>
        </div>
      ) : null}
      {messages.map((message, index) => {
        const previous = messages[index - 1] ?? null;
        const compact = shouldCompactMessage(previous, message);

        return (
          <article
            className={`message-row ${compact ? "compact" : ""} ${message.id.startsWith("temp-") ? "pending" : ""} ${
              messageShouldNotifyUser(message, currentUser) ? "mentioned" : ""
            }`}
            key={message.id}
            ref={(node) => {
              if (node) {
                messageRefs.current.set(message.id, node);
              } else {
                messageRefs.current.delete(message.id);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (message.id.startsWith("temp-")) {
                return;
              }

              setContextMenu({
                message,
                x: event.clientX,
                y: event.clientY,
                mode: "actions"
              });
            }}
          >
            {compact ? (
              <time className="compact-time">{formatTime(message.createdAt)}</time>
            ) : (
              <button className="avatar-button" onClick={() => onProfile(message.author)}>
                <Avatar profile={message.author} size="md" />
              </button>
            )}
            <div className="message-body">
              {!compact ? (
                <div className="message-meta">
                  <button onClick={() => onProfile(message.author)}>{message.author.displayName}</button>
                  <time>{formatTime(message.createdAt)}</time>
                  {message.editedAt ? <span className="edited-mark">(edited)</span> : null}
                </div>
              ) : message.editedAt ? (
                <span className="edited-mark compact-edited">(edited)</span>
              ) : null}
              {message.replyTo ? (
                <button className="message-reply-preview" onClick={() => scrollToMessage(message.replyTo!.id)}>
                  <Reply size={14} />
                  <span>{message.replyTo.author.displayName}</span>
                  <small>{summarizeReply(message.replyTo)}</small>
                </button>
              ) : null}
            {renderMessageText(stripEventTokens(message.content), members, customEmojis, onProfile)}
            {extractEventIds(message.content).map((eventId) => {
              const event = calendarEvents.find((candidate) => candidate.id === eventId);

              return event ? (
                <MessageEventEmbed
                  event={event}
                  key={eventId}
                  onUpdated={onEventUpdated}
                  onOpenCalendarEvent={onOpenCalendarEvent}
                  onProfile={onProfile}
                  onError={onError}
                />
              ) : (
                <MessageEventPlaceholder key={eventId} status={calendarEventsStatus} />
              );
            })}
            {extractYouTubeUrls(stripEventTokens(message.content)).map((url) => (
              <YouTubeEmbed key={url} url={url} />
            ))}
            {message.attachments.length > 0 ? (
              <div className="attachments">
                {message.attachments.map((attachment) =>
                  attachment.mimeType.startsWith("image/") ? (
                    <button
                      className="attachment image-attachment"
                      key={attachment.id}
                      type="button"
                      onClick={() => setExpandedImage(attachment)}
                      aria-label={`Open ${attachment.fileName}`}
                    >
                      <img src={attachment.url} alt={attachment.fileName} />
                    </button>
                  ) : isAudioAttachment(attachment) ? (
                    <AudioAttachment attachment={attachment} key={attachment.id} />
                  ) : (
                    <a
                      className="attachment"
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      key={attachment.id}
                    >
                      <span>{attachment.fileName}</span>
                    </a>
                  )
                )}
              </div>
            ) : null}
            {message.reactions.length > 0 ? (
              <div className="message-reactions">
                {message.reactions.map((reaction) => {
                  const reacted = reaction.users.some((user) => user.id === currentUser.id);

                  return (
                    <button
                      className={reacted ? "active" : ""}
                      key={reaction.emoji}
                      type="button"
                      onClick={() => onReact(message, reaction.emoji)}
                      title={reaction.users.map((user) => user.displayName).join(", ")}
                    >
                      <ReactionEmoji emoji={reaction.emoji} customEmojis={customEmojis} />
                      <span>{reaction.count}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </article>
        );
      })}
      <div ref={bottomRef} />
      {contextMenu ? (
        <MessageContextMenu
          state={contextMenu}
          customEmojis={customEmojis}
          currentUser={currentUser}
          onClose={() => setContextMenu(null)}
          onReply={(message) => {
            onReply(message);
            setContextMenu(null);
          }}
          onEdit={(message) => {
            onEdit(message);
            setContextMenu(null);
          }}
          onDelete={(message) => {
            onDelete(message);
            setContextMenu(null);
          }}
          onReact={(message, emoji) => {
            onReact(message, emoji);
            setContextMenu(null);
          }}
          onReactionMode={() =>
            setContextMenu((current) => (current ? { ...current, mode: "reactions" } : current))
          }
        />
      ) : null}
      {expandedImage ? (
        <ImageLightbox
          attachment={expandedImage}
          onClose={() => setExpandedImage(null)}
          onError={(message) => onError(message)}
        />
      ) : null}
    </section>
  );
}

function AudioAttachment({ attachment }: { attachment: MessageView["attachments"][number] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const togglePlayback = async () => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      await audio.play().catch(() => undefined);
      setPlaying(!audio.paused);
      return;
    }

    audio.pause();
    setPlaying(false);
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    const nextTime = Number.isFinite(value) ? value : 0;

    setCurrentTime(nextTime);

    if (audio) {
      audio.currentTime = nextTime;
    }
  };

  const changeVolume = (value: number) => {
    const nextVolume = Math.min(Math.max(value, 0), 1);

    setVolume(nextVolume);

    if (audioRef.current) {
      audioRef.current.volume = nextVolume;
    }
  };

  return (
    <div className="attachment audio-attachment">
      <audio
        ref={audioRef}
        src={attachment.url}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
      />
      <button
        className="audio-download-button"
        type="button"
        onClick={() => void downloadAttachment(attachment)}
        title="Download"
        aria-label={`Download ${attachment.fileName}`}
      >
        <Download size={18} />
      </button>
      <div className="audio-meta">
        <span className="audio-file-icon">
          <FileAudio size={20} />
        </span>
        <div>
          <strong>{attachment.fileName}</strong>
          <span>{formatFileSize(attachment.size)}</span>
        </div>
      </div>
      <div className="audio-controls">
        <button type="button" onClick={() => void togglePlayback()} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={22} /> : <Play size={24} />}
        </button>
        <input
          className="audio-progress"
          type="range"
          min="0"
          max={Math.max(duration, 0.01)}
          step="0.01"
          value={Math.min(currentTime, Math.max(duration, 0.01))}
          onChange={(event) => seek(Number(event.currentTarget.value))}
          aria-label="Audio progress"
        />
        <span className="audio-time">
          {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
        </span>
        <Volume2 size={20} />
        <input
          className="audio-volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(event) => changeVolume(Number(event.currentTarget.value))}
          aria-label="Audio volume"
        />
      </div>
    </div>
  );
}

function YouTubeEmbed({ url }: { url: string }) {
  const [embed, setEmbed] = useState<YouTubeEmbedView | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let active = true;

    setStatus("loading");
    setPlaying(false);

    api
      .getYouTubeEmbed(url)
      .then((nextEmbed) => {
        if (!active) {
          return;
        }

        setEmbed(nextEmbed);
        setStatus("ready");
      })
      .catch(() => {
        if (active) {
          setStatus("error");
        }
      });

    return () => {
      active = false;
    };
  }, [url]);

  if (status === "error") {
    return (
      <a className="youtube-embed youtube-embed-fallback" href={url} target="_blank" rel="noreferrer">
        <span>YouTube</span>
        <strong>{url}</strong>
      </a>
    );
  }

  if (!embed || status === "loading") {
    return (
      <div className="youtube-embed youtube-embed-loading">
        <Loader2 className="spin" size={16} />
        <span>Loading YouTube preview...</span>
      </div>
    );
  }

  const iframeUrl = `${embed.embedUrl}?autoplay=1&rel=0`;

  return (
    <div className="youtube-embed">
      <div className="youtube-provider">{embed.providerName}</div>
      {embed.authorName ? <div className="youtube-author">{embed.authorName}</div> : null}
      <a className="youtube-title" href={embed.url} target="_blank" rel="noreferrer">
        {embed.title}
      </a>
      <div className="youtube-media">
        {playing ? (
          <iframe
            src={iframeUrl}
            title={embed.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} aria-label={`Play ${embed.title}`}>
            <img src={embed.thumbnailUrl} alt="" />
            <span className="youtube-play-overlay">
              <Play size={30} fill="currentColor" />
            </span>
          </button>
        )}
      </div>
      <button
        className="youtube-open-button"
        type="button"
        onClick={() => window.open(embed.url, "_blank", "noopener,noreferrer")}
        title="Open in Browser"
        aria-label="Open YouTube video in browser"
      >
        <ExternalLink size={16} />
      </button>
    </div>
  );
}

function ImageLightbox({
  attachment,
  onClose,
  onError
}: {
  attachment: MessageView["attachments"][number];
  onClose: () => void;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(attachment.url);
    } catch {
      onError("Could not copy image link");
    }
  };

  const downloadImage = async () => {
    try {
      const response = await fetch(attachment.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName || "image";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch {
      window.open(attachment.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={attachment.fileName}>
      <button className="image-lightbox-backdrop" type="button" onClick={onClose} aria-label="Close image preview" />
      <div className="image-lightbox-toolbar">
        <button
          className="image-tool-button"
          type="button"
          onClick={() => void copyLink()}
          title="Copy Image Link"
          data-tooltip="Copy Image Link"
        >
          <Copy size={20} />
        </button>
        <button
          className="image-tool-button"
          type="button"
          onClick={() => void downloadImage()}
          title="Save Image"
          data-tooltip="Save Image"
        >
          <Download size={20} />
        </button>
        <button
          className="image-tool-button"
          type="button"
          onClick={() => window.open(attachment.url, "_blank", "noopener,noreferrer")}
          title="Open in Browser"
          data-tooltip="Open in Browser"
        >
          <ExternalLink size={20} />
        </button>
        <button
          className="image-tool-button close"
          type="button"
          onClick={onClose}
          title="Close"
          data-tooltip="Close"
        >
          <X size={22} />
        </button>
      </div>
      <div className="image-lightbox-content">
        <img src={attachment.url} alt={attachment.fileName} />
      </div>
    </div>
  );
}

function MessageContextMenu({
  state,
  customEmojis,
  currentUser,
  onClose,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onReactionMode
}: {
  state: { message: MessageView; x: number; y: number; mode: "actions" | "reactions" };
  customEmojis: CustomEmojiView[];
  currentUser: UserProfile;
  onClose: () => void;
  onReply: (message: MessageView) => void;
  onEdit: (message: MessageView) => void;
  onDelete: (message: MessageView) => void;
  onReact: (message: MessageView, emoji: string) => void;
  onReactionMode: () => void;
}) {
  const quickEmojis = defaultEmojis.slice(0, 12);
  const canEdit = state.message.author.id === currentUser.id;
  const canDelete = canEdit || currentUser.role === "SUPER_ADMIN";

  return (
    <div
      className="message-context-menu"
      style={{ left: state.x, top: state.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {state.mode === "actions" ? (
        <>
          <button type="button" onClick={() => onReply(state.message)}>
            <Reply size={18} />
            Reply
          </button>
          {canEdit ? (
            <button type="button" onClick={() => onEdit(state.message)}>
              <Edit3 size={18} />
              Edit Message
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" className="danger" onClick={() => onDelete(state.message)}>
              <Trash2 size={18} />
              Delete Message
            </button>
          ) : null}
          <button type="button" onClick={onReactionMode}>
            <SmilePlus size={18} />
            Add Reaction
          </button>
        </>
      ) : (
        <div className="reaction-menu">
          <header>
            <button type="button" onClick={onClose}>
              <ChevronLeft size={17} />
            </button>
            <span>Add Reaction</span>
          </header>
          <div className="reaction-choice-grid">
            {quickEmojis.map((emoji) => (
              <button
                type="button"
                key={emoji.name}
                onClick={() => onReact(state.message, emoji.emoji)}
                title={emoji.name}
              >
                {emoji.emoji}
              </button>
            ))}
            {customEmojis.map((emoji) => (
              <button
                type="button"
                key={emoji.id}
                onClick={() => onReact(state.message, `:${emoji.name}:`)}
                title={`:${emoji.name}:`}
              >
                <img src={emoji.imageUrl} alt="" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReactionEmoji({
  emoji,
  customEmojis
}: {
  emoji: string;
  customEmojis: CustomEmojiView[];
}) {
  if (emoji.startsWith(":") && emoji.endsWith(":")) {
    const name = emoji.slice(1, -1).toLowerCase();
    const customEmoji = customEmojis.find((candidate) => candidate.name === name);

    if (customEmoji) {
      return <img src={customEmoji.imageUrl} alt={emoji} />;
    }
  }

  return <span>{emoji}</span>;
}

function MessageEventEmbed({
  event,
  onUpdated,
  onOpenCalendarEvent,
  onProfile,
  onError
}: {
  event: CalendarEventView;
  onUpdated: (event: CalendarEventView) => void;
  onOpenCalendarEvent: (eventId: string) => void;
  onProfile: (profile: UserProfile) => void;
  onError: (error: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  const follow = async () => {
    setBusy(true);
    onError(null);

    try {
      const updated = await api.setCalendarEventOptIn(event.id, { optedIn: true });
      onUpdated(updated);
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="message-event-embed">
      <div className="event-time">
        <CalendarDays size={15} />
        <time>{formatEventDate(event.startAt)}</time>
      </div>
      <h3>{event.title}</h3>
      {event.description ? <p>{event.description}</p> : null}
      <AttendeePreview event={event} onProfile={onProfile} />
      <div className="message-event-actions">
        <button className="event-opt-button" onClick={follow} disabled={busy || event.viewerOptedIn}>
          {busy ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
          {event.viewerOptedIn ? "Following" : "Follow"}
        </button>
        <button className="secondary-button compact" onClick={() => onOpenCalendarEvent(event.id)}>
          Open
        </button>
      </div>
    </article>
  );
}

function MessageEventPlaceholder({ status }: { status: CalendarEventsStatus }) {
  const loading = status === "idle" || status === "loading";

  return (
    <article className="message-event-embed unresolved">
      <div className="event-time">
        {loading ? <Loader2 className="spin" size={16} /> : <CalendarDays size={16} />}
        <time>{loading ? "Loading event details..." : "Event details unavailable"}</time>
      </div>
      <h3>{loading ? "Loading linked event" : "Linked event not loaded"}</h3>
      <p>
        {loading
          ? "The message is here. GCChat is still syncing the calendar."
          : "GCChat could not load this calendar event yet. It may come back after the next sync."}
      </p>
    </article>
  );
}

function Composer({
  channel,
  currentUser,
  members,
  calendarEvents,
  customEmojis,
  replyTo,
  editingMessage,
  socket,
  onCancelReply,
  onCancelEdit,
  onError,
  onOptimisticMessage,
  onConfirmedMessage,
  onFailedMessage,
  onEdited
}: {
  channel: ChannelSummary;
  currentUser: UserProfile;
  members: ServerMemberView[];
  calendarEvents: CalendarEventView[];
  customEmojis: CustomEmojiView[];
  replyTo: MessageView | null;
  editingMessage: MessageView | null;
  socket: ChatSocket | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onError: (error: string | null) => void;
  onOptimisticMessage: (message: MessageView) => void;
  onConfirmedMessage: (temporaryId: string, message: MessageView) => void;
  onFailedMessage: (temporaryId: string, channelId: string) => void;
  onEdited: (message: MessageView) => void;
}) {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [attachedEvent, setAttachedEvent] = useState<CalendarEventView | null>(null);
  const [sending, setSending] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const mentionQuery = getMentionQuery(draft);
  const mentionSuggestions = useMemo(
    () =>
      mentionQuery === null
        ? []
        : members
            .filter((member) => !member.bannedAt)
            .filter((member) => {
              const query = mentionQuery.toLowerCase();
              return (
                member.username.toLowerCase().startsWith(query) ||
                member.displayName.toLowerCase().startsWith(query)
              );
            })
            .slice(0, 8),
    [members, mentionQuery]
  );
  const canSend = draft.trim().length > 0 || (!editingMessage && (files.length > 0 || attachedEvent));
  const filteredDefaultEmojis = useMemo(
    () =>
      defaultEmojis.filter(
        (emoji) =>
          !emojiSearch.trim() || emoji.name.toLowerCase().includes(emojiSearch.trim().toLowerCase())
      ),
    [emojiSearch]
  );
  const filteredCustomEmojis = useMemo(
    () =>
      customEmojis.filter(
        (emoji) =>
          !emojiSearch.trim() || emoji.name.toLowerCase().includes(emojiSearch.trim().toLowerCase())
      ),
    [customEmojis, emojiSearch]
  );

  useEffect(() => {
    if (!editingMessage) {
      return;
    }

    setDraft(stripEventTokens(editingMessage.content));
    setFiles([]);
    setAttachedEvent(null);
    setAttachmentMenuOpen(false);
    setEventPickerOpen(false);
    setEmojiPickerOpen(false);
    onCancelReply();

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [editingMessage?.id]);

  const addFiles = (incomingFiles: Iterable<File> | null) => {
    if (editingMessage || !incomingFiles) {
      return;
    }

    const nextIncoming = Array.from(incomingFiles).filter((incomingFile) => incomingFile.size > 0);

    if (nextIncoming.length === 0) {
      return;
    }

    setFiles((current) => {
      const availableSlots = maxMessageAttachments - current.length;

      if (availableSlots <= 0) {
        onError(`You can attach up to ${maxMessageAttachments} files.`);
        return current;
      }

      if (nextIncoming.length > availableSlots) {
        onError(`Added ${availableSlots} file${availableSlots === 1 ? "" : "s"}; messages can include up to ${maxMessageAttachments} attachments.`);
      } else {
        onError(null);
      }

      return [...current, ...nextIncoming.slice(0, availableSlots)];
    });
    setAttachmentMenuOpen(false);
    setEventPickerOpen(false);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    if (editingMessage) {
      return;
    }

    const pastedFiles = getFilesFromDataTransfer(event.clipboardData).map(normalizeClipboardFile);

    if (pastedFiles.length === 0) {
      return;
    }

    event.preventDefault();
    addFiles(pastedFiles);
  };

  const handleDragEnter = (event: React.DragEvent<HTMLFormElement>) => {
    if (editingMessage || !hasTransferFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLFormElement>) => {
    if (editingMessage || !hasTransferFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: React.DragEvent<HTMLFormElement>) => {
    if (editingMessage || !hasTransferFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) {
      setDraggingFiles(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLFormElement>) => {
    if (editingMessage || !hasTransferFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    addFiles(getFilesFromDataTransfer(event.dataTransfer));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!canSend) {
      return;
    }

    onError(null);

    if (editingMessage) {
      try {
        const updated = await api.updateMessage(editingMessage.id, { content: draft.trim() });
        onEdited(updated);
        setDraft("");
      } catch (requestError) {
        onError(getMessage(requestError));
      }
      return;
    }

    const temporaryId = `temp-${crypto.randomUUID()}`;
    const selectedFiles = files;
    const selectedEvent = attachedEvent;
    const selectedReply = replyTo;
    const content = `${draft.trim()}${selectedEvent ? `\n${createEventToken(selectedEvent.id)}` : ""}`.trim();
    const localAttachmentUrls = selectedFiles.map((selectedFile) => URL.createObjectURL(selectedFile));
    const optimisticAttachments: MessageView["attachments"] = selectedFiles.map((selectedFile, index) => ({
      id: `${temporaryId}-attachment-${index}`,
      url: localAttachmentUrls[index]!,
      fileName: selectedFile.name,
      mimeType: selectedFile.type || "application/octet-stream",
      size: selectedFile.size
    }));
    const optimisticMessage: MessageView = {
      id: temporaryId,
      channelId: channel.id,
      content,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      author: currentUser,
      attachments: optimisticAttachments,
      replyTo: selectedReply ? createReplyPreview(selectedReply) : null,
      reactions: []
    };

    onOptimisticMessage(optimisticMessage);
    setDraft("");
    setFiles([]);
    setAttachedEvent(null);
    setAttachmentMenuOpen(false);
    setEventPickerOpen(false);
    setEmojiPickerOpen(false);
    setEmojiSearch("");
    onCancelReply();

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    try {
      setSending(selectedFiles.length > 0);
      const attachments: CreateMessageRequest["attachments"] = [];

      for (const selectedFile of selectedFiles) {
        const uploaded = await api.upload(selectedFile, "attachment");
        attachments.push({
          url: uploaded.url,
          fileName: uploaded.fileName,
          mimeType: uploaded.mimeType,
          size: uploaded.size
        });
      }

      const payload = {
        channelId: channel.id,
        content,
        replyToId: selectedReply?.id ?? null,
        attachments
      };

      let confirmed: MessageView;
      if (socket?.connected) {
        confirmed = await emitMessage(socket, payload);
      } else {
        confirmed = await api.createMessage(channel.id, {
          content: payload.content,
          replyToId: payload.replyToId,
          attachments
        });
      }

      onConfirmedMessage(temporaryId, confirmed);
    } catch (requestError) {
      onFailedMessage(temporaryId, channel.id);
      onError(getMessage(requestError));
    } finally {
      for (const localAttachmentUrl of localAttachmentUrls) {
        URL.revokeObjectURL(localAttachmentUrl);
      }

      setSending(false);
    }
  };

  const applyMention = (member: ServerMemberView) => {
    setDraft((current) => replaceMentionQuery(current, member.username));
  };

  const applyUnicodeEmoji = (emoji: DefaultEmoji) => {
    setDraft((current) => `${current}${current.endsWith(" ") || current.length === 0 ? "" : " "}${emoji.emoji} `);
    setEmojiPickerOpen(false);
  };

  const applyCustomEmoji = (emoji: CustomEmojiView) => {
    setDraft((current) => `${current}${current.endsWith(" ") || current.length === 0 ? "" : " "}:${emoji.name}: `);
    setEmojiPickerOpen(false);
  };

  return (
    <form
      className={`composer ${draggingFiles ? "dragging-files" : ""}`}
      onSubmit={submit}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          addFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      {draggingFiles && !editingMessage ? (
        <div className="composer-drop-overlay">
          <Upload size={22} />
          <span>Drop files to upload</span>
        </div>
      ) : null}
      {mentionSuggestions.length > 0 ? (
        <div className="mention-menu">
          <div className="mention-menu-title">Members</div>
          {mentionSuggestions.map((member) => (
            <button type="button" key={member.id} onClick={() => applyMention(member)}>
              <Avatar profile={member} size="xs" status={member.isOnline ? "online" : "offline"} />
              <span>{member.displayName}</span>
              <small>@{member.username}</small>
            </button>
          ))}
        </div>
      ) : null}
      {attachmentMenuOpen ? (
        <div className="attachment-menu">
          <button
            type="button"
            onClick={() => {
              fileInputRef.current?.click();
              setAttachmentMenuOpen(false);
            }}
          >
            <FileUp size={17} />
            Upload a file
          </button>
          <button
            type="button"
            onClick={() => {
              setEventPickerOpen((current) => !current);
            }}
          >
            <Link size={17} />
            Link event
          </button>
        </div>
      ) : null}
      {eventPickerOpen ? (
        <div className="event-picker-menu">
          <div className="mention-menu-title">Link Event</div>
          {calendarEvents.length === 0 ? (
            <p>No events yet.</p>
          ) : (
            calendarEvents
              .slice()
              .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
              .map((event) => (
                <button
                  type="button"
                  key={event.id}
                  onClick={() => {
                    setAttachedEvent(event);
                    setEventPickerOpen(false);
                    setAttachmentMenuOpen(false);
                  }}
                >
                  <strong>{event.title}</strong>
                  <small>{formatEventDate(event.startAt)}</small>
                </button>
              ))
          )}
        </div>
      ) : null}
      {emojiPickerOpen ? (
        <EmojiPickerMenu
          search={emojiSearch}
          defaultEmojis={filteredDefaultEmojis}
          customEmojis={filteredCustomEmojis}
          onSearchChange={setEmojiSearch}
          onUnicodeSelect={applyUnicodeEmoji}
          onCustomSelect={applyCustomEmoji}
        />
      ) : null}
      {editingMessage ? (
        <div className="composer-reply-preview edit-preview">
          <Edit3 size={15} />
          <span>Editing message</span>
          <small>Press Enter to save</small>
          <button
            type="button"
            onClick={() => {
              onCancelEdit();
              setDraft("");
            }}
            aria-label="Cancel edit"
          >
            <X size={15} />
          </button>
        </div>
      ) : replyTo ? (
        <div className="composer-reply-preview">
          <Reply size={15} />
          <span>
            Replying to <strong>{replyTo.author.displayName}</strong>
          </span>
          <small>{summarizeReply(createReplyPreview(replyTo))}</small>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply">
            <X size={15} />
          </button>
        </div>
      ) : null}
      <div className="composer-bar">
        <button
          type="button"
          className="composer-tool attach-button"
          disabled={Boolean(editingMessage)}
          onClick={() => {
            if (editingMessage) {
              return;
            }
            setAttachmentMenuOpen((current) => !current);
            setEmojiPickerOpen(false);
          }}
          aria-label="Add attachment"
          title="Add attachment"
        >
          <Paperclip size={22} />
        </button>
        <div className="composer-input">
          {files.map((attachedFile, index) => (
            <button
              type="button"
              className="file-chip"
              key={`${attachedFile.name}-${attachedFile.lastModified}-${index}`}
              onClick={() => setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))}
              title={attachedFile.name}
            >
              {attachedFile.name}
              <X size={14} />
            </button>
          ))}
          {attachedEvent ? (
            <button type="button" className="file-chip event-chip" onClick={() => setAttachedEvent(null)}>
              <CalendarDays size={14} />
              {attachedEvent.title}
              <X size={14} />
            </button>
          ) : null}
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={handlePaste}
            placeholder={editingMessage ? "Edit message" : `Message #${channel.name}`}
          />
        </div>
        <button
          type="button"
          className="composer-tool emoji-trigger"
          onClick={() => {
            setEmojiPickerOpen((current) => !current);
            setAttachmentMenuOpen(false);
            setEventPickerOpen(false);
          }}
          aria-label="Add emoji"
          title="Add emoji"
        >
          <Smile size={22} />
        </button>
        <button className="composer-send" disabled={!canSend} aria-label="Send">
          {sending ? <Loader2 className="spin" size={20} /> : <Send size={20} />}
        </button>
      </div>
    </form>
  );
}

function EmojiPickerMenu({
  search,
  defaultEmojis,
  customEmojis,
  onSearchChange,
  onUnicodeSelect,
  onCustomSelect
}: {
  search: string;
  defaultEmojis: DefaultEmoji[];
  customEmojis: CustomEmojiView[];
  onSearchChange: (value: string) => void;
  onUnicodeSelect: (emoji: DefaultEmoji) => void;
  onCustomSelect: (emoji: CustomEmojiView) => void;
}) {
  return (
    <div className="emoji-picker-menu">
      <div className="emoji-picker-tabs">
        <button type="button" className="active">Emoji</button>
      </div>
      <label className="emoji-search">
        <Search size={18} />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search emoji"
        />
      </label>
      {customEmojis.length > 0 ? (
        <section className="emoji-section">
          <h4>GCChat</h4>
          <div className="emoji-grid">
            {customEmojis.map((emoji) => (
              <button type="button" key={emoji.id} onClick={() => onCustomSelect(emoji)} title={`:${emoji.name}:`}>
                <img src={emoji.imageUrl} alt="" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section className="emoji-section">
        <h4>Default</h4>
        <div className="emoji-grid">
          {defaultEmojis.map((emoji) => (
            <button type="button" key={emoji.name} onClick={() => onUnicodeSelect(emoji)} title={emoji.name}>
              <span>{emoji.emoji}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function EmojiStudio({
  emojis,
  onChanged,
  onError,
  error,
  onDismissError
}: {
  emojis: CustomEmojiView[];
  onChanged: (emojis: CustomEmojiView[]) => void;
  onError: (error: string | null) => void;
  error: string | null;
  onDismissError: () => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<CustomEmojiView | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!name.trim() || !file || busy) {
      return;
    }

    setBusy(true);
    onError(null);

    try {
      const uploaded = await api.upload(file, "emoji");
      const emoji = await api.createCustomEmoji({
        name,
        imageUrl: uploaded.url
      });
      onChanged(upsertCustomEmoji(emojis, emoji));
      setName("");
      setFile(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="emoji-studio-panel">
      <header className="chat-header">
        <div className="chat-title">
          <SmilePlus size={22} />
          <span>Emoji Studio</span>
        </div>
      </header>

      {error ? (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={onDismissError} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      ) : null}

      <div className="emoji-studio-content">
        <form className="emoji-create-card" onSubmit={submit}>
          <div>
            <h2>Create Emoji</h2>
            <p>Upload a small image or GIF and give it a short name like <code>:foodrun:</code>.</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button type="button" className="emoji-upload-box" onClick={() => fileInputRef.current?.click()}>
            {file ? (
              <span>{file.name}</span>
            ) : (
              <>
                <ImageUp size={24} />
                Upload image
              </>
            )}
          </button>
          <label>
            Emoji name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="foodrun" />
          </label>
          <button className="primary-button" disabled={!name.trim() || !file || busy}>
            {busy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
            Add Emoji
          </button>
        </form>

        <section className="emoji-library-card">
          <header>
            <div>
              <h2>Emoji Library</h2>
              <p>{emojis.length} custom emoji{emojis.length === 1 ? "" : "s"}</p>
            </div>
          </header>
          {emojis.length === 0 ? (
            <div className="emoji-empty-state">
              <Smile size={26} />
              <p>No custom emojis yet.</p>
            </div>
          ) : (
            <div className="emoji-admin-grid">
              {emojis.map((emoji) => (
                <button key={emoji.id} onClick={() => setEditing(emoji)}>
                  <img src={emoji.imageUrl} alt="" />
                  <strong>:{emoji.name}:</strong>
                  <small>by {emoji.createdBy.displayName}</small>
                  <small>{emoji.useCount} uses</small>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {editing ? (
        <EmojiEditModal
          emoji={editing}
          currentEmojis={emojis}
          onClose={() => setEditing(null)}
          onChanged={(next) => {
            onChanged(next);
            setEditing(null);
          }}
          onError={onError}
        />
      ) : null}
    </main>
  );
}

function EmojiEditModal({
  emoji,
  currentEmojis,
  onClose,
  onChanged,
  onError
}: {
  emoji: CustomEmojiView;
  currentEmojis: CustomEmojiView[];
  onClose: () => void;
  onChanged: (emojis: CustomEmojiView[]) => void;
  onError: (error: string | null) => void;
}) {
  const [name, setName] = useState(emoji.name);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("save");
    onError(null);

    try {
      const uploaded = file ? await api.upload(file, "emoji") : null;
      const updated = await api.updateCustomEmoji(emoji.id, {
        name,
        imageUrl: uploaded?.url
      });
      onChanged(upsertCustomEmoji(currentEmojis, updated));
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setBusy(null);
    }
  };

  const deleteEmoji = async () => {
    const confirmed = window.confirm(`Delete :${emoji.name}:? Messages that already used it will show the text token.`);

    if (!confirmed) {
      return;
    }

    setBusy("delete");
    onError(null);

    try {
      onChanged(await api.deleteCustomEmoji(emoji.id));
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop">
      <form className="emoji-edit-modal" onSubmit={save}>
        <header>
          <div>
            <h2>Edit Emoji</h2>
            <p>:{emoji.name}:</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="emoji-edit-preview">
          <img src={emoji.imageUrl} alt="" />
          <div>
            <strong>{emoji.useCount} uses</strong>
            <span>Created by {emoji.createdBy.displayName}</span>
            <small>{formatDate(emoji.createdAt)}</small>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <label>
          Emoji name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>
          <ImageUp size={16} />
          {file ? file.name : "Change image"}
        </button>
        <footer>
          <button type="button" className="secondary-button danger" onClick={deleteEmoji} disabled={busy !== null}>
            {busy === "delete" ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
            Delete
          </button>
          <div>
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" disabled={!name.trim() || busy !== null}>
              {busy === "save" ? <Loader2 className="spin" size={16} /> : <Pencil size={16} />}
              Save
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function CalendarView({
  events,
  eventsStatus,
  currentUser,
  focusEventId,
  onFocusHandled,
  onCreated,
  onUpdated,
  onDeleted,
  onProfile,
  onError,
  error,
  onDismissError
}: {
  events: CalendarEventView[];
  eventsStatus: CalendarEventsStatus;
  currentUser: UserProfile;
  focusEventId: string | null;
  onFocusHandled: () => void;
  onCreated: (event: CalendarEventView) => void;
  onUpdated: (event: CalendarEventView) => void;
  onDeleted: (eventId: string) => void;
  onProfile: (profile: UserProfile) => void;
  onError: (error: string | null) => void;
  error: string | null;
  onDismissError: () => void;
}) {
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const [time, setTime] = useState("18:00");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const calendarDays = useMemo(
    () => buildCalendarDays(visibleMonth, events),
    [events, visibleMonth]
  );
  const selectedDayEvents = useMemo(
    () =>
      events
        .filter((event) => toDateInputValue(new Date(event.startAt)) === selectedDate)
        .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    [events, selectedDate]
  );
  const selectedEvent =
    selectedDayEvents.find((event) => event.id === selectedEventId) ??
    (selectedDayEvents.length === 1 ? selectedDayEvents[0] : null);

  useEffect(() => {
    if (selectedEventId && !selectedDayEvents.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(null);
    }
  }, [selectedDayEvents, selectedEventId]);

  useEffect(() => {
    if (!focusEventId) {
      return;
    }

    const event = events.find((candidate) => candidate.id === focusEventId);

    if (!event) {
      return;
    }

    const date = new Date(event.startAt);
    setVisibleMonth(startOfMonth(date));
    setSelectedDate(toDateInputValue(date));
    setSelectedEventId(event.id);
    onFocusHandled();
  }, [events, focusEventId, onFocusHandled]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!title.trim() || saving) {
      return;
    }

    setSaving(true);
    onError(null);

    try {
      const created = await api.createCalendarEvent({
        title,
        description,
        startAt: combineDateAndTime(selectedDate, time).toISOString()
      });

      onCreated(created);
      setSelectedEventId(created.id);
      setTitle("");
      setDescription("");
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const toggleOptIn = async (event: CalendarEventView) => {
    setBusyEventId(event.id);
    onError(null);

    try {
      const updated = await api.setCalendarEventOptIn(event.id, {
        optedIn: !event.viewerOptedIn
      });
      onUpdated(updated);
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setBusyEventId(null);
    }
  };

  const deleteEvent = async (event: CalendarEventView) => {
    const confirmed = window.confirm(`Delete "${event.title}" from the calendar?`);

    if (!confirmed) {
      return;
    }

    setBusyEventId(event.id);
    onError(null);

    try {
      const deleted = await api.deleteCalendarEvent(event.id);
      onDeleted(deleted.id);
      setSelectedEventId(null);
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setBusyEventId(null);
    }
  };

  return (
    <main className="calendar-panel">
      <header className="chat-header">
        <div className="chat-title">
          <CalendarDays size={22} />
          <span>GC calendar</span>
        </div>
      </header>

      {error ? (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={onDismissError} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      ) : null}

      {eventsStatus === "loading" ? (
        <div className="calendar-sync-banner">
          <Loader2 className="spin" size={16} />
          <span>Syncing calendar events...</span>
        </div>
      ) : eventsStatus === "error" ? (
        <div className="calendar-sync-banner warning">
          <CalendarDays size={16} />
          <span>Calendar events are still reconnecting.</span>
        </div>
      ) : null}

      <section className="calendar-content">
        <div className="calendar-board">
          <div className="calendar-toolbar">
            <button
              className="icon-button"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft size={18} />
            </button>
            <h2>{formatMonth(visibleMonth)}</h2>
            <button
              className="icon-button"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}
              aria-label="Next month"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="calendar-weekdays">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="calendar-grid">
            {calendarDays.map((day) => (
              <button
                className={[
                  "calendar-day",
                  day.currentMonth ? "" : "outside",
                  day.dateValue === selectedDate ? "selected" : "",
                  day.events.length > 0 ? "has-events" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={day.dateValue}
                onClick={() => {
                  setSelectedDate(day.dateValue);
                  setSelectedEventId(null);

                  if (!day.currentMonth) {
                    setVisibleMonth(startOfMonth(day.date));
                  }
                }}
              >
                <span className="day-number">{day.date.getDate()}</span>
                <span className="day-events">
                  {day.events.slice(0, 2).map((event) => (
                    <span key={event.id}>{event.title}</span>
                  ))}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="calendar-column">
          <form className="calendar-form" onSubmit={submit}>
            <h3>Create Event</h3>
            <label>
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Food run, birthday, movie night"
                maxLength={90}
              />
            </label>
            <div className="calendar-form-row">
              <label>
                Date
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                />
              </label>
              <label>
                Time
                <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              </label>
            </div>
            <label>
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Details, location, who's driving, anything useful"
                maxLength={800}
              />
            </label>
            <button className="primary-button" disabled={saving || !title.trim()}>
              {saving ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
              Add Event
            </button>
          </form>

          <div className="calendar-events">
            {selectedEvent ? (
              <>
                {selectedDayEvents.length > 1 ? (
                  <button className="text-button calendar-back-button" onClick={() => setSelectedEventId(null)}>
                    Back to {selectedDayEvents.length} events
                  </button>
                ) : null}
                <CalendarEventCard
                  event={selectedEvent}
                  busy={busyEventId === selectedEvent.id}
                  canDelete={canDeleteCalendarEvent(selectedEvent, currentUser)}
                  onProfile={onProfile}
                  onToggleOptIn={() => toggleOptIn(selectedEvent)}
                  onDelete={() => deleteEvent(selectedEvent)}
                />
              </>
            ) : selectedDayEvents.length > 1 ? (
              <div className="calendar-day-event-list">
                <h3>{formatDateLabel(selectedDate)} Events</h3>
                {selectedDayEvents.map((event) => (
                  <button
                    className="calendar-day-event-row"
                    key={event.id}
                    onClick={() => setSelectedEventId(event.id)}
                  >
                    <span>{event.title}</span>
                    <time>{formatTime(event.startAt)}</time>
                  </button>
                ))}
              </div>
            ) : selectedDayEvents.length === 0 ? (
              <div className="empty-calendar">
                <CalendarDays size={30} />
                <h3>No events on this date</h3>
              </div>
            ) : (
              null
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function CalendarEventCard({
  event,
  busy,
  canDelete,
  onProfile,
  onToggleOptIn,
  onDelete
}: {
  event: CalendarEventView;
  busy: boolean;
  canDelete: boolean;
  onProfile: (profile: UserProfile) => void;
  onToggleOptIn: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="calendar-event-card">
      <div className="event-time">
        <Clock size={16} />
        <time>{formatEventDate(event.startAt)}</time>
      </div>
      <h3>{event.title}</h3>
      {event.description ? <p>{event.description}</p> : null}
      <button className="event-creator" onClick={() => onProfile(event.creator)}>
        <Avatar profile={event.creator} size="sm" />
        <span>Created by {event.creator.displayName}</span>
      </button>
      <div className="event-footer">
        <div className="event-going">
          <Users size={16} />
          <span>{event.optIns.length} going</span>
        </div>
        <button
          className={`event-opt-button ${event.viewerOptedIn ? "active" : ""}`}
          onClick={onToggleOptIn}
          disabled={busy}
        >
          {busy ? <Loader2 className="spin" size={15} /> : event.viewerOptedIn ? <Check size={15} /> : <Plus size={15} />}
          {event.viewerOptedIn ? "Going" : "Join"}
        </button>
        {canDelete ? (
          <button className="event-delete-button" onClick={onDelete} disabled={busy}>
            <Trash2 size={15} />
            Delete
          </button>
        ) : null}
      </div>
      {event.optIns.length > 0 ? (
        <div className="event-attendees">
          {event.optIns.slice(0, 6).map((optIn) => (
            <button key={optIn.user.id} onClick={() => onProfile(optIn.user)} title={optIn.user.displayName}>
              <Avatar profile={optIn.user} size="sm" />
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function CalendarSidePanel({
  events,
  onProfile,
  onOpenEvent
}: {
  events: CalendarEventView[];
  onProfile: (profile: UserProfile) => void;
  onOpenEvent: (eventId: string) => void;
}) {
  const soon = events
    .slice()
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .slice(0, 6);

  return (
    <aside className="members-panel calendar-agenda-panel">
      <div className="members-title">Upcoming</div>
      {soon.length === 0 ? (
        <p className="agenda-empty">No events yet.</p>
      ) : (
        soon.map((event) => (
          <div className="agenda-row" key={event.id}>
            <button className="agenda-main" type="button" onClick={() => onOpenEvent(event.id)}>
              <strong>{event.title}</strong>
              <span>{formatShortEventDate(event.startAt)}</span>
            </button>
            <AttendeePreview event={event} onProfile={onProfile} />
          </div>
        ))
      )}
    </aside>
  );
}

function AttendeePreview({
  event,
  onProfile
}: {
  event: CalendarEventView;
  onProfile: (profile: UserProfile) => void;
}) {
  if (event.optIns.length === 0) {
    return null;
  }

  const visible = event.optIns.slice(0, 3);
  const overflow = event.optIns.length - visible.length;

  return (
    <div className="attendee-preview">
      {visible.map((optIn) => (
        <button key={optIn.user.id} onClick={() => onProfile(optIn.user)} title={optIn.user.displayName}>
          <Avatar profile={optIn.user} size="xs" />
        </button>
      ))}
      {overflow > 0 ? <span>+{overflow}</span> : null}
    </div>
  );
}

function AuditLogPanel({
  entries,
  onRestore,
  error,
  onDismissError
}: {
  entries: AuditLogView[];
  onRestore: (entry: AuditLogView) => void;
  onError: (error: string | null) => void;
  error: string | null;
  onDismissError: () => void;
}) {
  return (
    <main className="audit-panel">
      <header className="chat-header">
        <div className="chat-title">
          <ClipboardList size={22} />
          <span>Audit Log</span>
        </div>
      </header>

      {error ? (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={onDismissError} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      ) : null}

      <section className="audit-content">
        {entries.length === 0 ? (
          <div className="empty-calendar">
            <ClipboardList size={30} />
            <h3>No audit entries yet</h3>
          </div>
        ) : (
          entries.map((entry) => {
            const detail = describeAuditEntry(entry);

            return (
              <article className="audit-card" key={entry.id}>
                <header>
                  <div>
                    <span className="audit-action">{detail.title}</span>
                    <time>{formatDateTime(entry.createdAt)}</time>
                  </div>
                  {entry.restorable ? (
                    <button className="secondary-button compact" onClick={() => onRestore(entry)}>
                      <RotateCcw size={15} />
                      Restore
                    </button>
                  ) : null}
                </header>
                <p>{detail.summary}</p>
                {detail.before || detail.after ? (
                  <div className="audit-diff">
                    {detail.before ? (
                      <div>
                        <strong>Before</strong>
                        <pre>{detail.before}</pre>
                      </div>
                    ) : null}
                    {detail.after ? (
                      <div>
                        <strong>After</strong>
                        <pre>{detail.after}</pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}

function MembersPanel({
  members,
  onProfile
}: {
  members: ServerMemberView[];
  onProfile: (profile: UserProfile) => void;
}) {
  const onlineMembers = members.filter((member) => member.isOnline && !member.bannedAt);
  const offlineMembers = members.filter((member) => !member.isOnline || member.bannedAt);
  const groups = [
    { title: "Online", members: onlineMembers },
    { title: "Offline", members: offlineMembers }
  ];

  return (
    <aside className="members-panel">
      {groups.map((group) =>
        group.members.length > 0 ? (
          <section className="member-group" key={group.title}>
            <div className="members-title">
              {group.title} - {group.members.length}
            </div>
            {group.members.map((member) => (
              <button
                className={`member-row ${member.bannedAt ? "banned" : ""}`}
                key={member.id}
                onClick={() => onProfile(member)}
              >
                <Avatar
                  profile={member}
                  size="sm"
                  status={member.isOnline && !member.bannedAt ? "online" : "offline"}
                  muted={Boolean(member.bannedAt || !member.isOnline)}
                />
                <span className="member-name">{member.displayName}</span>
                {member.bannedAt ? <em>Banned</em> : null}
                {member.role === "SUPER_ADMIN" ? (
                  <ShieldCheck size={14} />
                ) : member.role === "ADMIN" ? (
                  <Shield size={14} />
                ) : null}
              </button>
            ))}
          </section>
        ) : null
      )}
    </aside>
  );
}

function SettingsPage({
  user,
  notificationPrefs,
  appearancePrefs,
  onClose,
  onSaved,
  onNotificationPrefsChange,
  onAppearancePrefsChange,
  onError
}: {
  user: UserProfile;
  notificationPrefs: NotificationPreferences;
  appearancePrefs: AppearancePreferences;
  onClose: () => void;
  onSaved: (profile: UserProfile) => void;
  onNotificationPrefsChange: (preferences: NotificationPreferences) => void;
  onAppearancePrefsChange: (preferences: AppearancePreferences) => void;
  onError: (error: string) => void;
}) {
  const [tab, setTab] = useState<"account" | "notifications" | "appearance">("account");
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [username, setUsername] = useState(user.username);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const previewProfile = useMemo<UserProfile>(
    () => ({
      ...user,
      displayName: displayName || user.username,
      bio,
      avatarUrl: avatarFile ? URL.createObjectURL(avatarFile) : avatarUrl
    }),
    [avatarFile, avatarUrl, bio, displayName, user]
  );

  useEffect(() => {
    return () => {
      if (previewProfile.avatarUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewProfile.avatarUrl);
      }
    };
  }, [previewProfile.avatarUrl]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);

    try {
      let nextAvatarUrl = avatarUrl;

      if (avatarFile) {
        const normalizedAvatar = await normalizeAvatarFile(avatarFile);
        const uploaded = await api.upload(normalizedAvatar, "avatar");
        nextAvatarUrl = uploaded.url;
      }

      const profile = await api.updateProfile({
        displayName,
        bio,
        avatarUrl: nextAvatarUrl
      });

      const accountChanged =
        username.trim().toLowerCase() !== user.username || newPassword.trim().length > 0;
      const updatedProfile = accountChanged
        ? await api.updateAccount({
            username: username.trim(),
            currentPassword: currentPassword || undefined,
            newPassword: newPassword || undefined
          })
        : profile;

      onSaved({ ...profile, ...updatedProfile });
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-page">
      <aside className="settings-nav">
        <h2>Settings</h2>
        <button className={tab === "account" ? "active" : ""} onClick={() => setTab("account")}>
          <User size={17} />
          My Account
        </button>
        <button className={tab === "notifications" ? "active" : ""} onClick={() => setTab("notifications")}>
          <Bell size={17} />
          Notifications
        </button>
        <button className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}>
          <Palette size={17} />
          Appearance
        </button>
      </aside>

      <main className="settings-main">
        <button className="settings-close" onClick={onClose} aria-label="Close settings">
          <X size={24} />
        </button>

        {tab === "account" ? (
          <form className="settings-section" onSubmit={save}>
            <h1>My Account</h1>
            <div className="settings-grid">
              <div className="settings-avatar">
                <Avatar profile={previewProfile} size="xl" />
                <input
                  ref={avatarInputRef}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)}
                />
                <button type="button" className="secondary-button" onClick={() => avatarInputRef.current?.click()}>
                  <Upload size={16} />
                  Upload
                </button>
                <button
                  type="button"
                  className="text-button subtle"
                  onClick={() => {
                    setAvatarFile(null);
                    setAvatarUrl(null);
                  }}
                >
                  Remove
                </button>
              </div>

              <div className="settings-fields">
                <label>
                  Nickname
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                </label>
                <label>
                  Username
                  <input value={username} onChange={(event) => setUsername(event.target.value)} />
                </label>
                <label>
                  About me
                  <textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={190} />
                </label>
              </div>
            </div>

            <div className="settings-card">
              <h3>
                <KeyRound size={17} />
                Change Password
              </h3>
              <label>
                Current password
                <input
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                />
              </label>
              <label>
                New password
                <input
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  placeholder="8+ characters"
                />
              </label>
            </div>

            <footer className="settings-footer">
              <button type="button" className="secondary-button" onClick={onClose}>
                Cancel
              </button>
              <button className="primary-button" disabled={saving}>
                {saving ? <Loader2 className="spin" size={17} /> : null}
                Save
              </button>
            </footer>
          </form>
        ) : null}

        {tab === "notifications" ? (
          <section className="settings-section">
            <h1>Notifications</h1>
            <SettingsToggle
              title="Mention popups"
              description="Show a bottom-right popup when someone pings you."
              checked={notificationPrefs.mentionToasts}
              onChange={(checked) => onNotificationPrefsChange({ ...notificationPrefs, mentionToasts: checked })}
            />
            <SettingsToggle
              title="Mention sound"
              description="Play an invasive ping sound when someone mentions you."
              checked={notificationPrefs.mentionSound}
              onChange={(checked) => onNotificationPrefsChange({ ...notificationPrefs, mentionSound: checked })}
            />
            <SettingsToggle
              title="System notifications"
              description="Ask the operating system to show a notification for mentions."
              checked={notificationPrefs.desktopNotifications}
              onChange={(checked) => onNotificationPrefsChange({ ...notificationPrefs, desktopNotifications: checked })}
            />
            <div className="settings-card">
              <h3>
                <Volume2 size={17} />
                Sound
              </h3>
              <label>
                Notification sound
                <select
                  value={notificationPrefs.sound}
                  onChange={(event) =>
                    onNotificationPrefsChange({
                      ...notificationPrefs,
                      sound: event.target.value as NotificationSound
                    })
                  }
                >
                  <option value="ping">Ping</option>
                  <option value="chime">Chime</option>
                  <option value="alert">Alert</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label>
                Volume
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={notificationPrefs.volume}
                  onChange={(event) =>
                    onNotificationPrefsChange({
                      ...notificationPrefs,
                      volume: Number(event.target.value)
                    })
                  }
                />
              </label>
              <button
                className="secondary-button"
                onClick={() => playMentionSound(notificationPrefs)}
                disabled={notificationPrefs.sound === "none"}
              >
                Test Sound
              </button>
            </div>
          </section>
        ) : null}

        {tab === "appearance" ? (
          <section className="settings-section">
            <h1>Appearance</h1>
            <div className="theme-grid">
              {(["dark", "light", "midnight", "forest", "berry"] as ThemeName[]).map((theme) => (
                <button
                  className={`theme-tile theme-preview-${theme} ${appearancePrefs.theme === theme ? "active" : ""}`}
                  key={theme}
                  onClick={() => onAppearancePrefsChange({ theme })}
                >
                  <span />
                  {themeLabel(theme)}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function SettingsToggle({
  title,
  description,
  checked,
  onChange
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-toggle">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function ToastStack({
  toasts,
  onDismiss
}: {
  toasts: Array<{ id: string; message: MessageView }>;
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <article className="mention-toast" key={toast.id}>
          <Avatar profile={toast.message.author} size="sm" />
          <div>
            <strong>{toast.message.author.displayName} mentioned you</strong>
            <p>{stripEventTokens(toast.message.content)}</p>
          </div>
          <button onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
            <X size={14} />
          </button>
        </article>
      ))}
    </div>
  );
}

function DeleteChannelModal({
  channel,
  onClose,
  onDeleted,
  onError
}: {
  channel: ChannelSummary;
  onClose: () => void;
  onDeleted: (channels: ChannelSummary[]) => void;
  onError: (error: string | null) => void;
}) {
  const [confirmationName, setConfirmationName] = useState("");
  const [busy, setBusy] = useState(false);
  const canDelete = confirmationName === channel.name;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!canDelete || busy) {
      return;
    }

    setBusy(true);
    onError(null);

    try {
      const channels = await api.deleteChannel(channel.id, { confirmationName });
      onDeleted(channels);
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <form className="confirm-modal" onSubmit={submit}>
        <header>
          <h2>Delete #{channel.name}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>
        <p>Type <strong>{channel.name}</strong> to confirm.</p>
        <input
          autoFocus
          value={confirmationName}
          onChange={(event) => setConfirmationName(event.target.value)}
          placeholder={channel.name}
        />
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="secondary-button danger" disabled={!canDelete || busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
            Delete
          </button>
        </footer>
      </form>
    </div>
  );
}

function ProfileCard({
  profile,
  viewer,
  onClose,
  onManaged,
  onBanned,
  onError
}: {
  profile: UserProfile;
  viewer: UserProfile;
  onClose: () => void;
  onManaged: (profile: UserProfile) => void;
  onBanned: () => void;
  onError: (error: string | null) => void;
}) {
  const [busyAction, setBusyAction] = useState<"role" | "ban" | null>(null);
  const canManage =
    viewer.role === "SUPER_ADMIN" && viewer.id !== profile.id && profile.role !== "SUPER_ADMIN";

  const updateRole = async () => {
    setBusyAction("role");
    onError(null);

    try {
      const updated = await api.updateUserRole(profile.id, {
        role: profile.role === "ADMIN" ? "USER" : "ADMIN"
      });
      onManaged(updated);
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setBusyAction(null);
    }
  };

  const updateBan = async () => {
    setBusyAction("ban");
    onError(null);

    try {
      const updated = await api.updateUserBan(profile.id, {
        banned: !profile.bannedAt
      });
      onManaged(updated);

      if (updated.id === viewer.id && updated.bannedAt) {
        onBanned();
      }
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="profile-layer" onMouseDown={onClose}>
      <article className="profile-card" onMouseDown={(event) => event.stopPropagation()}>
        <button className="profile-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <div className="profile-banner" />
        <div className="profile-content">
          <Avatar profile={profile} size="lg" muted={Boolean(profile.bannedAt)} />
          <div className="profile-heading">
            <h2>{profile.displayName}</h2>
            {profile.bannedAt ? <span className="banned-badge">Banned</span> : null}
            {profile.role === "SUPER_ADMIN" ? (
              <span className="role-badge super">
                <ShieldCheck size={13} />
                Super Admin
              </span>
            ) : profile.role === "ADMIN" ? (
              <span className="role-badge">
                <Shield size={13} />
                Admin
              </span>
            ) : null}
          </div>
          <div className="profile-username">
            <AtSign size={14} />
            {profile.username}
          </div>
          <section>
            <h3>Member Since</h3>
            <p>{formatDate(profile.createdAt)}</p>
          </section>
          <section>
            <h3>About Me</h3>
            <p>{profile.bio || "No bio yet."}</p>
          </section>
          {canManage ? (
            <section className="profile-actions">
              <h3>Moderation</h3>
              <button className="secondary-button" onClick={updateRole} disabled={busyAction !== null}>
                {busyAction === "role" ? <Loader2 className="spin" size={15} /> : <Shield size={15} />}
                {profile.role === "ADMIN" ? "Remove Admin" : "Give Admin"}
              </button>
              <button
                className={`secondary-button danger ${profile.bannedAt ? "safe" : ""}`}
                onClick={updateBan}
                disabled={busyAction !== null}
              >
                {busyAction === "ban" ? <Loader2 className="spin" size={15} /> : <Ban size={15} />}
                {profile.bannedAt ? "Unban User" : "Ban User"}
              </button>
            </section>
          ) : null}
        </div>
      </article>
    </div>
  );
}

function Avatar({
  profile,
  size,
  status,
  muted = false
}: {
  profile: UserProfile;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  status?: "online" | "offline";
  muted?: boolean;
}) {
  const initials = (profile.displayName || profile.username).slice(0, 2).toUpperCase();

  return (
    <span className={`avatar avatar-${size} ${muted ? "avatar-muted" : ""}`}>
      {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <span>{initials}</span>}
      {status ? <i className={`presence-dot ${status}`} /> : null}
    </span>
  );
}

async function normalizeAvatarFile(file: File) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const size = 512;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      bitmap.close();
      return file;
    }

    const sourceSize = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.max(0, (bitmap.width - sourceSize) / 2);
    const sourceY = Math.max(0, (bitmap.height - sourceSize) / 2);

    canvas.width = size;
    canvas.height = size;
    context.clearRect(0, 0, size, size);
    context.drawImage(bitmap, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
    bitmap.close();

    const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, 0.92));

    if (!blob) {
      return file;
    }

    const extension = outputType === "image/png" ? "png" : "jpg";
    const name = file.name.replace(/\.[^.]+$/, "") || "avatar";

    return new File([blob], `${name}.${extension}`, { type: outputType });
  } catch {
    return file;
  }
}

function applyProfileUpdate(session: Session, profile: UserProfile): Session {
  return {
    ...session,
    user: session.user.id === profile.id ? profile : session.user,
    members: session.members.map((member) =>
      member.id === profile.id ? { ...member, ...profile } : member
    )
  };
}

function upsertMessageInChannel(
  current: Record<string, MessageView[]>,
  message: MessageView
): Record<string, MessageView[]> {
  const normalized = normalizeMessage(message);
  const channelMessages = current[normalized.channelId] ?? [];
  const withoutTempDuplicate = channelMessages.filter(
    (existing) =>
      existing.id !== normalized.id &&
      !(
        existing.id.startsWith("temp-") &&
        existing.author.id === normalized.author.id &&
        existing.content === normalized.content
      )
  );

  return {
    ...current,
    [normalized.channelId]: [...withoutTempDuplicate, normalized].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    )
  };
}

function replaceMessageInChannel(
  current: Record<string, MessageView[]>,
  temporaryId: string,
  message: MessageView
): Record<string, MessageView[]> {
  const normalized = normalizeMessage(message);
  const channelMessages = current[normalized.channelId] ?? [];
  const replaced = channelMessages.some((existing) => existing.id === temporaryId)
    ? channelMessages.map((existing) => (existing.id === temporaryId ? normalized : existing))
    : [...channelMessages, normalized];

  return {
    ...current,
    [normalized.channelId]: replaced
      .filter((existing, index, list) => list.findIndex((candidate) => candidate.id === existing.id) === index)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  };
}

function normalizeMessage(message: MessageView): MessageView {
  return {
    ...message,
    deletedAt: message.deletedAt ?? null,
    replyTo: message.replyTo ?? null,
    reactions: message.reactions ?? []
  };
}

function removeMessageFromChannel(
  current: Record<string, MessageView[]>,
  channelId: string,
  messageId: string
): Record<string, MessageView[]> {
  return {
    ...current,
    [channelId]: (current[channelId] ?? []).filter((message) => message.id !== messageId)
  };
}

function applyReactionOptimistically(
  current: Record<string, MessageView[]>,
  message: MessageView,
  emoji: string,
  user: UserProfile
): Record<string, MessageView[]> {
  const nextMessage: MessageView = {
    ...message,
    reactions: toggleReactionForUser(message.reactions, emoji, user)
  };

  return replaceMessageInChannel(current, message.id, nextMessage);
}

function toggleReactionForUser(
  reactions: MessageView["reactions"],
  emoji: string,
  user: UserProfile
): MessageView["reactions"] {
  const existing = reactions.find((reaction) => reaction.emoji === emoji);

  if (!existing) {
    return [...reactions, { emoji, count: 1, users: [user] }];
  }

  const alreadyReacted = existing.users.some((candidate) => candidate.id === user.id);
  const users = alreadyReacted
    ? existing.users.filter((candidate) => candidate.id !== user.id)
    : [...existing.users, user];

  return reactions
    .map((reaction) =>
      reaction.emoji === emoji
        ? {
            ...reaction,
            count: users.length,
            users
          }
        : reaction
    )
    .filter((reaction) => reaction.count > 0);
}

function applyProfileUpdateToMessages(
  messagesByChannel: Record<string, MessageView[]>,
  profile: UserProfile
): Record<string, MessageView[]> {
  return Object.fromEntries(
    Object.entries(messagesByChannel).map(([channelId, messages]) => [
      channelId,
      messages.map((message) =>
        applyProfileUpdateToMessage(message, profile)
      )
    ])
  );
}

function applyProfileUpdateToMessage(message: MessageView, profile: UserProfile): MessageView {
  return {
    ...message,
    author: message.author.id === profile.id ? profile : message.author,
    replyTo:
      message.replyTo && message.replyTo.author.id === profile.id
        ? { ...message.replyTo, author: profile }
        : message.replyTo,
    reactions: message.reactions.map((reaction) => ({
      ...reaction,
      users: reaction.users.map((user) => (user.id === profile.id ? profile : user))
    }))
  };
}

function applyProfileUpdateToCalendarEvents(
  events: CalendarEventView[],
  profile: UserProfile
): CalendarEventView[] {
  return events.map((event) => ({
    ...event,
    creator: event.creator.id === profile.id ? profile : event.creator,
    optIns: event.optIns.map((optIn) =>
      optIn.user.id === profile.id ? { ...optIn, user: profile } : optIn
    )
  }));
}

function upsertCalendarEvent(
  events: CalendarEventView[],
  event: CalendarEventView
): CalendarEventView[] {
  const next = events.some((existing) => existing.id === event.id)
    ? events.map((existing) => (existing.id === event.id ? event : existing))
    : [...events, event];

  return next.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

function upsertCustomEmoji(
  emojis: CustomEmojiView[],
  emoji: CustomEmojiView
): CustomEmojiView[] {
  const next = emojis.some((existing) => existing.id === emoji.id)
    ? emojis.map((existing) => (existing.id === emoji.id ? emoji : existing))
    : [...emojis, emoji];

  return next.sort((a, b) => a.name.localeCompare(b.name));
}

function emitMessage(socket: ChatSocket, payload: { channelId: string } & CreateMessageRequest) {
  return new Promise<MessageView>((resolve, reject) => {
    socket.emit("message:create", payload, (response) => {
      if (response.ok) {
        resolve(response.message);
      } else {
        reject(new Error(response.error));
      }
    });
  });
}

function renderMessageText(
  content: string,
  members: ServerMemberView[],
  customEmojis: CustomEmojiView[],
  onProfile: (profile: UserProfile) => void
) {
  if (!content.trim()) {
    return null;
  }

  const parts = content.split(/(@[a-zA-Z0-9_.-]+|:[a-zA-Z0-9_]{2,32}:)/g);

  return (
    <p>
      {parts.map((part, index) => {
        if (part.startsWith("@")) {
          const username = part.slice(1).toLowerCase();
          const member = members.find((candidate) => candidate.username.toLowerCase() === username);

          if (!member) {
            return <span key={`${part}-${index}`}>{part}</span>;
          }

          return (
            <button
              className="mention-pill"
              key={`${part}-${index}`}
              type="button"
              onClick={() => onProfile(member)}
            >
              @{member.displayName}
            </button>
          );
        }

        if (part.startsWith(":") && part.endsWith(":")) {
          const emojiName = part.slice(1, -1).toLowerCase();
          const emoji = customEmojis.find((candidate) => candidate.name === emojiName);

          if (emoji) {
            return (
              <img
                className="inline-custom-emoji"
                key={`${part}-${index}`}
                src={emoji.imageUrl}
                alt={`:${emoji.name}:`}
                title={`:${emoji.name}:`}
              />
            );
          }
        }

        return <span key={`${part}-${index}`}>{part}</span>;
      })}
    </p>
  );
}

function summarizeReply(reply: NonNullable<MessageView["replyTo"]>) {
  if (reply.deletedAt) {
    return "Message deleted";
  }

  const text = stripEventTokens(reply.content).trim();

  if (text) {
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
  }

  if (reply.attachments.length > 0) {
    return reply.attachments[0]?.fileName ?? "Attachment";
  }

  return "Message";
}

function createReplyPreview(message: MessageView): NonNullable<MessageView["replyTo"]> {
  return {
    id: message.id,
    content: message.content,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    author: message.author,
    attachments: message.attachments
  };
}

function getMentionQuery(value: string) {
  const match = value.match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/);
  return match?.[1] ?? null;
}

function replaceMentionQuery(value: string, username: string) {
  return value.replace(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/, (match) => {
    const prefix = match.startsWith(" ") ? " " : "";
    return `${prefix}@${username} `;
  });
}

function createEventToken(eventId: string) {
  return `[[gc-event:${eventId}]]`;
}

function extractEventIds(content: string) {
  return [...content.matchAll(eventTokenPattern)]
    .map((match) => match[1])
    .filter((eventId): eventId is string => Boolean(eventId));
}

function stripEventTokens(content: string) {
  return content.replace(eventTokenPattern, "").trim();
}

function extractYouTubeUrls(content: string) {
  youtubeUrlPattern.lastIndex = 0;

  return Array.from(
    new Set(
      [...content.matchAll(youtubeUrlPattern)].map((match) => match[0].replace(/[.,!?;:]+$/, ""))
    )
  );
}

function hasTransferFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes("Files");
}

function getFilesFromDataTransfer(dataTransfer: DataTransfer) {
  const itemFiles = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  if (itemFiles.length > 0) {
    return itemFiles;
  }

  return Array.from(dataTransfer.files ?? []);
}

function normalizeClipboardFile(file: File, index: number) {
  if (file.name) {
    return file;
  }

  const extension = fileExtensionFromMimeType(file.type);
  return new File([file], `pasted-file-${index + 1}${extension}`, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified
  });
}

function fileExtensionFromMimeType(mimeType: string) {
  const extensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/webm": ".webm",
    "application/pdf": ".pdf",
    "text/plain": ".txt"
  };

  return extensions[mimeType] ?? "";
}

function isAudioAttachment(attachment: MessageView["attachments"][number]) {
  return attachment.mimeType.startsWith("audio/");
}

async function downloadAttachment(attachment: MessageView["attachments"][number]) {
  try {
    const response = await fetch(attachment.url);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.fileName || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  } catch {
    window.open(attachment.url, "_blank", "noopener,noreferrer");
  }
}

function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 KB";
  }

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function buildCalendarDays(visibleMonth: Date, events: CalendarEventView[]) {
  const eventsByDate = new Map<string, CalendarEventView[]>();

  for (const event of events) {
    const key = toDateInputValue(new Date(event.startAt));
    eventsByDate.set(key, [...(eventsByDate.get(key) ?? []), event]);
  }

  const monthStart = startOfMonth(visibleMonth);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateValue = toDateInputValue(date);

    return {
      date,
      dateValue,
      currentMonth:
        date.getMonth() === visibleMonth.getMonth() &&
        date.getFullYear() === visibleMonth.getFullYear(),
      events: eventsByDate.get(dateValue) ?? []
    };
  });
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function combineDateAndTime(dateValue: string, timeValue: string) {
  const [year = "1970", month = "01", day = "01"] = dateValue.split("-");
  const [hour = "00", minute = "00"] = timeValue.split(":");

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute)
  );
}

function hasAtLeastRole(role: UserRole, minimum: "ADMIN" | "SUPER_ADMIN") {
  const rank: Record<UserRole, number> = {
    USER: 0,
    ADMIN: 1,
    SUPER_ADMIN: 2
  };

  return rank[role] >= rank[minimum];
}

function canModerateVoiceParticipant(actor: UserProfile, target: UserProfile | null) {
  if (!target || actor.id === target.id) {
    return false;
  }

  if (actor.role === "SUPER_ADMIN") {
    return true;
  }

  return actor.role === "ADMIN" && target.role === "USER";
}

function canDeleteCalendarEvent(event: CalendarEventView, user: UserProfile) {
  return event.creator.id === user.id || hasAtLeastRole(user.role, "ADMIN");
}

function isParticipantAudioMuted(participant: Participant) {
  const publications = Array.from(participant.audioTrackPublications.values());

  if (publications.length === 0) {
    return true;
  }

  return publications.every((publication) => publication.isMuted);
}

function getVideoStreamId(userId: string, kind: ScreenShareView["kind"]) {
  return `${userId}:${kind}`;
}

function getPreferredVideoStream(streams: ScreenShareView[], userId: string) {
  return (
    streams.find((stream) => stream.userId === userId && stream.kind === "screen") ??
    streams.find((stream) => stream.userId === userId && stream.kind === "camera") ??
    null
  );
}

function getParticipantVideoStatus(participant: Participant, source: Track.Source): ScreenShareView["status"] | null {
  const publications = Array.from(participant.videoTrackPublications.values()) as Array<{
    source: Track.Source;
    track?: LocalTrack | RemoteTrack | null;
    isMuted?: boolean;
  }>;
  const publication = publications.find((candidate) => candidate.source === source);

  if (!publication) {
    return null;
  }

  if (publication.isMuted) {
    return "unavailable";
  }

  return publication.track ? "live" : "starting";
}

function getParticipantScreenShareStatus(participant: Participant): ScreenShareView["status"] | null {
  return getParticipantVideoStatus(participant, Track.Source.ScreenShare);
}

function isParticipantScreenSharing(participant: Participant) {
  return getParticipantScreenShareStatus(participant) !== null;
}

function isParticipantCameraOn(participant: Participant) {
  return getParticipantVideoStatus(participant, Track.Source.Camera) !== null;
}

function describeVoiceRoom(room: Room | null) {
  if (!room) {
    return null;
  }

  return {
    state: String((room as { state?: unknown }).state ?? "unknown"),
    localIdentity: room.localParticipant.identity,
    localAudioMuted: isParticipantAudioMuted(room.localParticipant),
    localScreenSharing: isParticipantScreenSharing(room.localParticipant),
    localCameraOn: isParticipantCameraOn(room.localParticipant),
    remoteParticipants: Array.from(room.remoteParticipants.values()).map(describeLiveKitParticipant)
  };
}

function describeLiveKitParticipant(participant: Participant) {
  return {
    identity: participant.identity,
    name: participant.name ?? null,
    audioMuted: isParticipantAudioMuted(participant),
    screenSharing: isParticipantScreenSharing(participant),
    cameraOn: isParticipantCameraOn(participant),
    speaking: participant.isSpeaking,
    audioPublications: Array.from(participant.audioTrackPublications.values()).map((publication) => ({
      source: publication.source,
      muted: publication.isMuted,
      subscribed: "isSubscribed" in publication ? publication.isSubscribed : undefined
    })),
    videoPublications: Array.from(participant.videoTrackPublications.values()).map((publication) => ({
      source: publication.source,
      muted: publication.isMuted,
      subscribed: "isSubscribed" in publication ? publication.isSubscribed : undefined,
      hasTrack: Boolean(publication.track)
    }))
  };
}

function describeVoiceState(state: VoiceStateView | null, selfId?: string) {
  if (!state) {
    return null;
  }

  const now = Date.now();

  return {
    channelName: state.channelName,
    count: state.participants.length,
    selfPresent: selfId ? state.participants.some((participant) => participant.userId === selfId) : undefined,
    participants: state.participants.map((participant) => ({
      userId: participant.userId,
      self: selfId ? participant.userId === selfId : undefined,
      muted: participant.selfMuted,
      deafened: participant.selfDeafened,
      serverMuted: participant.serverMuted,
      serverDeafened: participant.serverDeafened,
      screenSharing: participant.screenSharing,
      cameraOn: participant.cameraOn,
      viewingStreamId: participant.viewingStreamId,
      reconnecting: participant.reconnecting,
      joinedAt: participant.joinedAt,
      updatedAt: participant.updatedAt,
      updatedAgeMs: Math.max(0, now - Date.parse(participant.updatedAt))
    }))
  };
}

function getLiveKitParticipant(room: Room, userId: string): Participant | null {
  if (room.localParticipant.identity === userId) {
    return room.localParticipant;
  }

  return room.remoteParticipants.get(userId) ?? null;
}

function voiceStatusLabel(status: VoiceStatus, active: boolean) {
  if (status === "connecting") {
    return "Connecting";
  }

  if (status === "connected") {
    return "Voice Connected";
  }

  if (status === "reconnecting") {
    return "Reconnecting";
  }

  if (status === "failed") {
    return "Failed to connect";
  }

  return active ? "Voice Active" : "Disconnected";
}

function shouldCompactMessage(previous: MessageView | null, message: MessageView) {
  if (!previous || message.replyTo || previous.author.id !== message.author.id) {
    return false;
  }

  const gap = Date.parse(message.createdAt) - Date.parse(previous.createdAt);
  return gap >= 0 && gap < 7 * 60 * 1000;
}

function onErrorFromAsync(action: () => Promise<void>, onError: (error: string | null) => void) {
  action().catch((error) => onError(getMessage(error)));
}

function messageShouldNotifyUser(message: MessageView, user: UserProfile) {
  return messageMentionsUser(message.content, user) || message.replyTo?.author.id === user.id;
}

function describeAuditEntry(entry: AuditLogView) {
  const actor = entry.actor?.displayName ?? "Someone";
  const target = entry.targetUser?.displayName ?? "a user";
  const metadata = entry.metadata as Record<string, unknown>;

  if (entry.action === "MESSAGE_DELETE") {
    const message = readAuditObject(metadata.message);
    const attachments = readAuditArray(message?.attachments)
      .map((attachment) => readAuditString(readAuditObject(attachment)?.fileName))
      .filter(Boolean)
      .join(", ");
    const content = readAuditString(message?.content);

    return {
      title: "Message Deleted",
      summary: `${actor} deleted ${target}'s message${attachments ? ` with file(s): ${attachments}` : ""}.`,
      before: content || attachments || "Attachment message",
      after: "Deleted"
    };
  }

  if (entry.action === "MESSAGE_EDIT") {
    const before = readAuditObject(metadata.before);
    const after = readAuditObject(metadata.after);

    return {
      title: "Message Edited",
      summary: `${actor} edited a message.`,
      before: readAuditString(before?.content),
      after: readAuditString(after?.content)
    };
  }

  if (entry.action === "USER_BAN" || entry.action === "USER_UNBAN") {
    return {
      title: entry.action === "USER_BAN" ? "User Banned" : "User Unbanned",
      summary: `${actor} ${entry.action === "USER_BAN" ? "banned" : "unbanned"} ${target}.`
    };
  }

  if (entry.action === "USER_ROLE_UPDATE") {
    return {
      title: "Role Changed",
      summary: `${actor} changed ${target}'s role from ${readAuditString(metadata.beforeRole)} to ${readAuditString(metadata.afterRole)}.`
    };
  }

  if (entry.action === "CALENDAR_EVENT_DELETE") {
    const event = readAuditObject(metadata.event);

    return {
      title: "Event Deleted",
      summary: `${actor} deleted "${readAuditString(event?.title) || "an event"}".`,
      before: `${readAuditString(event?.title)}\n${readAuditString(event?.description)}`
    };
  }

  return {
    title: entry.action === "MESSAGE_RESTORE" ? "Message Restored" : "Event Restored",
    summary: `${actor} restored an item from the audit log.`
  };
}

function readAuditObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readAuditArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readAuditString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function loadNotificationPreferences(): NotificationPreferences {
  return {
    mentionToasts: true,
    mentionSound: true,
    desktopNotifications: true,
    sound: "ping",
    volume: 0.85,
    ...readJson<Partial<NotificationPreferences>>(notificationStorageKey)
  };
}

function loadAppearancePreferences(): AppearancePreferences {
  return {
    theme: "dark",
    ...readJson<Partial<AppearancePreferences>>(appearanceStorageKey)
  };
}

function loadVoiceVolumes(): Record<string, number> {
  const raw = readJson<Record<string, number>>(voiceVolumeStorageKey) ?? {};

  return Object.fromEntries(
    Object.entries(raw).map(([userId, volume]) => [userId, normalizeVoiceVolume(volume)])
  );
}

function loadLocalVoiceMutes(): string[] {
  return readJson<string[]>(localVoiceMuteStorageKey) ?? [];
}

function normalizeVoiceVolume(value: unknown) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 100;
  }

  return Math.min(Math.max(Math.round(parsed), 0), 100);
}

function getVoiceVolumeGain(
  userId: string,
  volumes: Record<string, number>,
  locallyMutedUsers: string[],
  deafened: boolean
) {
  if (deafened || locallyMutedUsers.includes(userId)) {
    return 0;
  }

  return normalizeVoiceVolume(volumes[userId] ?? 100) / 100;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function shouldNotifyMention(preferences: NotificationPreferences) {
  return preferences.mentionToasts || preferences.mentionSound || preferences.desktopNotifications;
}

function messageMentionsUser(content: string, user: UserProfile) {
  const mentions: string[] = content.toLowerCase().match(/@[a-z0-9_.-]+/g) ?? [];
  return mentions.includes(`@${user.username.toLowerCase()}`);
}

function showMentionNotification(
  message: MessageView,
  preferences: NotificationPreferences,
  setToasts: Dispatch<SetStateAction<Array<{ id: string; message: MessageView }>>>
) {
  if (preferences.mentionSound) {
    playMentionSound(preferences);
  }

  if (preferences.mentionToasts) {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message }].slice(-4));
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 6500);
  }

  if (preferences.desktopNotifications && "Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification(`${message.author.displayName} mentioned you`, {
        body: stripEventTokens(message.content).slice(0, 120)
      });
    } else if (Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }
}

function playMentionSound(preferences: NotificationPreferences) {
  if (!preferences.mentionSound || preferences.sound === "none" || preferences.volume <= 0) {
    return;
  }

  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }
  const context = new AudioContextClass();
  const gain = context.createGain();
  gain.gain.value = Math.min(Math.max(preferences.volume, 0), 1);
  gain.connect(context.destination);

  const frequencies =
    preferences.sound === "chime"
      ? [660, 880]
      : preferences.sound === "alert"
        ? [880, 660, 880]
        : [1046, 1318];

  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = preferences.sound === "alert" ? "square" : "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    const start = context.currentTime + index * 0.12;
    oscillator.start(start);
    oscillator.stop(start + 0.1);
  });

  setTimeout(() => void context.close(), 600);
}

function themeLabel(theme: ThemeName) {
  return {
    dark: "Dark",
    light: "Light",
    midnight: "Midnight",
    forest: "Forest",
    berry: "Berry"
  }[theme];
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateLabel(dateValue: string) {
  const [year = "1970", month = "01", day = "01"] = dateValue.split("-");

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(Number(year), Number(month) - 1, Number(day)));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric"
  }).format(value);
}

function formatEventDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatShortEventDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function stringifyDiagnosticDetails(details: unknown) {
  try {
    return JSON.stringify(
      details,
      (_key, value) => {
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack
          };
        }

        if (typeof value === "bigint") {
          return value.toString();
        }

        return value;
      },
      2
    );
  } catch {
    return String(details);
  }
}

function formatVoiceDiagnostics(entries: VoiceDiagnosticEntry[]) {
  return entries
    .map((entry) => {
      const details = entry.details ? `\n${entry.details}` : "";
      return `[${entry.at}] ${entry.event}${details}`;
    })
    .join("\n\n");
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

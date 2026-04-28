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
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  Edit3,
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
  VoiceSelfStateRequest,
  VoiceStateView
} from "@gcchat/shared";
import { API_URL, ApiClient } from "./api";

const tokenStorageKey = "gcchat.token";
const notificationStorageKey = "gcchat.notification-preferences";
const appearanceStorageKey = "gcchat.appearance-preferences";
const voiceVolumeStorageKey = "gcchat.voice-volumes";
const localVoiceMuteStorageKey = "gcchat.local-voice-mutes";
const eventTokenPattern = /\[\[gc-event:([^\]]+)]]/g;

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
  reconnecting: boolean;
  profile: UserProfile | null;
  volume: number;
  locallyMuted: boolean;
}

interface ScreenShareView {
  userId: string;
  name: string;
  isLocal: boolean;
  profile: UserProfile | null;
  track: LocalTrack | RemoteTrack | null;
  status: "starting" | "live" | "ended" | "unavailable";
}

const api = new ApiClient();

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [activeFeature, setActiveFeature] = useState<ActiveFeature>("chat");
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, MessageView[]>>({});
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
  const [screenShares, setScreenShares] = useState<ScreenShareView[]>([]);
  const [selectedStreamUserId, setSelectedStreamUserId] = useState<string | null>(null);
  const [screenSourcePicker, setScreenSourcePicker] = useState<ScreenSourcePreview[] | null>(null);
  const screenSourceResolverRef = useRef<((source: ScreenSourcePreview | null) => void) | null>(null);
  const [voiceVolumes, setVoiceVolumes] = useState(loadVoiceVolumes);
  const [locallyMutedVoiceUsers, setLocallyMutedVoiceUsers] = useState(loadLocalVoiceMutes);
  const voiceRoomRef = useRef<Room | null>(null);
  const voiceAudioElementsRef = useRef<Set<HTMLMediaElement>>(new Set());
  const voiceMutedRef = useRef(false);
  const voiceDeafenedRef = useRef(false);
  const voiceSharingRef = useRef(false);
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
    voiceMutedRef.current = voiceMuted;
  }, [voiceMuted]);

  useEffect(() => {
    voiceDeafenedRef.current = voiceDeafened;
  }, [voiceDeafened]);

  useEffect(() => {
    voiceSharingRef.current = voiceSharing;
  }, [voiceSharing]);

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
          voiceVolumes,
          locallyMutedVoiceUsers,
          voiceDeafened
        );

        participant.setVolume(volume);
      }
    },
    [locallyMutedVoiceUsers, voiceDeafened, voiceVolumes]
  );

  const syncScreenShares = useCallback(
    (room: Room | null) => {
      if (!room || !session) {
        setScreenShares([]);
        setVoiceSharing(false);
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
        const screenPublication = publications.find(
          (publication) => publication.source === Track.Source.ScreenShare
        );

        if (!screenPublication) {
          return;
        }

        nextShares.push({
          userId: participant.identity,
          name: profile?.displayName ?? participant.name ?? participant.identity,
          isLocal,
          profile,
          track: screenPublication.track ?? null,
          status: screenPublication.isMuted ? "unavailable" : screenPublication.track ? "live" : "starting"
        });
      };

      addParticipantShare(room.localParticipant, true);
      for (const participant of room.remoteParticipants.values()) {
        addParticipantShare(participant, false);
      }

      setScreenShares(nextShares);
      setVoiceSharing(nextShares.some((share) => share.userId === session.user.id && share.status === "live"));
    },
    [session]
  );

  const syncVoiceParticipants = useCallback(
    (room: Room | null) => {
      if (!session) {
        setVoiceParticipants([]);
        return;
      }

      setVoiceParticipants(
        voiceServerState.participants.map((participantState) => {
          const liveParticipant = room ? getLiveKitParticipant(room, participantState.userId) : null;
          const profile =
            session.user.id === participantState.userId
              ? session.user
              : session.members.find((member) => member.id === participantState.userId) ?? null;
          const liveMuted = liveParticipant ? isParticipantAudioMuted(liveParticipant) : participantState.selfMuted;
          const locallyMuted = locallyMutedVoiceUsers.includes(participantState.userId);

          return {
            userId: participantState.userId,
            name: profile?.displayName ?? liveParticipant?.name ?? participantState.userId,
            isLocal: participantState.userId === session.user.id,
            isMuted:
              participantState.serverMuted ||
              participantState.serverDeafened ||
              participantState.selfDeafened ||
              liveMuted,
            isDeafened: participantState.selfDeafened || participantState.serverDeafened,
            isServerMuted: participantState.serverMuted,
            isServerDeafened: participantState.serverDeafened,
            isSpeaking: liveParticipant?.isSpeaking ?? false,
            isScreenSharing: participantState.screenSharing,
            reconnecting: participantState.reconnecting,
            profile,
            volume: voiceVolumes[participantState.userId] ?? 100,
            locallyMuted
          };
        })
      );
    },
    [locallyMutedVoiceUsers, session, voiceServerState.participants, voiceVolumes]
  );

  const disconnectVoice = useCallback((notifyServer = true) => {
    if (notifyServer) {
      socketRef.current?.emit("voice:leave");
    }

    void voiceRoomRef.current?.localParticipant.setScreenShareEnabled(false).catch(() => undefined);
    voiceRoomRef.current?.disconnect();
    voiceRoomRef.current = null;
    clearVoiceAudio();
    setVoiceStatus("disconnected");
    setVoiceMuted(false);
    setVoiceDeafened(false);
    setVoiceSharing(false);
    setScreenShares([]);
    setSelectedStreamUserId(null);
  }, [clearVoiceAudio]);

  const handleVoiceJoin = async () => {
    if (voiceStatus === "connecting" || voiceRoomRef.current) {
      return;
    }

    let room: Room | null = null;
    let joinedVoicePresence = false;
    setVoiceStatus("connecting");
    setError(null);

    try {
      const credentials = await api.createVoiceToken();
      room = new Room({ adaptiveStream: true, dynacast: true });

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
          voiceVolumes,
          locallyMutedVoiceUsers,
          voiceDeafened
        );
        document.body.appendChild(element);
        voiceAudioElementsRef.current.add(element);
      };

      const detachAudio = (track: RemoteTrack) => {
        for (const element of track.detach()) {
          element.remove();
          voiceAudioElementsRef.current.delete(element);
        }
      };

      const sync = () => {
        syncVoiceParticipants(room);
        syncScreenShares(room);
        applyVoiceAudioPreferences(room);
      };

      room.on(RoomEvent.ParticipantConnected, sync);
      room.on(RoomEvent.ParticipantDisconnected, sync);
      room.on(RoomEvent.ActiveSpeakersChanged, sync);
      room.on(RoomEvent.TrackMuted, sync);
      room.on(RoomEvent.TrackUnmuted, sync);
      room.on(RoomEvent.TrackPublished, sync);
      room.on(RoomEvent.TrackUnpublished, sync);
      room.on(RoomEvent.LocalTrackPublished, sync);
      room.on(RoomEvent.LocalTrackUnpublished, sync);
      room.on(RoomEvent.Reconnecting, () => setVoiceStatus("reconnecting"));
      room.on(RoomEvent.Reconnected, () => {
        setVoiceStatus("connected");
        void emitVoiceJoin().then((state) => state && setVoiceServerState(state)).catch((requestError) => {
          setError(getMessage(requestError));
        });
      });
      room.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
          attachAudio(track, _participant);
          sync();
        }
      );
      room.on(
        RoomEvent.TrackUnsubscribed,
        (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
          detachAudio(track);
          sync();
        }
      );
      room.on(RoomEvent.Disconnected, () => {
        clearVoiceAudio();
        voiceRoomRef.current = null;
        setVoiceStatus("disconnected");
        setVoiceMuted(false);
        setVoiceDeafened(false);
        setVoiceSharing(false);
        setScreenShares([]);
        setSelectedStreamUserId(null);
      });

      await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(true);
      voiceRoomRef.current = room;
      setVoiceStatus("connected");
      setVoiceMuted(false);
      setVoiceDeafened(false);
      const voiceState = await emitVoiceJoin();
      joinedVoicePresence = true;
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
      await room.localParticipant.setMicrophoneEnabled(!nextMuted);
      setVoiceMuted(nextMuted);
      await emitVoiceSelfState({ selfMuted: nextMuted });
      syncVoiceParticipants(room);
    } catch (requestError) {
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
      await room.localParticipant.setMicrophoneEnabled(!forcedMuted);
      setVoiceDeafened(nextDeafened);
      setVoiceMuted(forcedMuted);
      await emitVoiceSelfState({ selfDeafened: nextDeafened, selfMuted: forcedMuted });
      applyVoiceAudioPreferences(room);
      syncVoiceParticipants(room);
    } catch (requestError) {
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
        setVoiceSharing(false);
        setSelectedStreamUserId((current) => (current === session.user.id ? null : current));
        await emitVoiceSelfState({ screenSharing: false });
        syncScreenShares(room);
        return;
      }

      const source = await requestScreenSource();

      if (!source) {
        return;
      }

      await window.gcchat.screens.selectSource(source.id);
      setVoiceSharing(true);
      await emitVoiceSelfState({ screenSharing: true });
      await room.localParticipant.setScreenShareEnabled(true);
      setSelectedStreamUserId(session.user.id);
      syncScreenShares(room);
    } catch (requestError) {
      setVoiceSharing(false);
      void emitVoiceSelfState({ screenSharing: false });
      setError(getMessage(requestError));
    }
  };

  const handleVoiceModeration = async (payload: VoiceModerationRequest) => {
    onErrorFromAsync(async () => {
      const state = await emitVoiceModeration(payload);
      if (state) {
        setVoiceServerState(state);
      }
    }, setError);
  };

  useEffect(() => {
    return () => disconnectVoice();
  }, [disconnectVoice]);

  useEffect(() => {
    syncVoiceParticipants(voiceRoomRef.current);
  }, [session?.members, session?.user, syncVoiceParticipants, voiceServerState]);

  useEffect(() => {
    applyVoiceAudioPreferences(voiceRoomRef.current);
    syncVoiceParticipants(voiceRoomRef.current);
  }, [applyVoiceAudioPreferences, locallyMutedVoiceUsers, syncVoiceParticipants, voiceDeafened, voiceVolumes]);

  useEffect(() => {
    if (!selectedStreamUserId) {
      return;
    }

    const selectedShare = screenShares.find(
      (share) => share.userId === selectedStreamUserId && share.status === "live"
    );

    if (!selectedShare) {
      setSelectedStreamUserId(null);
    }
  }, [screenShares, selectedStreamUserId]);

  useEffect(() => {
    const room = voiceRoomRef.current;
    const selfState = voiceServerState.participants.find((participant) => participant.userId === session?.user.id);

    if (!room || !selfState) {
      return;
    }

    if (selfState.serverMuted || selfState.serverDeafened) {
      void room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      setVoiceMuted(true);
    }

    if (selfState.serverDeafened) {
      setVoiceDeafened(true);
    }
  }, [session?.user.id, voiceServerState.participants]);

  const enterBannedState = () => {
    localStorage.removeItem(tokenStorageKey);
    api.setToken(null);
    disconnectVoice();
    socketRef.current?.disconnect();
    setBanned(true);
    setSession(null);
    setMessagesByChannel({});
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
      for (const channel of session.channels) {
        socket.emit("channel:join", { channelId: channel.id });
      }

      if (voiceRoomRef.current) {
        socket.emit("voice:join", (response) => {
          if (response.ok) {
            setVoiceServerState(response.state);
          }
        });
        socket.emit(
          "voice:self-state",
          {
            selfMuted: voiceMutedRef.current,
            selfDeafened: voiceDeafenedRef.current,
            screenSharing: voiceSharingRef.current
          },
          (response) => {
            if (response.ok) {
              setVoiceServerState(response.state);
            }
          }
        );
      }
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
      setVoiceServerState(state);
    });

    socket.on("voice:moderated", (state) => {
      if (state.userId !== session.user.id) {
        return;
      }

      if (state.serverMuted || state.serverDeafened) {
        void voiceRoomRef.current?.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
        setVoiceMuted(true);
      }

      if (state.serverDeafened) {
        setVoiceDeafened(true);
      }
    });

    socket.on("voice:force-disconnect", () => {
      disconnectVoice(false);
      setError("You were disconnected from voice by an admin.");
    });

    socket.on("connect_error", (socketError) => setError(socketError.message));
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
  }, [notificationPrefs, session?.token]);

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
      .then((history) => {
        if (active) {
          setMessagesByChannel((current) => ({
            ...current,
            [activeChannel.id]: history.map(normalizeMessage)
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
      void api.getMessages(message.channelId).then((history) => {
        setMessagesByChannel((current) => ({
          ...current,
          [message.channelId]: history.map(normalizeMessage)
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
  const selectedStream = selectedStreamUserId
    ? screenShares.find((share) => share.userId === selectedStreamUserId) ?? null
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
          onChannelSelect={setActiveChannelId}
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
          voiceParticipants={voiceParticipants}
          screenShares={screenShares}
          onVoiceJoin={() => void handleVoiceJoin()}
          onVoiceLeave={disconnectVoice}
          onVoiceMuteToggle={() => void handleVoiceMuteToggle()}
          onVoiceDeafenToggle={() => void handleVoiceDeafenToggle()}
          onScreenShareToggle={() => void handleScreenShareToggle()}
          onWatchStream={setSelectedStreamUserId}
          onVoiceProfile={setSelectedProfile}
          onSetVoiceVolume={(userId, volume) =>
            setVoiceVolumes((current) => ({ ...current, [userId]: normalizeVoiceVolume(volume) }))
          }
          onToggleLocalVoiceMute={(userId) =>
            setLocallyMutedVoiceUsers((current) =>
              current.includes(userId)
                ? current.filter((existing) => existing !== userId)
                : [...current, userId]
            )
          }
          onVoiceModeration={(payload) => void handleVoiceModeration(payload)}
        />
      ) : null}

      {activeFeature === "chat" ? (
        <main className="chat-panel">
          <header className="chat-header">
            <div className="chat-title">
              <Hash size={22} />
              <span>{currentChannel.name}</span>
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
              voiceStatus={voiceStatus}
              muted={voiceMuted}
              deafened={voiceDeafened}
              onSelectStream={setSelectedStreamUserId}
              onExit={() => setSelectedStreamUserId(null)}
              onToggleMute={() => void handleVoiceMuteToggle()}
              onToggleDeafen={() => void handleVoiceDeafenToggle()}
              onDisconnect={disconnectVoice}
            />
          ) : (
            <>
              <MessageList
                messages={messages}
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
        <CalendarSidePanel events={calendarEvents} onProfile={setSelectedProfile} />
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
  onChannelSelect,
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
  voiceParticipants,
  screenShares,
  onVoiceJoin,
  onVoiceLeave,
  onVoiceMuteToggle,
  onVoiceDeafenToggle,
  onScreenShareToggle,
  onWatchStream,
  onVoiceProfile,
  onSetVoiceVolume,
  onToggleLocalVoiceMute,
  onVoiceModeration
}: {
  session: Session;
  activeChannelId: string;
  onChannelSelect: (channelId: string) => void;
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
  voiceParticipants: VoiceParticipantView[];
  screenShares: ScreenShareView[];
  onVoiceJoin: () => void;
  onVoiceLeave: () => void;
  onVoiceMuteToggle: () => void;
  onVoiceDeafenToggle: () => void;
  onScreenShareToggle: () => void;
  onWatchStream: (userId: string) => void;
  onVoiceProfile: (profile: UserProfile) => void;
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
                className={`channel-link ${channel.id === activeChannelId ? "active" : ""}`}
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
          participants={voiceParticipants}
          screenShares={screenShares}
          onJoin={onVoiceJoin}
          onLeave={onVoiceLeave}
          onToggleMute={onVoiceMuteToggle}
          onToggleDeafen={onVoiceDeafenToggle}
          onToggleScreenShare={onScreenShareToggle}
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
          participants={voiceParticipants}
          onJoin={onVoiceJoin}
          onLeave={onVoiceLeave}
          onToggleMute={onVoiceMuteToggle}
          onToggleDeafen={onVoiceDeafenToggle}
          onToggleScreenShare={onScreenShareToggle}
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
  participants,
  screenShares,
  onJoin,
  onLeave,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
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
  participants: VoiceParticipantView[];
  screenShares: ScreenShareView[];
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onWatchStream: (userId: string) => void;
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

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const close = () => setContextMenu(null);
    window.addEventListener("click", close);

    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  return (
    <section className="voice-channel-section">
      <div className="channel-group-title voice-title">Voice Channels</div>
      <button
        className={`channel-link voice-channel-link ${connected ? "active" : ""}`}
        onClick={connected ? undefined : onJoin}
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
                  className={`voice-participant-row ${participant.isScreenSharing ? "has-stream" : ""}`}
                  key={participant.userId}
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
                  {participant.isScreenSharing ? (
                    <span
                      className="live-badge"
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        onWatchStream(participant.userId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          onWatchStream(participant.userId);
                        }
                      }}
                      title="Sharing screen"
                    >
                      LIVE
                    </span>
                  ) : null}
                  {participant.isServerMuted ? (
                    <MicOff className="server-muted-icon" size={13} aria-label="Server muted" />
                  ) : participant.isMuted ? (
                    <MicOff size={13} aria-label="Muted" />
                  ) : null}
                  {participant.isDeafened ? <VolumeX size={13} aria-label="Deafened" /> : null}
                </button>
                {participant.isScreenSharing ? (
                  <StreamHoverPreview
                    stream={screenShares.find((share) => share.userId === participant.userId) ?? null}
                    onWatch={() => onWatchStream(participant.userId)}
                  />
                ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {connected ? <VoiceControlRow
            muted={muted}
            deafened={deafened}
            sharing={sharing}
            onToggleMute={onToggleMute}
            onToggleDeafen={onToggleDeafen}
            onToggleScreenShare={onToggleScreenShare}
            onLeave={onLeave}
          /> : null}
          {contextMenu ? (
            <VoiceUserContextMenu
              state={contextMenu}
              canModerate={canModerate}
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
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onLeave
}: {
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
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
  participants,
  onJoin,
  onLeave,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare
}: {
  status: VoiceStatus;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  participants: VoiceParticipantView[];
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
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
            <button type="button" className="voice-status-button danger" onClick={onLeave} title="Disconnect">
              <PhoneOff size={15} />
            </button>
          </>
        ) : (
          <button type="button" className="voice-status-join" onClick={onJoin}>
            Join Voice
          </button>
        )}
      </div>
    </section>
  );
}

function VoiceUserContextMenu({
  state,
  canModerate,
  onClose,
  onProfile,
  onSetVolume,
  onToggleLocalMute,
  onModerate
}: {
  state: { participant: VoiceParticipantView; x: number; y: number };
  canModerate: boolean;
  onClose: () => void;
  onProfile: (profile: UserProfile) => void;
  onSetVolume: (userId: string, volume: number) => void;
  onToggleLocalMute: (userId: string) => void;
  onModerate: (payload: VoiceModerationRequest) => void;
}) {
  const participant = state.participant;
  const canModerateParticipant = canModerate && !participant.isLocal;

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
          value={participant.locallyMuted ? 0 : normalizeVoiceVolume(participant.volume)}
          onChange={(event) => onSetVolume(participant.userId, normalizeVoiceVolume(event.target.value))}
        />
        <small>{participant.locallyMuted ? "Muted locally" : `${normalizeVoiceVolume(participant.volume)}%`}</small>
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
  onWatch
}: {
  stream: ScreenShareView | null;
  onWatch: () => void;
}) {
  return (
    <div className="stream-hover-preview">
      <div className="stream-hover-header">
        <span>Streaming Now</span>
        <em>LIVE</em>
      </div>
      <div className="stream-preview-frame">
        {stream?.track && stream.status === "live" ? (
          <TrackVideo track={stream.track} muted />
        ) : (
          <span>{stream?.status === "unavailable" ? "Stream unavailable" : "Starting stream..."}</span>
        )}
      </div>
      <button type="button" onClick={onWatch}>
        <MonitorUp size={16} />
        Watch Stream
      </button>
    </div>
  );
}

function ScreenShareStage({
  stream,
  allStreams,
  voiceStatus,
  muted,
  deafened,
  onSelectStream,
  onExit,
  onToggleMute,
  onToggleDeafen,
  onDisconnect
}: {
  stream: ScreenShareView;
  allStreams: ScreenShareView[];
  voiceStatus: VoiceStatus;
  muted: boolean;
  deafened: boolean;
  onSelectStream: (userId: string) => void;
  onExit: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
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

  return (
    <section className="screen-share-stage">
      <header className="stream-stage-header">
        <div>
          <strong>{stream.name}</strong>
          <span>Watching {stream.isLocal ? "your stream" : `${stream.name}'s stream`}</span>
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
        {stream.track && stream.status === "live" ? (
          <TrackVideo track={stream.track} />
        ) : (
          <div className="stream-ended-state">
            <MonitorX size={34} />
            <h2>{stream.status === "unavailable" ? "Stream unavailable" : "Starting stream..."}</h2>
            <p>
              {stream.status === "unavailable"
                ? "The stream is having trouble loading."
                : "GCChat is waiting for LiveKit to publish the screen track."}
            </p>
            <button className="secondary-button" type="button" onClick={onExit}>
              Back to chat
            </button>
          </div>
        )}
      </div>
      <footer className="stream-stage-footer">
        <span className={voiceStatus === "reconnecting" ? "reconnecting" : ""}>
          {voiceStatus === "reconnecting" ? "Reconnecting..." : "Voice connected"}
        </span>
        {liveStreams.length > 1 ? (
          <div className="stream-switcher">
            {liveStreams.map((candidate) => (
              <button
                className={candidate.userId === stream.userId ? "active" : ""}
                key={candidate.userId}
                type="button"
                onClick={() => onSelectStream(candidate.userId)}
              >
                {candidate.profile ? <Avatar profile={candidate.profile} size="xs" /> : null}
                <span>{candidate.isLocal ? "You" : candidate.name}</span>
                <em>LIVE</em>
              </button>
            ))}
          </div>
        ) : null}
      </footer>
    </section>
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
  onError
}: {
  messages: MessageView[];
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
  onError: (error: string | null) => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLElement>());
  const [contextMenu, setContextMenu] = useState<{
    message: MessageView;
    x: number;
    y: number;
    mode: "actions" | "reactions";
  } | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

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
      <section className="message-list empty">
        <div className="empty-state">
          <Hash size={34} />
          <h2>general</h2>
        </div>
      </section>
    );
  }

  return (
    <section className="message-list">
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
                  onError={onError}
                />
              ) : (
                <MessageEventPlaceholder key={eventId} status={calendarEventsStatus} />
              );
            })}
            {message.attachments.length > 0 ? (
              <div className="attachments">
                {message.attachments.map((attachment) => (
                  <a
                    className="attachment"
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    key={attachment.id}
                  >
                    {attachment.mimeType.startsWith("image/") ? (
                      <img src={attachment.url} alt={attachment.fileName} />
                    ) : (
                      <span>{attachment.fileName}</span>
                    )}
                  </a>
                ))}
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
    </section>
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
  onError
}: {
  event: CalendarEventView;
  onUpdated: (event: CalendarEventView) => void;
  onOpenCalendarEvent: (eventId: string) => void;
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
  const [file, setFile] = useState<File | null>(null);
  const [attachedEvent, setAttachedEvent] = useState<CalendarEventView | null>(null);
  const [sending, setSending] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  const canSend = draft.trim().length > 0 || (!editingMessage && (file || attachedEvent));
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
    setFile(null);
    setAttachedEvent(null);
    setAttachmentMenuOpen(false);
    setEventPickerOpen(false);
    setEmojiPickerOpen(false);
    onCancelReply();

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [editingMessage?.id]);

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
    const selectedFile = file;
    const selectedEvent = attachedEvent;
    const selectedReply = replyTo;
    const content = `${draft.trim()}${selectedEvent ? `\n${createEventToken(selectedEvent.id)}` : ""}`.trim();
    const localAttachmentUrl = selectedFile ? URL.createObjectURL(selectedFile) : null;
    const optimisticAttachments: MessageView["attachments"] = selectedFile
      ? [
          {
            id: `${temporaryId}-attachment-0`,
            url: localAttachmentUrl!,
            fileName: selectedFile.name,
            mimeType: selectedFile.type || "application/octet-stream",
            size: selectedFile.size
          }
        ]
      : [];
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
    setFile(null);
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
      setSending(Boolean(selectedFile));
      const attachments: CreateMessageRequest["attachments"] = [];

      if (selectedFile) {
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
      if (localAttachmentUrl) {
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
    <form className="composer" onSubmit={submit}>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
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
          {file ? (
            <button type="button" className="file-chip" onClick={() => setFile(null)}>
              {file.name}
              <X size={14} />
            </button>
          ) : null}
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
  onProfile
}: {
  events: CalendarEventView[];
  onProfile: (profile: UserProfile) => void;
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
            <strong>{event.title}</strong>
            <span>{formatShortEventDate(event.startAt)}</span>
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
  return (
    <aside className="members-panel">
      <div className="members-title">Members</div>
      {members.map((member) => (
        <button
          className={`member-row ${member.bannedAt ? "banned" : ""}`}
          key={member.id}
          onClick={() => onProfile(member)}
        >
          <Avatar
            profile={member}
            size="sm"
            status={member.isOnline ? "online" : "offline"}
            muted={Boolean(member.bannedAt)}
          />
          <span className="member-name">{member.displayName}</span>
          {member.bannedAt ? <em>Banned</em> : null}
          {member.role === "SUPER_ADMIN" ? <ShieldCheck size={14} /> : member.role === "ADMIN" ? <Shield size={14} /> : null}
        </button>
      ))}
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
        const uploaded = await api.upload(avatarFile, "avatar");
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
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatShortEventDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

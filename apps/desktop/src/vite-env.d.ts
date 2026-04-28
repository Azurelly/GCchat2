/// <reference types="vite/client" />

type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";

interface UpdateStatus {
  phase: UpdatePhase;
  message?: string;
  canRestart: boolean;
}

interface ScreenSourcePreview {
  id: string;
  name: string;
  thumbnail: string;
}

interface Window {
  gcchat: {
    platform: string;
    updates: {
      getStatus: () => Promise<UpdateStatus>;
      checkNow: () => Promise<UpdateStatus>;
      restartAndInstall: () => Promise<void>;
      onStatus: (callback: (status: UpdateStatus) => void) => () => void;
    };
    window: {
      minimize: () => Promise<void>;
      toggleMaximize: () => Promise<void>;
      close: () => Promise<void>;
    };
    screens: {
      getSources: () => Promise<ScreenSourcePreview[]>;
      selectSource: (sourceId: string) => Promise<void>;
    };
  };
}

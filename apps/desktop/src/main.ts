import path from "node:path";
import { app, autoUpdater, BrowserWindow, ipcMain, Menu, session, shell } from "electron";
import started from "electron-squirrel-startup";
import releaseConfig from "../../../release.config.json";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

if (started) {
  app.quit();
}

const updateRepo = `${releaseConfig.githubOwner}/${releaseConfig.githubRepo}`;

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

let mainWindow: BrowserWindow | null = null;
let updateStatus: UpdateStatus = { phase: "idle", canRestart: false };
let updatesConfigured = false;

const createWindow = () => {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#313338",
    frame: false,
    title: "GCChat",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
};

app.on("ready", createWindow);

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  setupAutoUpdates();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle("updates:get-status", () => updateStatus);

ipcMain.handle("updates:check-now", () => {
  checkForUpdates();
  return updateStatus;
});

ipcMain.handle("updates:restart-and-install", () => {
  if (updateStatus.canRestart) {
    autoUpdater.quitAndInstall();
  }
});

ipcMain.handle("window:minimize", () => {
  BrowserWindow.getFocusedWindow()?.minimize();
});

ipcMain.handle("window:toggle-maximize", () => {
  const window = BrowserWindow.getFocusedWindow();

  if (!window) {
    return;
  }

  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.handle("window:close", () => {
  BrowserWindow.getFocusedWindow()?.close();
});

function setupAutoUpdates() {
  if (updatesConfigured) {
    return;
  }

  updatesConfigured = true;

  if (!app.isPackaged) {
    setUpdateStatus({ phase: "idle", message: "Updates run in packaged builds.", canRestart: false });
    return;
  }

  if (updateRepo.includes("CHANGE_ME")) {
    setUpdateStatus({ phase: "error", message: "Update repository is not configured.", canRestart: false });
    return;
  }

  if (process.platform !== "win32" && process.platform !== "darwin") {
    setUpdateStatus({ phase: "idle", message: "Auto-updates are not configured for this OS.", canRestart: false });
    return;
  }

  autoUpdater.setFeedURL({
    url: getUpdateFeedUrl()
  });

  autoUpdater.on("checking-for-update", () => {
    setUpdateStatus({ phase: "checking", canRestart: false });
  });

  autoUpdater.on("update-available", () => {
    setUpdateStatus({ phase: "downloading", message: "Downloading update...", canRestart: false });
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateStatus({ phase: "not-available", canRestart: false });
  });

  autoUpdater.on("update-downloaded", () => {
    setUpdateStatus({
      phase: "downloaded",
      message: "Update ready. Restart to install.",
      canRestart: true
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateStatus({ phase: "error", message: error.message, canRestart: false });
  });

  checkForUpdates();
  setTimeout(checkForUpdates, 15000);
  setInterval(checkForUpdates, 10 * 60 * 1000);
}

function checkForUpdates() {
  if (!updatesConfigured || !app.isPackaged || updateStatus.canRestart) {
    return;
  }

  try {
    setUpdateStatus({ phase: "checking", canRestart: false });
    autoUpdater.checkForUpdates();
  } catch (error) {
    setUpdateStatus({
      phase: "error",
      message: error instanceof Error ? error.message : "Could not check for updates.",
      canRestart: false
    });
  }
}

function getUpdateFeedUrl() {
  if (process.platform === "win32") {
    return `https://github.com/${updateRepo}/releases/latest/download`;
  }

  return `https://update.electronjs.org/${updateRepo}/${process.platform}-${process.arch}/${app.getVersion()}`;
}

function setUpdateStatus(nextStatus: UpdateStatus) {
  updateStatus = nextStatus;
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("updates:status", updateStatus);
  });
}

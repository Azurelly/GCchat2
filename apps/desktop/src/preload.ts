import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("gcchat", {
  platform: process.platform,
  updates: {
    getStatus: () => ipcRenderer.invoke("updates:get-status"),
    checkNow: () => ipcRenderer.invoke("updates:check-now"),
    restartAndInstall: () => ipcRenderer.invoke("updates:restart-and-install"),
    onStatus: (callback: (status: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
      ipcRenderer.on("updates:status", listener);
      return () => ipcRenderer.removeListener("updates:status", listener);
    }
  }
});

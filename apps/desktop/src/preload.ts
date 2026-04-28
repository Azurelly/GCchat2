import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("gcchat", {
  platform: process.platform
});

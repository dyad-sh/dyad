import { app, BrowserWindow } from "electron";
import * as path from "node:path";
import { registerIpcHandlers } from "./ipc/ipc_host";
import dotenv from "dotenv";
// @ts-ignore
import started from "electron-squirrel-startup";
import { updateElectronApp } from "update-electron-app";
import log from "electron-log";

console.log = log.log;
console.error = log.error;
console.warn = log.warn;
console.info = log.info;
console.debug = log.debug;

updateElectronApp(); // additional configuration options available

// Load environment variables from .env file
dotenv.config();

// Register IPC handlers before app is ready
registerIpcHandlers();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: process.env.NODE_ENV === "development" ? 1280 : 960,
    height: 700,
    titleBarStyle: "hidden",
    titleBarOverlay: true,
    trafficLightPosition: {
      x: 10,
      y: 8,
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      // transparent: true,
    },
    // backgroundColor: "#00000001",
    // frame: false,
  });
  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "../renderer/main_window/index.html")
    );
  }
  if (process.env.NODE_ENV === "development") {
    // Open the DevTools.
    mainWindow.webContents.openDevTools();
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

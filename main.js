const { app, BrowserWindow, shell } = require("electron");
const { startServer } = require("./server");

let mainWindow = null;
let serverHandle = null;

async function createDesktopApp() {
  const personalDataDir = app.getPath("userData");
  serverHandle = await startServer(personalDataDir, 0, "127.0.0.1");

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 650,
    title: "Marketing Adda — Brand Strategy Studio",
    backgroundColor: "#FAF7F2",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverHandle.port}`);
  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createDesktopApp);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createDesktopApp();
});

app.on("before-quit", () => {
  if (serverHandle) serverHandle.stop();
});
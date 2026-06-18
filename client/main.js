const { app, BrowserWindow, ipcMain, session, desktopCapturer } = require('electron');
const path = require('path');
const isDev = !app.isPackaged;
const { autoUpdater } = require('electron-updater');

// Configure auto-updater policies and log handlers
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
});

autoUpdater.on('update-not-available', (info) => {
  console.log('Update not available.');
});

autoUpdater.on('error', (err) => {
  console.error('Error in auto-updater:', err);
});

autoUpdater.on('update-downloaded', (info) => {
  const { dialog } = require('electron');
  dialog.showMessageBox({
    type: 'info',
    title: 'Доступно обновление',
    message: `Новая версия ${info.version} успешно скачана. Приложение будет перезапущено для установки.`,
    buttons: ['Перезапустить', 'Позже']
  }).then((result) => {
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

// Ignore self-signed certificate errors for LAN HTTPS connections
app.commandLine.appendSwitch('ignore-certificate-errors');

// Register the display-media request handler.
// Electron does NOT implement navigator.mediaDevices.getDisplayMedia() by itself:
// calling it from the renderer rejects with NotSupportedError/"Requested device not found"
// unless a handler is registered on the SAME session via setDisplayMediaRequestHandler().
// The handler MUST call callback() exactly once with a chosen source (or {} on failure).
// This is the root cause of the screen-share bug.
// IPC handler to query screens/windows with base64 thumbnails
const registerDisplayMediaIPC = () => {
  ipcMain.handle('get-screen-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 300, height: 200 }, // Premium size previews
        fetchWindowIcons: true
      });
      return sources.map(s => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        appIcon: s.appIcon ? s.appIcon.toDataURL() : null
      }));
    } catch (err) {
      console.error('Failed to get display media sources:', err);
      return [];
    }
  });
};

let tiktokWin = null;
const registerTikTokIPC = () => {
  ipcMain.on('open-tiktok-window', () => {
    if (tiktokWin) {
      tiktokWin.focus();
      return;
    }
    tiktokWin = new BrowserWindow({
      width: 450,
      height: 800,
      title: 'TikTok - Telecord Activity',
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:tiktok', // Keep logins persistent
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    // Modern user agent to bypass any security triggers
    tiktokWin.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    tiktokWin.loadURL('https://www.tiktok.com');

    tiktokWin.on('closed', () => {
      tiktokWin = null;
    });
  });

  ipcMain.on('close-tiktok-window', () => {
    if (tiktokWin) {
      tiktokWin.close();
      tiktokWin = null;
    }
  });
};

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false, // For simplicity in this local app
      webviewTag: true
    },
    titleBarStyle: 'hidden', // Looks more native and premium
    titleBarOverlay: {
      color: '#0b0b0f',
      symbolColor: '#f8fafc',
      height: 48
    }
  });

  // Always load built index.html for stability
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  registerDisplayMediaIPC();
  registerTikTokIPC();
  createWindow();

  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

let mainWindow;
let serverProcess = null;

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  return ips;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a12',
      symbolColor: '#ffffff',
      height: 40
    },
    backgroundColor: '#0a0a12',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

// Resolve server directory
function getServerPath() {
  // In packaged app, resources are in app.asar's parent
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server');
  }
  // In development, server is a sibling directory
  return path.join(__dirname, '..', 'server');
}

ipcMain.handle('get-system-info', () => {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    cpus: os.cpus().length,
    totalMemory: (os.totalmem() / 1024 / 1024 / 1024).toFixed(1),
    freeMemory: (os.freemem() / 1024 / 1024 / 1024).toFixed(1),
    uptime: os.uptime(),
    ips: getLocalIPs(),
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron
  };
});

ipcMain.handle('start-server', () => {
  return new Promise((resolve) => {
    if (serverProcess) {
      resolve({ success: false, error: 'Server is already running' });
      return;
    }

    const serverPath = getServerPath();
    const indexPath = path.join(serverPath, 'index.js');

    try {
      serverProcess = spawn('node', [indexPath], {
        cwd: serverPath,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      serverProcess.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          mainWindow?.webContents.send('server-log', { type: 'stdout', text, timestamp: Date.now() });
        }
      });

      serverProcess.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          mainWindow?.webContents.send('server-log', { type: 'stderr', text, timestamp: Date.now() });
        }
      });

      serverProcess.on('error', (err) => {
        mainWindow?.webContents.send('server-status', { running: false, error: err.message });
        serverProcess = null;
      });

      serverProcess.on('close', (code) => {
        mainWindow?.webContents.send('server-status', { running: false, exitCode: code });
        mainWindow?.webContents.send('server-log', { type: 'system', text: `Server process exited with code ${code}`, timestamp: Date.now() });
        serverProcess = null;
      });

      // Give it a moment to start
      setTimeout(() => {
        if (serverProcess && !serverProcess.killed) {
          resolve({ success: true });
          mainWindow?.webContents.send('server-status', { running: true });
        } else {
          resolve({ success: false, error: 'Server failed to start' });
        }
      }, 1000);
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

ipcMain.handle('stop-server', () => {
  return new Promise((resolve) => {
    if (!serverProcess) {
      resolve({ success: false, error: 'Server is not running' });
      return;
    }

    serverProcess.on('close', () => {
      resolve({ success: true });
    });

    serverProcess.kill('SIGTERM');

    // Force kill after 5 seconds if still alive
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    }, 5000);
  });
});

ipcMain.handle('get-server-status', () => {
  return { running: serverProcess !== null && !serverProcess.killed };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
});

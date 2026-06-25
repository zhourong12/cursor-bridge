/**
 * Bridge Console Electron 主进程
 */
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

delete process.env.ELECTRON_RUN_AS_NODE;

const PORT = Number(process.env.BRIDGE_CONSOLE_PORT || 3928);
const HOST = process.env.BRIDGE_CONSOLE_HOST || '127.0.0.1';

let mainWindow = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function adminBootPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bridge', 'dist', 'admin-boot.cjs');
  }
  return path.join(__dirname, '..', 'dist', 'admin-boot.cjs');
}

function cliPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bridge', 'dist', 'cli.js');
  }
  return path.join(__dirname, '..', 'dist', 'cli.js');
}

function readToken() {
  const env = process.env.LARK_BRIDGE_ADMIN_TOKEN?.trim();
  if (env) return env;
  try {
    return fs.readFileSync(path.join(os.homedir(), '.lark-channel', 'admin-token'), 'utf8').trim();
  } catch {
    return '';
  }
}

let closeServer = null;

function writeStartupLog(msg) {
  try {
    const dir = path.join(os.homedir(), '.lark-channel');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'console-startup.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}

function failStartup(err) {
  const text = err?.stack || String(err);
  writeStartupLog(text);
  console.error('Bridge Console startup failed:', text);
  dialog.showErrorBox('Bridge Console 启动失败', `${err?.message || err}\n\n日志: ~/.lark-channel/console-startup.log`);
  app.quit();
}

async function startAdminInProcess() {
  const staticRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'bridge', 'dist', 'admin', 'static')
    : path.join(__dirname, '..', 'dist', 'admin', 'static');
  if (!fs.existsSync(path.join(staticRoot, 'index.html'))) {
    throw new Error(`管理页静态资源缺失: ${staticRoot}\n请先 npm run build，或重新 pack:console`);
  }
  process.env.BRIDGE_ADMIN_STATIC = staticRoot;
  process.env.BRIDGE_RESOURCES_PATH = app.isPackaged ? process.resourcesPath : '';
  process.env.BRIDGE_CLI_PATH = cliPath();
  const mod = require(adminBootPath());
  const result = await mod.startAdminServer({ port: PORT, host: HOST });
  closeServer = result.close;
  await waitForAdminHealth();
  return result.token;
}

function waitForAdminHealth(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tryOnce = () => {
      const req = http.get(`http://${HOST}:${PORT}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else schedule();
      });
      req.on('error', schedule);
      req.setTimeout(2000, () => {
        req.destroy();
        schedule();
      });
    };
    const schedule = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`管理 API 未就绪 (http://${HOST}:${PORT}/api/health)`));
        return;
      }
      setTimeout(tryOnce, 200);
    };
    tryOnce();
  });
}

function buildConsoleUrl(token) {
  const base = `http://${HOST}:${PORT}/`;
  if (!token) return base;
  return `${base}?token=${encodeURIComponent(token)}`;
}

function createWindow(adminToken) {
  const token = adminToken || readToken();
  const url = buildConsoleUrl(token);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    title: 'Bridge Console',
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.cjs'),
      additionalArguments: token ? [`--bridge-admin-token=${encodeURIComponent(token)}`] : [],
    },
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, desc, failedUrl) => {
    writeStartupLog(`did-fail-load code=${code} url=${failedUrl} desc=${desc}`);
    dialog.showErrorBox(
      'Bridge Console 页面加载失败',
      `${desc}\n${failedUrl}\n\n请确认已 build / pack，并查看 ~/.lark-channel/console-startup.log`,
    );
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 禁止 web 内链接再弹出第二个 Electron/Browser 窗口
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  try {
    const adminToken = await startAdminInProcess();
    createWindow(adminToken);
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('EADDRINUSE')) {
      failStartup(new Error(
        `端口 ${PORT} 已被占用（可能已有 Bridge Console 或 admin serve 在运行）。\n` +
          '请先关闭旧窗口/进程，或执行：taskkill /IM "Bridge Console.exe" /F',
      ));
      return;
    }
    failStartup(err);
  }
});

process.on('uncaughtException', (err) => {
  writeStartupLog(`uncaughtException: ${err?.stack || err}`);
  console.error('uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  writeStartupLog(`unhandledRejection: ${err?.stack || err}`);
  console.error('unhandledRejection:', err);
});

app.on('window-all-closed', () => {
  if (closeServer) closeServer().catch(() => {});
  app.quit();
});

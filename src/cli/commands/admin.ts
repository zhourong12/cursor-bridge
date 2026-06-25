import { spawn } from 'node:child_process';
import { startAdminServer } from '../../admin/server';

export interface AdminServeOptions {
  port?: number;
  host?: string;
  open?: boolean;
  rootDir?: string;
}

export async function runAdminServe(opts: AdminServeOptions = {}): Promise<void> {
  const { port, host, token, close } = await startAdminServer({
    port: opts.port,
    host: opts.host ?? '127.0.0.1',
    rootDir: opts.rootDir,
  });

  const url = `http://${host}:${port}`;
  console.log(`Bridge Console 已启动: ${url}`);
  console.log(`Admin Token: ${token}`);
  console.log('（Token 保存在 ~/.lark-channel/admin-token，或通过 LARK_BRIDGE_ADMIN_TOKEN 覆盖）');

  if (opts.open) {
    openBrowser(url);
    console.log('浏览器已打开；请在页面中粘贴上方 Admin Token。');
  }

  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => resolve());
    process.on('SIGTERM', () => resolve());
  });

  await close();
  console.log('Bridge Console 已停止');
}

export async function runAdminOpen(opts: { port?: number; host?: string } = {}): Promise<void> {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 3928;
  openBrowser(`http://${host}:${port}`);
}

function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

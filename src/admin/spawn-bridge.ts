import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { moduleDirname } from './module-dir';

function findNodeOnPath(): string | undefined {
  if (process.env.BRIDGE_NODE?.trim()) {
    const p = process.env.BRIDGE_NODE.trim();
    if (existsSync(p)) return p;
  }
  try {
    if (process.platform === 'win32') {
      const candidates = [
        join(process.env.ProgramFiles ?? '', 'nodejs', 'node.exe'),
        join(process.env['ProgramFiles(x86)'] ?? '', 'nodejs', 'node.exe'),
      ].filter((p) => p && existsSync(p));
      if (candidates[0]) return candidates[0];
      const out = execFileSync('where.exe', ['node'], { encoding: 'utf8' });
      return out.split(/\r?\n/).find((l) => l.trim())?.trim();
    }
    return execFileSync('which', ['node'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

export function bundledCliPath(): string {
  const env = process.env.BRIDGE_CLI_PATH?.trim();
  if (env) return env;
  const resources = process.env.BRIDGE_RESOURCES_PATH?.trim();
  if (resources) return join(resources, 'bridge', 'dist', 'cli.js');
  return join(moduleDirname(), 'cli.js');
}

/** Fleet 写操作：调系统 Node 跑完整 cli（避免 Electron 子进程 ESM 限制） */
export async function runBridgeCli(args: string[]): Promise<void> {
  const timeoutMs = args[0] === 'fleet' ? 180_000 : 120_000;
  const r = await runBridgeCliCapture(args, undefined, timeoutMs);
  if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || `cli exit ${r.code}`);
}

export async function runBridgeCliCapture(
  args: string[],
  envOverride?: NodeJS.ProcessEnv,
  timeoutMs = 120_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const node = findNodeOnPath();
  if (!node) {
    throw new Error('未找到 Node.js。Console 写操作需本机已安装 Node。');
  }
  const cli = bundledCliPath();
  const isDirect = args[0] === 'lark-cli';
  const argv = isDirect ? args.slice(1) : args;
  const cmd = isDirect ? 'lark-cli' : node;
  const cmdArgs = isDirect ? argv : [cli, ...argv];

  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...envOverride };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(cmd, cmdArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env,
      shell: isDirect && process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => { stdout += c; });
    child.stderr?.on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('cli timeout'));
    }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function runFleetStartCli(opts: { all?: boolean; profiles?: string[] }): Promise<void> {
  const args = ['fleet', 'start'];
  if (opts.profiles?.length) args.push('--profiles', opts.profiles.join(','));
  else if (opts.all) args.push('--all');
  await runBridgeCli(args);
}

export async function runFleetStopCli(opts: { all?: boolean; profiles?: string[] }): Promise<void> {
  const args = ['fleet', 'stop'];
  if (opts.all) args.push('--all');
  else if (opts.profiles?.length) args.push('--profiles', opts.profiles.join(','));
  else args.push('--all');
  await runBridgeCli(args);
}

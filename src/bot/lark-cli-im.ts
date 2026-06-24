import { basename, dirname, join, resolve } from 'node:path';
import { log } from '../core/logger';
import { mergeProcessEnv, spawnProcess } from '../platform/spawn';

const SEND_TIMEOUT_MS = 60_000;

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, '').trim()) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function runLarkCliSend(
  larkCliConfigDir: string,
  args: string[],
  cwd: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const env = mergeProcessEnv(process.env, {
    LARKSUITE_CLI_CONFIG_DIR: join(larkCliConfigDir, 'lark-channel'),
  });
  return new Promise((resolvePromise) => {
    const child = spawnProcess('lark-cli', args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolvePromise({ exitCode: null, stdout, stderr });
    }, SEND_TIMEOUT_MS);
    child.once('error', () => {
      clearTimeout(timer);
      resolvePromise({ exitCode: null, stdout, stderr });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, stdout, stderr });
    });
  });
}

/** Send image via lark-cli as bot (avoids user identity missing im:resource scopes). */
export async function sendLarkCliBotImage(opts: {
  larkCliConfigDir: string;
  chatId: string;
  imagePath: string;
}): Promise<boolean> {
  const abs = resolve(opts.imagePath);
  const cwd = dirname(abs);
  const relative = basename(abs);
  const result = await runLarkCliSend(
    opts.larkCliConfigDir,
    ['im', '+messages-send', '--as', 'bot', '--chat-id', opts.chatId, '--image', relative, '--json'],
    cwd,
  );
  const json = parseJsonObject(result.stdout);
  if (result.exitCode === 0 && json?.ok === true) {
    log.info('lark-cli-im', 'image-sent', { chatId: opts.chatId.slice(-6) });
    return true;
  }
  log.fail('lark-cli-im', new Error('bot image send failed'), {
    exitCode: result.exitCode,
    stdout: result.stdout.slice(0, 500),
    stderr: result.stderr.slice(0, 500),
  });
  return false;
}

/** Send markdown via lark-cli as bot. */
export async function sendLarkCliBotMarkdown(opts: {
  larkCliConfigDir: string;
  chatId: string;
  markdown: string;
  cwd?: string;
}): Promise<boolean> {
  const result = await runLarkCliSend(
    opts.larkCliConfigDir,
    ['im', '+messages-send', '--as', 'bot', '--chat-id', opts.chatId, '--markdown', opts.markdown, '--json'],
    opts.cwd ?? process.cwd(),
  );
  const json = parseJsonObject(result.stdout);
  if (result.exitCode === 0 && json?.ok === true) {
    log.info('lark-cli-im', 'markdown-sent', { chatId: opts.chatId.slice(-6) });
    return true;
  }
  log.fail('lark-cli-im', new Error('bot markdown send failed'), {
    exitCode: result.exitCode,
    stdout: result.stdout.slice(0, 500),
    stderr: result.stderr.slice(0, 500),
  });
  return false;
}

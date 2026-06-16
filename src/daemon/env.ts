export type DaemonExtraEnv = Record<string, string>;

export const DAEMON_ENV_PASSTHROUGH = [
  'CURSOR_API_KEY',
  'CURSOR_RUNTIME',
  'CURSOR_MACHINE_NAME',
  'CURSOR_MACHINE_DIRECTORY',
] as const;

export function collectDaemonExtraEnv(
  env: NodeJS.ProcessEnv = process.env,
  fallbackEnv: DaemonExtraEnv = {},
): DaemonExtraEnv {
  const extraEnv: DaemonExtraEnv = {};

  for (const name of DAEMON_ENV_PASSTHROUGH) {
    const value = env[name]?.trim() || fallbackEnv[name]?.trim();
    if (value) {
      extraEnv[name] = value;
    }
  }

  return extraEnv;
}

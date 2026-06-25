import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 当前模块目录。ESM 用 import.meta；admin-boot.cjs 由 tsup define 注入等价 URL */
export function moduleDirname(): string {
  return dirname(fileURLToPath(import.meta.url));
}

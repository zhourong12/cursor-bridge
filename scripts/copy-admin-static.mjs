import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'admin', 'static');
const dest = join(root, 'dist', 'admin', 'static');

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('copied admin static -> dist/admin/static');

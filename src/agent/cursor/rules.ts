import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface CursorRule {
  filename: string;
  body: string;
}

export async function loadAlwaysApplyCursorRules(cwd: string): Promise<string | undefined> {
  const rulesDir = join(cwd, '.cursor', 'rules');
  let entries: string[];
  try {
    entries = await readdir(rulesDir);
  } catch {
    return undefined;
  }

  const rules: CursorRule[] = [];
  for (const filename of entries.filter((entry) => entry.endsWith('.mdc')).sort()) {
    const content = await readFile(join(rulesDir, filename), 'utf8');
    const parsed = parseAlwaysApplyRule(filename, content);
    if (parsed) rules.push(parsed);
  }

  if (rules.length === 0) return undefined;
  return [
    '# Project Cursor Rules',
    '',
    'The following always-apply Cursor rules were loaded from the current project. Follow them before other generic approaches.',
    '',
    ...rules.flatMap((rule) => [`## ${rule.filename}`, '', rule.body]),
  ].join('\n');
}

function parseAlwaysApplyRule(filename: string, content: string): CursorRule | undefined {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return undefined;
  const frontmatter = match[1] ?? '';
  if (!/^alwaysApply:\s*true\s*$/m.test(frontmatter)) return undefined;

  const body = content.slice(match[0].length).trim();
  if (!body) return undefined;
  return { filename, body };
}

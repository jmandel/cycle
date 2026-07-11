import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const roots = ['site-gen/core', 'site-gen/chrome', 'site-gen/fhir'];
const banned = /\b(?:SiteBuildView|ResourceRow|PageRow|MenuRow|SqliteSiteBuildView)\b|bun:sqlite|compat\.site_db|siteDbJson|site\.db/;

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')
      ? [path]
      : [];
  });
}

test('renderer sources contain no database-shaped compatibility vocabulary', () => {
  const offenders = roots.flatMap(sourceFiles).filter((path) => banned.test(readFileSync(path, 'utf8')));
  expect(offenders).toEqual([]);
});

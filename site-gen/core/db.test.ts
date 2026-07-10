import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSiteBuildView } from './db';

test('SQLite adapter selects the explicit primary IG instead of row order', () => {
  const root = mkdtempSync(join(tmpdir(), 'cycle-site-db-'));
  const path = join(root, 'site.db');
  const db = new Database(path);
  db.exec('CREATE TABLE Resources (Key INTEGER, Type TEXT, Id TEXT, Web TEXT, Json BLOB)');
  const insert = db.prepare('INSERT INTO Resources VALUES (?, ?, ?, ?, ?)');
  insert.run(1, 'ImplementationGuide', 'aaa-example', 'ImplementationGuide-aaa-example.html', JSON.stringify({
    resourceType: 'ImplementationGuide', id: 'aaa-example',
  }));
  insert.run(2, 'ImplementationGuide', 'primary', 'index.html', JSON.stringify({
    resourceType: 'ImplementationGuide', id: 'primary', contact: [],
  }));
  db.close();

  const view = new SqliteSiteBuildView(path);
  try {
    expect(view.ig().id).toBe('primary');
  } finally {
    view.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

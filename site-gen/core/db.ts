/** SQLite-backed adapter for the renderer-neutral SiteBuildView contract. */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import type {
  MenuRow,
  PageRow,
  ResourceRow,
  SiteAsset,
  SiteBuildView,
} from './site-build';

export type { MenuRow, PageRow, ResourceRow, SiteAsset, SiteBuildView } from './site-build';

const TEXTUAL_MIME = (mime: string): boolean => {
  const value = String(mime || '').toLowerCase();
  return value.startsWith('text/')
    || value === 'image/svg+xml'
    || value === 'application/xml'
    || value === 'application/xhtml+xml';
};

function decode(content: unknown): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content as Uint8Array);
}

export class SqliteSiteBuildView implements SiteBuildView {
  readonly db: Database;

  constructor(readonly path: string) {
    if (!existsSync(path)) {
      throw new Error(`site DB not found at ${path}. Run ingest first: bun site-gen/ingest.ts (set SITE_DB to override).`);
    }
    this.db = new Database(path, { readonly: true });
  }

  metadata(): Record<string, string> {
    const rows = this.db.query('SELECT Name, Value FROM Metadata').all() as any[];
    return Object.fromEntries(rows.map((row) => [row.Name, row.Value]));
  }

  resources(type?: string): ResourceRow[] {
    return (type
      ? this.db.query('SELECT * FROM Resources WHERE Type = ? ORDER BY Id').all(type)
      : this.db.query('SELECT * FROM Resources ORDER BY Type, Id').all()) as ResourceRow[];
  }

  parse(row: ResourceRow): any {
    return JSON.parse(decode((row as any).Json));
  }

  valueSetCodes(url: string): { system: string; code: string; display?: string }[] {
    return this.db
      .query('SELECT System as system, Code as code, Display as display FROM ValueSet_Codes WHERE ValueSetUri = ? ORDER BY System, Code')
      .all(url) as any[];
  }

  concepts(resourceKey: number): { Key: number; ParentKey: number | null; Code: string; Display?: string; Definition?: string }[] {
    return this.db
      .query('SELECT Key, ParentKey, Code, Display, Definition FROM Concepts WHERE ResourceKey = ? ORDER BY Key')
      .all(resourceKey) as any[];
  }

  pages(): PageRow[] {
    return this.db.query('SELECT * FROM Pages ORDER BY Ord').all() as PageRow[];
  }

  menu(): MenuRow[] {
    return this.db.query('SELECT * FROM Menu ORDER BY Ord').all() as MenuRow[];
  }

  siteConfig(name: string): any {
    const row = this.db.query('SELECT Json FROM SiteConfig WHERE Name = ?').get(name) as any;
    return row ? JSON.parse(row.Json) : null;
  }

  textAsset(name: string): string | null {
    const row = this.db.query('SELECT Mime, Content FROM Assets WHERE Name = ?').get(name) as any;
    return row && TEXTUAL_MIME(row.Mime) ? decode(row.Content) : null;
  }

  assets(): SiteAsset[] {
    return this.db.query('SELECT Name, Mime, Content FROM Assets').all() as SiteAsset[];
  }

  ig(): any {
    const row = this.db.query("SELECT Json FROM Resources WHERE Type='ImplementationGuide'").get() as any;
    if (!row) throw new Error('no ImplementationGuide row in site.db');
    const ig = JSON.parse(decode(row.Json));
    ig.contact = (ig.contact || []).map((contact: any) => ({
      ...contact,
      telecom: (contact.telecom || []).map((telecom: any) => telecom.value ?? telecom),
    }));
    return ig;
  }
}

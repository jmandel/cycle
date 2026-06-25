/**
 * db.ts — typed reader over the IG Publisher's output/package.db.
 * The Publisher does all FHIR computation (snapshots, expansions, validation)
 * and writes structured results here; we render from it. No Jekyll, no HTML.
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';

// Single source of truth: the working site.db that ingest.ts produces
// (package.db augmented with Pages/Menu/Assets). No silent fallback — a missing
// DB must fail loudly, never render a stale one.
const DB_PATH = process.env.SITE_DB || 'temp/site-gen/site.db';
if (!existsSync(DB_PATH)) {
  throw new Error(`site DB not found at ${DB_PATH}. Run ingest first: bun site-gen/ingest.ts (set SITE_DB to override).`);
}
const db = new Database(DB_PATH, { readonly: true });

export interface ResourceRow {
  Key: number;
  Type: string;
  Id: string;
  Url?: string;
  Version?: string;
  Status?: string;
  Date?: string;
  Name?: string;
  Title?: string;
  Description?: string;
  derivation?: string;
  standardStatus?: string;
  kind?: string;
  sdType?: string;
  base?: string;
  content?: string;
  Json: string;
}

export function metadata(): Record<string, string> {
  const rows = db.query('SELECT Name, Value FROM Metadata').all() as any[];
  return Object.fromEntries(rows.map((r) => [r.Name, r.Value]));
}

export function resources(type?: string): ResourceRow[] {
  return (type
    ? db.query('SELECT * FROM Resources WHERE Type = ? ORDER BY Id').all(type)
    : db.query('SELECT * FROM Resources ORDER BY Type, Id').all()) as ResourceRow[];
}

export function parse(r: ResourceRow): any {
  const j: any = (r as any).Json;
  const s = typeof j === 'string' ? j : new TextDecoder().decode(j);
  return JSON.parse(s);
}

/** ValueSet expansion codes for a value set canonical URL. */
export function valueSetCodes(url: string): { system: string; code: string; display?: string }[] {
  return db
    .query('SELECT System as system, Code as code, Display as display FROM ValueSet_Codes WHERE ValueSetUri = ? ORDER BY System, Code')
    .all(url) as any[];
}

/** CodeSystem concepts (flat; ParentKey gives hierarchy) for a resource key. */
export function concepts(resourceKey: number): { Key: number; ParentKey: number | null; Code: string; Display?: string; Definition?: string }[] {
  return db
    .query('SELECT Key, ParentKey, Code, Display, Definition FROM Concepts WHERE ResourceKey = ? ORDER BY Key')
    .all(resourceKey) as any[];
}

// ---- ingested site content (from ingest.ts; single source of truth) ----
export interface PageRow { Slug: string; NameUrl: string; Title: string; Generation: string; Ord: number; Depth: number; Body: string | null }
export interface MenuRow { Id: number; ParentId: number | null; Ord: number; Depth: number; Path: string; Label: string; Href: string | null; Kind: string }

export function pages(): PageRow[] {
  return db.query('SELECT * FROM Pages ORDER BY Ord').all() as PageRow[];
}
export function menu(): MenuRow[] {
  return db.query('SELECT * FROM Menu ORDER BY Ord').all() as MenuRow[];
}
export function siteConfig(name: string): any {
  const r = db.query('SELECT Json FROM SiteConfig WHERE Name = ?').get(name) as any;
  if (!r) return null;
  return JSON.parse(r.Json);
}
export function asset(name: string): string | null {
  const r = db.query('SELECT Content FROM Assets WHERE Name = ?').get(name) as any;
  if (!r) return null;
  return typeof r.Content === 'string' ? r.Content : new TextDecoder().decode(r.Content);
}
/** All ingested assets (text or binary) to write out verbatim. */
export function assets(): { Name: string; Mime: string; Content: string | Uint8Array }[] {
  return db.query('SELECT Name, Mime, Content FROM Assets').all() as any[];
}
/** The ImplementationGuide resource (parsed), with contact telecom flattened to value strings. */
export function ig(): any {
  const r = db.query("SELECT Json FROM Resources WHERE Type='ImplementationGuide'").get() as any;
  const o = JSON.parse(typeof r.Json === 'string' ? r.Json : new TextDecoder().decode(r.Json));
  o.contact = (o.contact || []).map((c: any) => ({ ...c, telecom: (c.telecom || []).map((t: any) => t.value ?? t) }));
  return o;
}

export { db };

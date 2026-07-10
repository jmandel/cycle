/**
 * Callback-free semantic view consumed by the Cycle renderer.
 *
 * This is the TypeScript-facing view of Cycle's aggregate compatibility
 * artifact. It is intentionally independent of SQLite, Bun, the filesystem,
 * and the editor's RowStore. The browser constructs it only after validating a
 * ClosedSiteBuild. `SqliteSiteBuildView` is an explicitly selected legacy
 * native adapter; the preferred native path consumes the proof-bearing Fig
 * bundle through `JsonSiteBuildView`, just like the browser.
 */

export interface ResourceRow {
  Key: number;
  Type: string;
  Custom?: number;
  Id: string;
  Web?: string;
  Url?: string | null;
  Version?: string | null;
  Status?: string | null;
  Date?: string | null;
  Name?: string | null;
  Title?: string | null;
  Description?: string | null;
  derivation?: string | null;
  standardStatus?: string | null;
  kind?: string | null;
  sdType?: string | null;
  base?: string | null;
  content?: string | null;
  supplements?: string | null;
  Json: string;
}

export interface PageRow {
  Slug: string;
  NameUrl: string;
  Title: string;
  Generation: string;
  Ord: number;
  Depth: number;
  Body: string | null;
}

export interface MenuRow {
  Id: number;
  ParentId: number | null;
  Ord: number;
  Depth: number;
  Path: string;
  Label: string;
  Href: string | null;
  Kind: string;
}

export interface SiteAsset {
  Name: string;
  Mime: string;
  Content: string | Uint8Array;
}

export interface SiteBuildView {
  metadata(): Record<string, string>;
  resources(type?: string): ResourceRow[];
  parse(row: ResourceRow): any;
  valueSetCodes(url: string): { system: string; code: string; display?: string }[];
  concepts(resourceKey: number): {
    Key: number;
    ParentKey: number | null;
    Code: string;
    Display?: string;
    Definition?: string;
  }[];
  pages(): PageRow[];
  menu(): MenuRow[];
  siteConfig(name: string): any;
  textAsset(name: string): string | null;
  assets(): SiteAsset[];
  ig(): any;
}

/** The external Cycle renderer's closed requirement. A conforming host must
 * prove this ready before constructing the view; rendering never calls back
 * into a compiler or fragment engine to fill it lazily. */
export const CYCLE_SITE_DB_ARTIFACT = Object.freeze({
  kind: 'data',
  namespace: 'compat.site_db',
  name: 'rows.json',
} as const);

export const CYCLE_RENDER_PLAN = Object.freeze({
  id: 'cycle-site/v1',
  // The compatibility projection is deliberately one aggregate artifact. Its
  // manifest read-set points to the exact authored sources and package closure;
  // do not pretend its internal row groups are independently addressable
  // SiteBuild artifacts until the producer actually emits them that way.
  requiredArtifacts: Object.freeze([CYCLE_SITE_DB_ARTIFACT]),
});

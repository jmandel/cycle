import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

export type Json = Record<string, any>;

export const IMPLEMENTATION_GUIDE_RESOURCE_FORMAT_URL = 'http://hl7.org/fhir/tools/StructureDefinition/implementationguide-resource-format';

function scalarString(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return null;
}

function extensionValue(resource: Json | undefined, url: string, field: string): unknown {
  return (resource?.extension || []).find((e: any) => e.url === url)?.[field];
}

export function manifestResourceFormat(meta: Json | undefined): string | null {
  return scalarString(extensionValue(meta, IMPLEMENTATION_GUIDE_RESOURCE_FORMAT_URL, 'valueCode'));
}

function contentTypeForPath(path: string): string {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.xml')) return 'application/fhir+xml';
  return 'application/octet-stream';
}

function fileStem(path: string): string {
  return basename(path, extname(path));
}

export function binaryResourceFromManifestReference(
  reference: string,
  meta: Json | undefined,
  inputResourceFiles: string[],
): Json | null {
  if (!reference.startsWith('Binary/')) return null;
  const id = reference.slice('Binary/'.length);
  if (!id) return null;
  const source = inputResourceFiles.find((file) => fileStem(file) === id);
  if (!source) return null;
  return {
    resourceType: 'Binary',
    id,
    contentType: manifestResourceFormat(meta) || contentTypeForPath(source),
    data: readFileSync(source).toString('base64'),
  };
}

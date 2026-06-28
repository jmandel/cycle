import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { binaryResourceFromManifestReference, IMPLEMENTATION_GUIDE_RESOURCE_FORMAT_URL, manifestResourceFormat } from './manifest-binary';

describe('manifest-declared Binary resources', () => {
  test('wraps raw input files as FHIR Binary resources', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-gen-binary-'));
    try {
      const file = join(dir, 'Payload.json');
      writeFileSync(file, '{"hello":"world"}\n');
      const meta = {
        extension: [
          {
            url: IMPLEMENTATION_GUIDE_RESOURCE_FORMAT_URL,
            valueCode: 'application/json',
          },
        ],
      };

      expect(manifestResourceFormat(meta)).toBe('application/json');
      expect(binaryResourceFromManifestReference('Binary/Payload', meta, [file])).toEqual({
        resourceType: 'Binary',
        id: 'Payload',
        contentType: 'application/json',
        data: Buffer.from('{"hello":"world"}\n').toString('base64'),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ignores non-Binary references and missing files', () => {
    expect(binaryResourceFromManifestReference('Observation/Payload', undefined, [])).toBeNull();
    expect(binaryResourceFromManifestReference('Binary/Payload', undefined, [])).toBeNull();
  });
});

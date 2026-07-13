import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { ContentOutputNamespace } from './content-output-namespace';
import type { WritableContentStore } from './closed-build';
import type { ContentRef, SiteOutput } from './output-receipt';

class MemoryStore implements WritableContentStore {
  readonly values = new Map<string, Uint8Array>();
  puts = 0;

  async get(reference: ContentRef): Promise<Uint8Array | null> {
    const value = this.values.get(reference.sha256);
    return value ? new Uint8Array(value) : null;
  }

  async put(bytes: Uint8Array, mediaType: string): Promise<ContentRef & { mediaType: string }> {
    this.puts++;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    this.values.set(sha256, new Uint8Array(bytes));
    return { sha256, byteLength: bytes.byteLength, mediaType };
  }
}

function base(store: MemoryStore): SiteOutput {
  const bytes = new TextEncoder().encode('base');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  store.values.set(sha256, bytes);
  return {
    schemaVersion: 'site-output/v1',
    inputBuildId: `sb1-sha256:${'a'.repeat(64)}`,
    renderer: { id: 'cycle-site', version: '1', recipeSha256: 'b'.repeat(64) },
    outputSchema: 'cycle-static-site/v1',
    options: {},
    files: [{
      path: 'index.html',
      content: { sha256, byteLength: bytes.byteLength, mediaType: 'text/html' },
      producer: { id: 'cycle-site', version: '1' },
    }],
    outputId: `so1-sha256:${'c'.repeat(64)}`,
  };
}

describe('ContentOutputNamespace', () => {
  test('inherits references without copying bytes and requires explicit replacement', async () => {
    const store = new MemoryStore();
    const namespace = ContentOutputNamespace.inherit({ receipt: base(store), store });
    expect(store.puts).toBe(0);
    expect(new TextDecoder().decode(await namespace.read('index.html'))).toBe('base');
    await expect(namespace.add({
      path: 'index.html', mediaType: 'text/html', producer: { id: 'wrapper', version: '1' },
    }, 'collision')).rejects.toThrow('collision');
    await namespace.replace('index.html', {
      path: 'index.html', mediaType: 'text/html', producer: { id: 'wrapper', version: '1' },
    }, 'replacement');
    expect(store.puts).toBe(1);
    expect(new TextDecoder().decode(await namespace.read('index.html'))).toBe('replacement');
  });

  test('sorts completed files and rejects missing owners', async () => {
    const store = new MemoryStore();
    const namespace = ContentOutputNamespace.inherit({ receipt: base(store), store });
    await namespace.add({
      path: 'z.txt', mediaType: 'text/plain', producer: { id: 'wrapper', version: '1' }, owner: 'missing.html',
    }, 'z');
    expect(() => namespace.completedFiles()).toThrow("names missing owner 'missing.html'");
  });
});

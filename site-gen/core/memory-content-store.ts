import type { ContentRef, WritableContentStore } from './closed-build';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Small verified ContentStore adapter for tests and embedded native callers. */
export class MemoryContentStore implements WritableContentStore {
  private readonly objects = new Map<string, Uint8Array>();

  async get(content: ContentRef): Promise<Uint8Array | null> {
    const bytes = this.objects.get(content.sha256);
    if (!bytes || bytes.byteLength !== content.byteLength) return null;
    if (await sha256(bytes) !== content.sha256) return null;
    return bytes.slice();
  }

  async put(bytes: Uint8Array, mediaType: string): Promise<ContentRef & { mediaType: string }> {
    const copy = bytes.slice();
    const content: ContentRef & { mediaType: string } = {
      sha256: await sha256(copy),
      byteLength: copy.byteLength,
      mediaType,
    };
    this.objects.set(content.sha256, copy);
    return content;
  }
}

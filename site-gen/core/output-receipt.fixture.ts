import type { CycleOutputReceipt } from './output-receipt';

/** Canonical SiteOutput and bytes emitted by the independent Rust fixture. */
export const RUST_SITE_OUTPUT_BYTES = new TextEncoder().encode('hello');

export const RUST_SITE_OUTPUT_RECEIPT: CycleOutputReceipt = {
  schemaVersion: 'site-output/v1',
  inputBuildId: 'sb1-sha256:5eb1101c55a13f90a6af2ef851eb32705b663caf669dc8b596baad690f15495d',
  renderer: {
    id: 'cycle-site',
    version: '1.0.0',
    recipeSha256: 'e1d8e552330911f9f779f85b6f2c00a15e790dcc3fbb3b28f5da1d660a30c5b8',
  },
  outputSchema: 'static-site/v1',
  options: { locale: 'en' },
  cacheKey: 'sok1-sha256:52a6568c5df7d5db15d43a1c5c1ce4eb0a64cffad5f4c2dc53ba09335180af2b',
  files: [{
    path: 'index.html',
    content: {
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      byteLength: 5,
      mediaType: 'text/html',
    },
    producer: { id: 'cycle-page', version: '1' },
    source: 'page recipe',
  }],
  outputId: 'so1-sha256:5c395c8bde04a11939c040de1bb920dc720db9e859453dea647560b46b18f0c1',
};

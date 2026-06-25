/**
 * registry.ts — components that hydrate on the client. Names here MUST match the
 * `name` passed to <Island> on the server. Keep these browser-safe (no node/db imports).
 */
import type React from 'react';
import { CodeBlock } from '../ds/CodeBlock.jsx';

export const ISLANDS: Record<string, React.ComponentType<any>> = {
  CodeBlock,
};

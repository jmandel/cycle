import React from 'react';

/**
 * Island — isomorphic boundary. SSR renders the component's full output inside
 * the marker (so JS-disabled users get complete content); the client entry finds
 * `[data-island]`, reads the serialized props, and hydrates the SAME component —
 * unlocking its full React behaviour. Props MUST be JSON-serializable.
 */
export function Island<P extends object>({
  name, component: C, props,
}: { name: string; component: React.ComponentType<P>; props: P }) {
  return (
    <div data-island={name} data-props={JSON.stringify(props)} style={{ display: 'contents' }}>
      <C {...props} />
    </div>
  );
}

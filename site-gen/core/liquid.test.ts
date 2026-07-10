import { describe, expect, test } from 'bun:test';
import { renderLiquid } from './liquid';

describe('renderLiquid', () => {
  test('renders Publisher fragment tags preserved by raw blocks', () => {
    const rendered = renderLiquid('{% raw %}{% fragment Binary/CRDServices JSON BASE:services %}{% endraw %}', {
      includes: {},
      ig: {},
      fragment: (args) => `<pre>${args}</pre>`,
    });

    expect(rendered).toBe('<pre>Binary/CRDServices JSON BASE:services</pre>');
  });

  test('keeps non-fragment raw handlebars literal', () => {
    const rendered = renderLiquid('{% raw %}{{context.patientId}}{% endraw %}', {
      includes: {},
      ig: {},
    });

    expect(rendered).toBe('{{context.patientId}}');
  });

  test('fails loudly on SQL when a portable host supplies no capability', () => {
    expect(() => renderLiquid('{% sql SELECT Name FROM Metadata %}', {
      includes: {},
      ig: {},
    })).toThrow('SQL tag used, but no SQL executor was provided');
  });
});

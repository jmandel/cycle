import { describe, expect, test } from 'bun:test';
import { renderResourceFragment } from './fragments';

function binaryJson(id: string, payload: unknown) {
  return {
    resourceType: 'Binary',
    id,
    contentType: 'application/json',
    data: btoa(JSON.stringify(payload)),
  };
}

describe('Publisher-style resource fragments', () => {
  test('renders JSON fragments from Binary JSON payloads with Publisher EXCEPT selectors', () => {
    const resources = new Map<string, any>([
      ['Binary/Services', binaryJson('Services', {
        services: [
          { hook: 'appointment-book', title: 'Book', prefetch: { patient: 'Patient/1' } },
          { hook: 'order-sign', title: 'Sign', prefetch: { coverage: 'Coverage/1' } },
        ],
      })],
    ]);

    const html = renderResourceFragment(
      'Binary/Services JSON EXCEPT:services.where(hook=\'order-sign\')',
      (type, id) => resources.get(`${type}/${id}`) || null,
    );

    expect(html).toContain('language-json');
    expect(html).toContain('&quot;title&quot;: &quot;Sign&quot;');
    expect(html).not.toContain('appointment-book');
  });

  test('renders selected FHIR child fragments as JSON and XML', () => {
    const questionnaire = {
      resourceType: 'Questionnaire',
      id: 'q',
      item: [
        { linkId: '1.1', text: 'First', type: 'string' },
        { linkId: '1.2', text: 'Second', type: 'boolean' },
      ],
    };
    const resolve = (type: string, id: string) => type === 'Questionnaire' && id === 'q' ? questionnaire : null;

    const json = renderResourceFragment('Questionnaire/q JSON BASE:descendants().select(item).where(linkId=\'1.2\')', resolve);
    expect(json).toContain('&quot;linkId&quot;: &quot;1.2&quot;');
    expect(json).not.toContain('&quot;linkId&quot;: &quot;1.1&quot;');

    const xml = renderResourceFragment('Questionnaire/q XML BASE:descendants().select(item).where(linkId=\'1.2\')', resolve);
    expect(xml).toContain('language-xml');
    expect(xml).toContain('&lt;item&gt;');
    expect(xml).toContain('&lt;linkId value=&quot;1.2&quot;');
  });

  test('evaluates FHIRPath ofType selectors with the configured FHIR model', () => {
    const response = {
      resourceType: 'QuestionnaireResponse',
      id: 'qr',
      contained: [
        { resourceType: 'Questionnaire', id: 'q', status: 'active' },
        { resourceType: 'Patient', id: 'p' },
      ],
      questionnaire: '#q',
      status: 'in-progress',
    };
    const html = renderResourceFragment(
      'QuestionnaireResponse/qr JSON EXCEPT:contained.ofType(Questionnaire)|questionnaire|status EXCEPT:id BASE:contained',
      (type, id) => type === 'QuestionnaireResponse' && id === 'qr' ? response : null,
      { fhirVersion: '4.0.1' },
    );

    expect(html).toContain('&quot;questionnaire&quot;: &quot;#q&quot;');
    expect(html).toContain('&quot;status&quot;: &quot;in-progress&quot;');
    expect(html).toContain('&quot;id&quot;: &quot;q&quot;');
    expect(html).not.toContain('&quot;resourceType&quot;: &quot;Patient&quot;');
    expect(html).not.toContain('&quot;id&quot;: &quot;p&quot;');
  });

  test('requires top-level BASE fragments to identify one node', () => {
    const questionnaire = {
      resourceType: 'Questionnaire',
      id: 'q',
      item: [
        { linkId: '1.1', text: 'First', type: 'string' },
        { linkId: '1.2', text: 'Second', type: 'boolean' },
      ],
    };
    const resolve = (type: string, id: string) => type === 'Questionnaire' && id === 'q' ? questionnaire : null;

    expect(() => renderResourceFragment('Questionnaire/q JSON BASE:item', resolve))
      .toThrow(/matched 2 elements/);
  });
});

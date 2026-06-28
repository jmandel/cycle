import { describe, expect, test } from 'bun:test';
import { parseFhirXmlResource } from './fhir-xml';

describe('FHIR XML resource parsing', () => {
  test('converts primitive value attributes and repeated elements to FHIR JSON', () => {
    const resource = parseFhirXmlResource(`
      <Questionnaire xmlns="http://hl7.org/fhir">
        <id value="trivia-questionnaire"/>
        <status value="draft"/>
        <item>
          <linkId value="1"/>
          <type value="string"/>
        </item>
        <item>
          <linkId value="2"/>
          <type value="integer"/>
        </item>
      </Questionnaire>
    `);

    expect(resource).toEqual({
      resourceType: 'Questionnaire',
      id: 'trivia-questionnaire',
      status: 'draft',
      item: [
        { linkId: '1', type: 'string' },
        { linkId: '2', type: 'integer' },
      ],
    });
  });

  test('preserves extension URLs, primitive extensions, and typed values', () => {
    const resource = parseFhirXmlResource(`
      <Procedure xmlns="http://hl7.org/fhir">
        <id value="p1"/>
        <performedDateTime>
          <extension url="http://hl7.org/fhir/StructureDefinition/data-absent-reason">
            <valueCode value="unknown"/>
          </extension>
        </performedDateTime>
        <focalDevice>
          <action>
            <coding>
              <system value="http://example.org"/>
              <code value="x"/>
            </coding>
          </action>
        </focalDevice>
      </Procedure>
    `);

    expect(resource).toMatchObject({
      resourceType: 'Procedure',
      id: 'p1',
      _performedDateTime: {
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
            valueCode: 'unknown',
          },
        ],
      },
      focalDevice: [
        {
          action: {
            coding: [
              {
                system: 'http://example.org',
                code: 'x',
              },
            ],
          },
        },
      ],
    });
    expect(resource.performedDateTime).toBeUndefined();
  });

  test('serializes XHTML narrative divs and unwraps resource containers', () => {
    const resource = parseFhirXmlResource(`
      <Bundle xmlns="http://hl7.org/fhir">
        <id value="b1"/>
        <type value="collection"/>
        <entry>
          <resource>
            <Patient>
              <id value="p1"/>
              <text>
                <status value="generated"/>
                <div xmlns="http://www.w3.org/1999/xhtml"><p>Example &amp; text</p></div>
              </text>
            </Patient>
          </resource>
        </entry>
      </Bundle>
    `);

    expect(resource.entry[0].resource).toEqual({
      resourceType: 'Patient',
      id: 'p1',
      text: {
        status: 'generated',
        div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>Example &amp; text</p></div>',
      },
    });
  });
});

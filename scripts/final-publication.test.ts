import { expect, test } from 'bun:test';
import {
  mediaTypeForOutput,
} from './final-publication';

test('wrapper media types cover every project extra class', () => {
  expect(mediaTypeForOutput('view.html')).toBe('text/html');
  expect(mediaTypeForOutput('view-assets/app.js')).toBe('text/javascript');
  expect(mediaTypeForOutput('package-list.json')).toBe('application/json');
  expect(mediaTypeForOutput('skill.zip')).toBe('application/zip');
  expect(mediaTypeForOutput('fragment-usage-analysis.csv')).toBe('text/csv');
  expect(mediaTypeForOutput('example.jwe')).toBe('application/octet-stream');
});

/**
 * Generate spesifikasi OpenAPI dari skema zod.
 *
 * Zod adalah sumber kebenaran; OpenAPI adalah turunan. Jangan pernah
 * menyunting berkas hasil generate ini secara manual.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as contracts from '../src/index.js';

const schemas: Record<string, unknown> = {};

for (const [name, value] of Object.entries(contracts)) {
  if (name.endsWith('Schema') && value && typeof (value as { safeParse?: unknown }).safeParse === 'function') {
    schemas[name.replace(/Schema$/, '')] = zodToJsonSchema(value as never, { target: 'openApi3' });
  }
}

const doc = {
  openapi: '3.1.0',
  info: { title: 'Pesona SuperApp API', version: '0.0.0' },
  paths: {},
  components: { schemas },
};

mkdirSync('dist', { recursive: true });
writeFileSync('dist/openapi.json', JSON.stringify(doc, null, 2));
console.warn(`OpenAPI ditulis: ${Object.keys(schemas).length} skema`);

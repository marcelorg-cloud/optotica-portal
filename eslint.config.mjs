import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'migration-output/**',
    'scripts/extract-valid-orders.js',
    'optotica-core/professional-patient-sync.js'
  ])
]);

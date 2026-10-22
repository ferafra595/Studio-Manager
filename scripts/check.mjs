import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const html = readFileSync('public/index.html', 'utf8');
assert.match(html, /DEMO2026/);
assert.match(html, /NON|non/i);
assert.match(html, /<html lang="it">/);
console.log('Controlli statici di base superati. Non equivalgono a test funzionali o di sicurezza.');

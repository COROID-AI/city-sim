// Dependency-free verification for index.html.
//
// Asserts that the page is a standalone HTML5 document whose body contains the
// visible text "hello world". Run with: node verify.mjs
//
// Exits 0 on success; exits 1 with a clear message on the first failed check.

import { readFileSync } from 'node:fs';

const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

let html;
try {
  html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
} catch (error) {
  console.error(`FAIL: could not read index.html: ${error.message}`);
  process.exit(1);
}

check(/^\s*<!DOCTYPE html>/i.test(html), 'document must start with an HTML5 doctype');
check(/<html[\s>]/i.test(html), 'document must contain an <html> element');
check(/<head[\s>]/i.test(html), 'document must contain a <head> element');
check(/<meta[^>]*charset=/i.test(html), '<head> must declare a charset via <meta charset>');

const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
check(bodyMatch !== null, 'document must contain a <body> element');

if (bodyMatch !== null) {
  const bodyText = bodyMatch[1].replace(/<[^>]*>/g, ' ');
  check(
    bodyText.includes('hello world'),
    'document body must contain the text "hello world"',
  );
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure}`);
  }
  process.exit(1);
}

console.log('PASS: index.html is a standalone HTML5 document containing "hello world".');

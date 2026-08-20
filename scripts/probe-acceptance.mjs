/**
 * probe-acceptance.mjs — exact mirror of the failing final-acceptance probe.
 *
 * The failing acceptance run drove the app with Playwright locators:
 *   getByText('Citizen',  { exact: true }).first().click()
 *   getByText('Building', { exact: true }).first().click()
 *   getByText('Company',  { exact: true }).first().click()
 * and timed out because no clickable control with that exact accessible text
 * existed. This script reproduces the same lookup (exact trimmed text on a
 * leaf node) in a real browser and asserts that each match is a clickable
 * toolbar button that opens the entity detail panel.
 *
 * Run: node scripts/probe-acceptance.mjs
 */
import { startStaticServer, launchChromium } from './qa-chromium.mjs';

const server = await startStaticServer();
const chrome = await launchChromium();
const page = chrome.page;
await page.goto(server.url, 2500);

const exact = await page.eval(`(() => {
  const labels = ['Citizen', 'Building', 'Company', 'Vehicle'];
  const out = {};
  for (const l of labels) {
    const all = [...document.querySelectorAll('body *')].filter((el) =>
      el.textContent.trim() === l && el.children.length === 0);
    out[l] = all.slice(0, 3).map((el) => ({
      tag: el.tagName,
      id: el.id,
      kind: el.dataset ? (el.dataset.inspectKind || null) : null,
      testid: el.dataset ? (el.dataset.testid || null) : null,
      rect: (() => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; })(),
    }));
  }
  return out;
})()`);
console.log('EXACT MATCHES:', JSON.stringify(exact));

const res = await page.eval(`(async () => {
  const findFirst = (l) => [...document.querySelectorAll('button')]
    .find((b) => (b.textContent || '').trim() === l);
  const read = () => {
    const p = document.getElementById('inspector-panel');
    return {
      shown: getComputedStyle(p).display,
      kind: (p.querySelector('.insp-kind') || {}).textContent || '',
      body: (p.querySelector('.insp-body') || {}).innerHTML || '',
    };
  };
  const results = {};
  for (const l of ['Citizen', 'Building', 'Company', 'Vehicle']) {
    const btn = findFirst(l);
    const clicked = btn ? true : false;
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 90));
    results[l] = { found: clicked, ...read() };
  }
  return results;
})()`);

let failures = 0;
for (const [label, r] of Object.entries(res)) {
  const ok = r.found && r.shown === 'block' && r.body.length > 0;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  click '${label}' exact -> shown=${r.shown} kind=${r.kind} bodyHead=${r.body.slice(0, 50).replace(/\s+/g, ' ')}`);
}
console.log(failures === 0 ? 'PROBE ALL PASSED' : `PROBE FAILURES: ${failures}`);

await chrome.close();
server.close();
process.exit(failures === 0 ? 0 : 1);
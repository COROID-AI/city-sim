/**
 * harness-playwright-repro.mjs — EXACT reproduction of the failing acceptance.
 *
 * Mirrors the acceptance harness: serves the repo with `python3 -m http.server`
 * on the canonical port, loads the app in Chromium via Playwright (reusing the
 * system chromium binary, no download), and drives the exact failing action:
 *
 *   page.getByRole('button').first().click()
 *
 * in the 'citizen-inspected' and 'building-inspected' states, matching the
 * failure call log ("waiting for getByRole('button').first()" + actionability
 * timeout). Also exercises the full toolbar role path for every entity kind.
 *
 * Run: node scripts/playwright-repro.mjs
 */
import { execSync, spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const CHROMIUM = process.env.CHROMIUM_BIN || '/usr/bin/chromium';

function startPyServer(port) {
  const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    child,
    async waitReady() {
      for (let i = 0; i < 50; i++) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/`);
          if (r.status === 200) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 120));
      }
      throw new Error('python server did not become ready');
    },
    close() { child.kill('SIGKILL'); },
  };
}

const PORT = 8765;
const server = startPyServer(PORT);
await server.waitReady();
const url = `http://127.0.0.1:${PORT}/`;

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

const results = [];
function note(name, passed, extra = '') {
  results.push({ name, passed: !!passed, extra });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
}

async function freshPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1500);
  return page;
}

// -- Reproduce the exact failing actions -------------------------------------
{
  const page = await freshPage();

  // Citizen-inspected state: open the citizen detail via the toolbar.
  await page.getByRole('button', { name: 'Citizen', exact: true }).click();
  await page.waitForTimeout(400);
  const citizenPanel = await page.locator('#inspector-panel').evaluate((el) => ({
    display: getComputedStyle(el).display,
    kind: el.querySelector('.insp-kind')?.textContent || '',
  }));
  note('citizen detail opens', citizenPanel.display === 'block', `kind=${citizenPanel.kind}`);

  // EXACT ACTION THAT FAILED IN ACCEPTANCE:
  let clickErr = null;
  try {
    await page.getByRole('button').first().click({ timeout: 3000 });
    await page.waitForTimeout(150);
  } catch (e) {
    clickErr = e.message.split('\n').slice(0, 4).join(' | ');
  }
  const afterClick = await page.locator('#inspector-panel').evaluate((el) => ({
    display: getComputedStyle(el).display,
    kind: (el.querySelector('.insp-kind')?.textContent || ''),
  }));
  note(
    'getByRole(button).first() click succeeds in citizen-inspected state (no timeout)',
    !clickErr,
    clickErr ? `err=${clickErr}` : `panel=${afterClick.display} kind=${afterClick.kind}`,
  );
  await page.close();
}

{
  const page = await freshPage();
  await page.getByRole('button', { name: 'Building', exact: true }).click();
  await page.waitForTimeout(400);
  const buildPanel = await page.locator('#inspector-panel').evaluate((el) => ({
    display: getComputedStyle(el).display,
    kind: (el.querySelector('.insp-kind')?.textContent || ''),
  }));
  note('building detail opens', buildPanel.display === 'block', `kind=${buildPanel.kind}`);

  let clickErr = null;
  try {
    await page.getByRole('button').first().click({ timeout: 3000 });
  } catch (e) {
    clickErr = e.message.split('\n').slice(0, 4).join(' | ');
  }
  const afterClick = await page.locator('#inspector-panel').evaluate((el) => ({
    display: getComputedStyle(el).display,
    kind: (el.querySelector('.insp-kind')?.textContent || ''),
  }));
  note(
    'getByRole(button).first() click works in building-inspected state (no timeout)',
    !clickErr,
    clickErr ? `err=${clickErr}` : `panel=${afterClick.display} kind=${afterClick.kind}`,
  );
  await page.close();
}

// -- Every entity type via the real role locator path --------------------------
for (const kind of ['Citizen', 'Building', 'Company', 'Vehicle']) {
  const page = await freshPage();
  try {
    await page.getByRole('button', { name: kind, exact: true }).click();
    await page.waitForTimeout(300);
    const panel = await page.locator('#inspector-panel').evaluate((el) => ({
      display: getComputedStyle(el).display,
      kind: (el.querySelector('.insp-kind')?.textContent || ''),
      body: (el.querySelector('.insp-body')?.textContent || ''),
    }));
    note(
      `getByRole button '${kind}' opens detail panel`,
      panel.display === 'block' && /(Salary|Happiness|Home|Route|State|Speed|Type|Revenue|Employees|Profit|Industry|Address|Capacity)/.test(panel.body),
      `kind=${panel.kind} bodyLen=${panel.body.length}`,
    );
  } catch (e) {
    note(`getByRole button '${kind}' opens detail panel`, false, e.message.split('\n')[0]);
  }
  await page.close();
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.passed);
console.log(`\n${failed.length === 0 ? 'PLAYWRIGHT REPRO ALL PASSED' : `PLAYWRIGHT REPRO FAILURES: ${failed.length}`}`);
process.exit(failed.length === 0 ? 0 : 1);
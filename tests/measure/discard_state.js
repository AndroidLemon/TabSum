#!/usr/bin/env node
/**
 * Measurement script: does chrome.tabs.discard() (the soft-suspend path in
 * service-worker.js's processTabArchival, ~line 500-530) lose unsaved typed
 * state that checkIsDirty would otherwise have caught and aborted on?
 *
 * Sequence per case:
 *   1. Serve a local page with a <form> (text input + textarea) and a bare
 *      contenteditable div.
 *   2. Type distinct text into each with Playwright (real keyboard events,
 *      so the browser's own form-restore heuristics see real user input).
 *   3. From the background page: chrome.tabs.discard(tabId).
 *   4. Wait for tabs.get(id).discarded === true.
 *   5. chrome.tabs.update(id, { active: true }) and wait for the page to load.
 *   6. Read back the three values from the reactivated tab.
 * Repeated once with autocomplete="off" on the <form>.
 *
 * Known hazard (tests/test_hybrid_mode.js:297): a mocked-out comment there
 * says real chrome.tabs.discard() has caused a "SwiftShader compositor
 * segfault" in this project's test environment before. This script is
 * intentionally isolated in its own process (not sharing a run with
 * frame_gap.js) so a crash here doesn't cost the other measurement.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { buildTestExtension, extensionLaunchOptions } from '../helpers/test-extension.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const PORT = 8899;

const INPUT_TEXT = 'UNSAVED_INPUT_9f3a';
const TEXTAREA_TEXT = 'UNSAVED_TEXTAREA_7c1e';
const CE_TEXT = 'UNSAVED_CONTENTEDITABLE_b04d';

function page(autocompleteOff) {
  return `<!DOCTYPE html>
<html><head><title>Discard State Test${autocompleteOff ? ' (autocomplete off)' : ''}</title></head>
<body>
  <form id="f"${autocompleteOff ? ' autocomplete="off"' : ''}>
    <input type="text" id="txt" name="txt"${autocompleteOff ? ' autocomplete="off"' : ''}>
    <textarea id="ta" name="ta"${autocompleteOff ? ' autocomplete="off"' : ''}></textarea>
  </form>
  <div id="ce" contenteditable="true"></div>
</body></html>`;
}

function createServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/plain') return res.end(page(false));
    if (req.url === '/autocomplete-off') return res.end(page(true));
    res.end('<h1>404</h1>');
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function readValues(pw) {
  return pw.evaluate(() => ({
    input: document.getElementById('txt')?.value ?? null,
    textarea: document.getElementById('ta')?.value ?? null,
    contentEditable: document.getElementById('ce')?.innerText ?? null
  }));
}

async function runCase(context, background, route, label) {
  const pw = await context.newPage();
  await pw.goto(`http://localhost:${PORT}${route}`);
  await pw.waitForLoadState('domcontentloaded');

  await pw.click('#txt');
  await pw.keyboard.type(INPUT_TEXT);
  await pw.click('#ta');
  await pw.keyboard.type(TEXTAREA_TEXT);
  await pw.click('#ce');
  await pw.keyboard.type(CE_TEXT);

  const before = await readValues(pw);
  console.log(`  [${label}] typed values before discard:`, before);

  const beforeUrl = pw.url();

  const discardResult = await background.evaluate(async (targetUrl) => {
    const tabs = await chrome.tabs.query({});
    const target = tabs.find((t) => t.url === targetUrl);
    if (!target) return { error: 'tab not found' };
    try {
      const discarded = await chrome.tabs.discard(target.id);
      return { discarded };
    } catch (err) {
      return { error: String(err && err.message || err) };
    }
  }, beforeUrl);

  console.log(`  [${label}] chrome.tabs.discard() result:`, JSON.stringify(discardResult));

  if (!discardResult || discardResult.error || !discardResult.discarded) {
    return { label, before, error: discardResult?.error || 'discard() returned falsy (refused)' };
  }

  const discardedId = discardResult.discarded.id;

  // Confirm the tab is actually reported discarded before reactivating.
  const confirmedDiscarded = await background.evaluate(async (id) => {
    for (let i = 0; i < 20; i++) {
      const t = await chrome.tabs.get(id).catch(() => null);
      if (t?.discarded) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }, discardedId);
  console.log(`  [${label}] confirmed discarded before reactivate: ${confirmedDiscarded}`);

  if (!confirmedDiscarded) {
    return { label, before, error: 'tabs.get never reported discarded:true within 5s; not reactivating' };
  }

  // Reactivate. Playwright's `pw` Page handle may or may not survive the
  // renderer unload/reload cycle, so re-find the page by matching context
  // pages after activation rather than trusting the old handle blindly.
  await background.evaluate(async (id) => {
    await chrome.tabs.update(id, { active: true });
  }, discardedId);

  await new Promise((r) => setTimeout(r, 1500));

  let reactivatedPage = pw;
  if (pw.isClosed()) {
    reactivatedPage = context.pages().find((p) => !p.isClosed() && p.url().includes(route)) || null;
  }
  if (!reactivatedPage) {
    return { label, before, error: 'could not find reactivated page (original Page handle closed, no replacement found)' };
  }

  try {
    await reactivatedPage.waitForLoadState('load', { timeout: 10000 });
  } catch (err) {
    console.log(`  [${label}] waitForLoadState after reactivate threw: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 500));

  let after;
  try {
    after = await readValues(reactivatedPage);
  } catch (err) {
    return { label, before, error: `readValues after reactivate threw: ${err.message}` };
  }

  await reactivatedPage.close().catch(() => {});
  return { label, before, after };
}

async function main() {
  const server = await createServer();
  console.log(`Mock server on http://localhost:${PORT}`);

  // The server is created above this try/finally, so it must be closed on
  // every path out of it -- including buildTestExtension() or
  // launchPersistentContext() throwing, which would otherwise leave port
  // 8899 listening.
  let context = null;
  try {
    const extensionPath = buildTestExtension();
    const userDataDir = path.resolve(REPO_ROOT, 'tests/.playwright_user_data_discardstate');
    if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

    const extraArgs = process.env.TABSUM_NO_GPU === '1'
      ? ['--no-first-run', '--disable-gpu', '--disable-software-rasterizer', '--disable-gpu-compositing']
      : process.env.TABSUM_METAL === '1'
        ? ['--no-first-run', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
        : ['--no-first-run'];
    const launchOpts = extensionLaunchOptions(extensionPath, extraArgs);
    // TABSUM_CHANNEL=chrome: the installed Google Chrome has a hardware GPU path,
    // which sidesteps the SwiftShader compositor segfault on discard().
    if (process.env.TABSUM_CHANNEL) launchOpts.channel = process.env.TABSUM_CHANNEL;
    context = await chromium.launchPersistentContext(userDataDir, launchOpts);
    let [background] = context.serviceWorkers();
    if (!background) background = await context.waitForEvent('serviceworker', { timeout: 10000 });
    console.log(`Extension loaded: ${background.url()}\n`);

    const results = [];
    results.push(await runCase(context, background, '/plain', 'default (no autocomplete=off)'));
    results.push(await runCase(context, background, '/autocomplete-off', 'autocomplete="off"'));

    console.log('\n=== Results ===');
    for (const r of results) {
      console.log(`\n-- ${r.label} --`);
      if (r.error) {
        console.log(`  ERROR: ${r.error}`);
        continue;
      }
      const survived = (field) => !!(r.after[field] === r.before[field] && r.before[field]);
      console.log(`  input:            typed="${r.before.input}" after="${r.after.input}" survived=${survived('input')}`);
      console.log(`  textarea:         typed="${r.before.textarea}" after="${r.after.textarea}" survived=${survived('textarea')}`);
      console.log(`  contentEditable:  typed="${r.before.contentEditable}" after="${r.after.contentEditable}" survived=${survived('contentEditable')}`);
    }
    console.log('\nDone.');
  } finally {
    await context?.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

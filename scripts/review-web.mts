import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

// Run after `bun run build`. Playwright's Chromium must already be installed.
// Screenshots are outputs only; no source outside the repository is modified.
const root = fileURLToPath(new URL('../apps/expo/dist/', import.meta.url));
const screenshots = process.env.SCREENSHOT_DIR;
if (screenshots) assert(existsSync(screenshots), 'SCREENSHOT_DIR must already exist');
const port = Number(process.env.REVIEW_PORT ?? 4175);
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', `http://localhost:${port}`).pathname);
  const target = pathname === '/' ? '/index.html' : path.extname(pathname) ? pathname : `${pathname}.html`;
  const filename = path.resolve(root, `.${target}`);
  if (!filename.startsWith(path.resolve(root) + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const content = await readFile(filename);
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, resolve); });
console.log(`Review server listening on ${port}; launching Chromium`);
const browser = await chromium.launch({ headless: true, timeout: 15000 });
const errors: string[] = [];
const base = `http://localhost:${port}`;
const expected = {
  dark: { editor: 'rgb(9, 23, 39)', gutter: 'rgb(9, 23, 39)', cursor: 'rgb(98, 173, 255)' },
  light: { editor: 'rgb(251, 253, 255)', gutter: 'rgb(251, 253, 255)', cursor: 'rgb(7, 92, 194)' },
};
type Mode = keyof typeof expected;
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  if (screenshots) await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true });
}
async function noOverflow(page: Page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${page.url()}`);
}
async function activeTheme(page: Page, mode: Mode) {
  await page.getByRole('button', { name: `${mode === 'dark' ? 'Dark' : 'Light'} mode active. Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`, exact: true }).waitFor();
}
async function editorReady(page: Page, mode: Mode) {
  await activeTheme(page, mode);
  await page.locator(`[data-editor-theme="${mode}"] .cm-content[contenteditable="true"]`).waitFor();
  assert.equal(await page.locator('.cm-editor').evaluate(el => getComputedStyle(el).backgroundColor), expected[mode].editor);
  assert.equal(await page.locator('.cm-gutters').evaluate(el => getComputedStyle(el).backgroundColor), expected[mode].gutter);
}
async function saveReady(page: Page) {
  await page.getByText('Saved on device', { exact: true }).waitFor();
}
async function auth(page: Page, mode: Mode, signup: boolean) {
  await page.goto(`${base}/${signup ? 'signup' : 'login'}`);
  await activeTheme(page, mode);
  const submit = page.getByRole('button', { name: signup ? 'Create your account' : 'Sign in to GigaCode', exact: true });
  await submit.click();
  await page.getByText('Enter a valid email address.', { exact: true }).waitFor();
  if (signup) {
    await page.getByText('Enter at least 2 characters.', { exact: true }).waitFor();
    await page.getByLabel('Your name', { exact: true }).fill('Ada');
  }
  await page.getByLabel('Email address', { exact: true }).fill('ada@example.com');
  await page.getByLabel('Password', { exact: true }).fill('ocean-blue-123');
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  assert.equal(await page.getByLabel('Password', { exact: true }).getAttribute('type'), 'text');
  await submit.click();
  await page.getByText('The account service is not connected yet.', { exact: false }).waitFor();
  if (signup) await page.getByText('No account was created', { exact: false }).waitFor();
  await noOverflow(page);
}

try {
  if (process.argv.includes('--diagnose')) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    page.on('pageerror', error => console.log('PAGE ERROR:', error.stack));
    await page.goto(base);
    for (const mode of ['dark', 'light'] as const) {
      if (mode === 'light') await page.getByRole('button', { name: /^Dark mode active/ }).click();
      await editorReady(page, mode);
      await page.evaluate(() => document.fonts.ready);
      console.log(`LAYOUT ${mode}:`, JSON.stringify(await page.evaluate(() => {
        const measure = (el: Element) => {
          const css = getComputedStyle(el);
          return { tag: el.tagName, text: el.textContent, rect: el.getBoundingClientRect().toJSON(), display: css.display, direction: css.flexDirection, padding: css.padding, margin: css.margin, lineHeight: css.lineHeight, visibility: css.visibility, inlineStyle: el.getAttribute('style') };
        };
        return {
          editor: Array.from(document.querySelectorAll('.cm-scroller, .cm-content, .cm-gutters, .cm-gutter, .cm-line, .cm-gutterElement')).slice(0, 16).map(measure),
          links: Array.from(document.querySelectorAll('a')).filter(el => /Create account|Sign in for cloud/.test(el.textContent ?? '')).map(el => ({ ...measure(el), html: el.outerHTML, children: Array.from(el.children).map(measure) })),
        };
      }), null, 2));
      await capture(page, `diagnostic-${mode}`);
    }
    await page.close();
  } else {
  for (const width of [1440, 390, 768, 1024]) {
    console.log(`REVIEW ${width}px`);
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1050 }, isMobile: width === 390, hasTouch: width === 390 });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await editorReady(page, 'dark');
    for (const mode of ['dark', 'light'] as const) {
      if (mode === 'light') await page.getByRole('button', { name: 'Dark mode active. Switch to light mode', exact: true }).click();
      await editorReady(page, mode);
      await noOverflow(page);
      await capture(page, `workspace-${width}-${mode}`);
      // Live editor reconfiguration must not discard text or undo history.
      const code = page.locator('.cm-content');
      await code.fill('print("blue")\n# a local idea\nvalue = 42');
      const syntaxColor = await code.locator('span').first().evaluate(el => getComputedStyle(el).color);
      assert.notEqual(syntaxColor, mode === 'dark' ? 'rgb(0, 105, 132)' : 'rgb(111, 225, 255)', 'stale syntax palette');
      const switchTo = mode === 'dark' ? 'light' : 'dark';
      await page.getByRole('button', { name: new RegExp(`^${mode === 'dark' ? 'Dark' : 'Light'} mode active`) }).click();
      await editorReady(page, switchTo);
      assert.match(await code.innerText(), /a local idea/);
      const switchedSyntax = await code.locator('span').first().evaluate(el => getComputedStyle(el).color);
      assert.notEqual(switchedSyntax, syntaxColor, 'syntax did not change live');
      await page.getByRole('button', { name: new RegExp(`^${switchTo === 'dark' ? 'Dark' : 'Light'} mode active`) }).click();
      await editorReady(page, mode);
      await code.fill('pri');
      await page.getByRole('button', { name: 'Show Python autocomplete suggestions' }).click();
      const completion = page.locator('.cm-completionLabel').filter({ hasText: /^print$/ });
      await completion.waitFor();
      assert.equal(await page.locator('.cm-cursor').first().evaluate(el => getComputedStyle(el).borderLeftColor), expected[mode].cursor);
      await capture(page, `completion-${width}-${mode}`);
      await completion.click();
      assert.match(await code.innerText(), /print/);
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await page.getByText('Runtime not connected', { exact: true }).waitFor();
      await page.getByText('No code was executed.', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Clear execution output' }).click();
      await page.getByText('Room for a little discovery.', { exact: true }).waitFor();
      if (width < 960) await page.getByRole('button', { name: 'Files', exact: true }).click();
      await page.getByRole('button', { name: 'New Python file', exact: true }).click();
      await page.getByLabel('File name', { exact: true }).fill(`ocean_${mode}`);
      await capture(page, `file-modal-${width}-${mode}`);
      await page.getByRole('button', { name: 'Create file', exact: true }).click();
      await code.fill(`print("persistent ${mode} draft")`);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await saveReady(page);
      await page.reload();
      await editorReady(page, mode);
      assert.match(await code.innerText(), new RegExp(`persistent ${mode} draft`));
      await page.getByRole('button', { name: width < 600 ? 'Rename file' : 'Rename', exact: true }).click();
      await page.getByLabel('File name', { exact: true }).fill(`ocean_${mode}_renamed`);
      await page.getByRole('button', { name: 'Rename file', exact: true }).last().click();
      await saveReady(page);
      if (width < 960) await page.getByRole('button', { name: 'Files', exact: true }).click();
      await page.getByRole('button', { name: 'Open hello_universe.py', exact: true }).click();
      if (width < 960) await page.getByRole('button', { name: 'Files', exact: true }).click();
      await page.getByRole('button', { name: `Open ocean_${mode}_renamed.py`, exact: true }).click();
      assert.match(await code.innerText(), new RegExp(`persistent ${mode} draft`));
      await auth(page, mode, false);
      await capture(page, `login-${width}-${mode}`);
      // Client-side auth navigation and full reload both preserve the preference.
      await page.getByRole('link', { name: 'Create an account', exact: true }).click();
      await activeTheme(page, mode);
      await auth(page, mode, true);
      await capture(page, `signup-${width}-${mode}`);
      await page.reload();
      await activeTheme(page, mode);
      await page.getByRole('button', { name: new RegExp(`^${mode === 'dark' ? 'Dark' : 'Light'} mode active`) }).click();
      await activeTheme(page, switchTo);
      await page.getByRole('button', { name: new RegExp(`^${switchTo === 'dark' ? 'Dark' : 'Light'} mode active`) }).click();
      await activeTheme(page, mode);
      await page.getByRole('link', { name: width < 600 ? 'Workspace' : 'Back to workspace', exact: true }).click();
      await editorReady(page, mode);
      assert.equal(await page.evaluate(() => localStorage.getItem('gigacode.theme.v1')), mode);
      console.log(`PASS ${width}px ${mode}: editor palette + live syntax/cursor, autocomplete, local create/save/rename/open/reload, honest Run/auth, route + theme persistence, no overflow`);
    }
    await page.close();
  }
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log(`PASS no browser runtime errors. Screenshots: ${screenshots ?? 'disabled (set SCREENSHOT_DIR)'}`);
  }
} finally {
  await browser.close();
  server.close();
}

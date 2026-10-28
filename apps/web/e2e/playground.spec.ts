import { expect, test, type Page } from '@playwright/test';

async function register(page: Page) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto('/register');
  await page.getByLabel('Workspace name').fill(`Playground ${suffix}`);
  await page.getByLabel('Email').fill(`pg-${suffix}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('link', { name: 'Playground', exact: true }).first().click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
}

async function chooseLanguage(page: Page, label: RegExp) {
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: label }).click();
  // Switching away from an edited program asks first; starters switch straight away.
  const confirm = page.getByRole('button', { name: 'Switch language' });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
}

async function setCode(page: Page, code: string) {
  const editor = page.locator('.monaco-editor').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);
}

async function setLimits(page: Page, limits: { seconds?: number; memory?: number }) {
  await page.getByRole('button', { name: /Limits/ }).click();
  if (limits.seconds !== undefined) await page.getByLabel('Time limit (seconds)').fill(String(limits.seconds));
  if (limits.memory !== undefined) await page.getByLabel('Memory (MB)').fill(String(limits.memory));
  await page.keyboard.press('Escape');
}

async function run(page: Page) {
  await page.getByRole('button', { name: /^Run/ }).click();
  await expect(page.getByTestId('run-progress')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('run-progress')).toHaveAttribute('data-step', 'Done', { timeout: 60_000 });
}

test.describe.configure({ mode: 'serial' });

test('runs all four languages from the UI', async ({ page }) => {
  await register(page);
  const cases: [RegExp, string, string][] = [
    [/Python/, 'print("py-ok")', 'py-ok'],
    [/Node/, 'console.log("node-ok")', 'node-ok'],
    [/C \(gcc\)/, '#include <stdio.h>\nint main(void){puts("c-ok");return 0;}', 'c-ok'],
    [/C\+\+/, '#include <iostream>\nint main(){std::cout<<"cpp-ok"<<std::endl;}', 'cpp-ok'],
  ];
  for (const [label, code, expected] of cases) {
    await chooseLanguage(page, label);
    await setCode(page, code);
    await run(page);
    await expect(page.getByTestId('status-chip').first()).toHaveAttribute('data-status', 'SUCCESS');
    await expect(page.getByTestId('stdout-panel')).toContainText(expected);
    await expect(page.getByTestId('metrics')).toBeVisible();
  }
});

test('explains a timeout in plain words and suggests the fix', async ({ page }) => {
  await register(page);
  await setCode(page, 'while True:\n    pass');
  await setLimits(page, { seconds: 1 });
  await run(page);
  const notice = page.getByTestId('outcome-notice');
  await expect(notice).toContainText('Timed out after 1.00 s');
  await expect(notice).toContainText('Raise the time limit');
});

test('explains running out of memory', async ({ page }) => {
  await register(page);
  await setCode(page, 'data = []\nwhile True:\n    data.append(bytearray(1 << 20))');
  await setLimits(page, { memory: 64 });
  await run(page);
  await expect(page.getByTestId('outcome-notice')).toContainText('Ran out of memory (64 MB limit)');
});

test('compile errors open the compiler output', async ({ page }) => {
  await register(page);
  await chooseLanguage(page, /C \(gcc\)/);
  await setCode(page, 'int main(void){ return undefined_name; }');
  await run(page);
  await expect(page.getByTestId('status-chip').first()).toHaveAttribute('data-status', 'FAILED');
  await expect(page.getByTestId('outcome-notice')).toContainText('Compile error');
  await expect(page.getByTestId('stderr-panel')).toContainText('undefined_name');
});

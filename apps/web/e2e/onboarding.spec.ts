import { expect, request as pwRequest, test } from '@playwright/test';

test('new user: greeting, then the setup checklist ticks off as each step is completed', async ({ page, baseURL }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  await page.goto('/register');
  await page.getByLabel('Your name').fill('Nikhil');
  await page.getByLabel('Workspace name').fill(`Onboarding ${suffix}`);
  await page.getByLabel('Email').fill(`onboard-${suffix}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Greeting uses the profile name; checklist starts empty.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Nikhil.');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Run code, safely contained.');
  const setup = page.locator('#setup');
  await expect(setup).toContainText('0 of 3 steps complete');
  await expect(setup.getByText('Done')).toHaveCount(0);

  // Step 01: run a program from the Playground.
  await setup.getByRole('link', { name: /Run your first program/ }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Run/ }).click();
  await expect(page.getByTestId('status-chip').first()).toHaveAttribute('data-status', 'SUCCESS', { timeout: 60_000 });

  await page.getByRole('link', { name: 'Overview' }).first().click();
  await expect(setup).toContainText('1 of 3 steps complete', { timeout: 15_000 });
  await expect(setup.getByRole('link', { name: /Run your first program/ })).toContainText('Done');

  // Steps 02 and 03 through the API, using the signed-in session for the key and the key itself for the run.
  const me = await (await page.request.get('/v1/me')).json();
  const created = await page.request.post('/v1/api-keys', { data: { name: 'e2e' }, headers: { 'x-csrf-token': me.csrfToken } });
  expect(created.status()).toBe(201);
  const { key } = await created.json();
  await expect(async () => {
    await page.reload();
    await expect(setup).toContainText('2 of 3 steps complete', { timeout: 3_000 });
  }).toPass({ timeout: 20_000 });

  const apiCtx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${key}` } });
  const run = await apiCtx.post('/v1/executions', {
    data: { language: 'python', files: [{ path: 'main.py', content: 'print(1)' }], entryFile: 'main.py' },
  });
  expect(run.status()).toBe(202);
  await expect(async () => {
    await page.reload();
    await expect(setup).toContainText('3 of 3 steps complete', { timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await apiCtx.dispose();
});

import { expect, request as pwRequest, test, type Page } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const PASSWORD = 'e2e-password-123';

async function register(page: Page, label: string) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `${label}-${suffix}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Workspace name').fill(`${label} ${suffix}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Run code, safely contained.');
  return email;
}

test('API keys: create, copy, use against the API, then revoke', async ({ page, baseURL }) => {
  await register(page, 'keys');
  await page.getByRole('link', { name: 'API keys', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'API keys', level: 1 })).toBeVisible();
  await expect(page.getByText('No API keys yet')).toBeVisible();

  // Create: the key is revealed once, with a copy button and ready-made examples.
  await page.getByRole('button', { name: 'Create key' }).first().click();
  await page.getByLabel('Name').fill('e2e-key');
  await page.getByRole('dialog').getByRole('button', { name: 'Create key' }).click();
  const keyEl = page.getByTestId('new-api-key');
  await expect(keyEl).toBeVisible();
  const key = (await keyEl.textContent())!.trim();
  expect(key).toMatch(/^ce_live_[a-z0-9]{12}_/);
  await expect(page.getByText('It is shown only once')).toBeVisible();

  await page.getByRole('button', { name: 'Copy key' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);

  // The curl example has the real key and this server's address filled in.
  const curl = page.getByRole('dialog').getByLabel('curl example');
  await expect(curl).toContainText(`Authorization: Bearer ${key}`);
  await expect(curl).toContainText(`${new URL(baseURL!).origin}/v1/executions`);
  await page.getByRole('dialog').getByRole('tab', { name: 'Python' }).click();
  await expect(page.getByRole('dialog').getByLabel('Python example')).toContainText(key);
  await page.getByRole('button', { name: "I've saved the key" }).click();

  // The key appears as Active and has never been used.
  const row = page.getByTestId('api-key-row').filter({ hasText: 'e2e-key' });
  await expect(row).toContainText('Active');
  await expect(row).toContainText('Never');

  // Use it exactly as the example does: submit, poll, read the output.
  const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${key}` } });
  const submit = await api.post('/v1/executions', {
    data: { language: 'python', files: [{ path: 'main.py', content: 'print(6*7)' }], entryFile: 'main.py' },
  });
  expect(submit.status()).toBe(202);
  const { id } = await submit.json();
  await expect(async () => {
    const run = await (await api.get(`/v1/executions/${id}`)).json();
    expect(run.status).toBe('SUCCESS');
  }).toPass({ timeout: 60_000 });
  const out = await api.get(`/v1/executions/${id}/logs?stream=stdout&inline=true`);
  expect((await out.text()).trim()).toBe('42');

  await page.reload();
  await expect(page.getByTestId('api-key-row').filter({ hasText: 'e2e-key' })).not.toContainText('Never');

  // Revoke asks first, then the key stops working immediately.
  await page.getByTestId('api-key-row').filter({ hasText: 'e2e-key' }).getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Revoke "e2e-key"?');
  await page.getByRole('button', { name: 'Keep key' }).click();
  await expect(page.getByTestId('api-key-row').filter({ hasText: 'e2e-key' })).toContainText('Active');

  await page.getByTestId('api-key-row').filter({ hasText: 'e2e-key' }).getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('button', { name: 'Revoke key' }).click();
  await expect(page.getByTestId('api-key-row').filter({ hasText: 'e2e-key' })).toContainText('Revoked');
  expect((await api.get(`/v1/executions/${id}`)).status()).toBe(401);
  await api.dispose();
});

test('Settings: rename profile, change password, sign out', async ({ page }) => {
  const email = await register(page, 'settings');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

  // Profile
  await expect(page.getByLabel('Email')).toBeDisabled();
  await page.getByLabel('Name', { exact: true }).fill('Ada Lovelace');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile updated.')).toBeVisible();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ada Lovelace.');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();

  // Password: wrong current password is explained next to the field; mismatches are caught before sending.
  await page.getByLabel('Current password', { exact: true }).fill('not-my-password');
  await page.getByLabel('New password', { exact: true }).fill('a-brand-new-password');
  await page.getByLabel('Confirm new password', { exact: true }).fill('something-else-entirely');
  await expect(page.getByText('The two new passwords do not match.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change password' })).toBeDisabled();
  await page.getByLabel('Confirm new password', { exact: true }).fill('a-brand-new-password');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('That is not your current password.')).toBeVisible();

  await page.getByLabel('Current password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed.')).toBeVisible();

  // Sign out, then the new password works and the old one does not.
  await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText(/invalid email or password/i);

  await page.getByLabel('Password', { exact: true }).fill('a-brand-new-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ada Lovelace.');
});

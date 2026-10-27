import { expect, test } from '@playwright/test';

test('register, run Python, see live status and output', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  await page.goto('/register');
  await page.getByLabel('Organization name').fill(`E2E ${suffix}`);
  await page.getByLabel('Email').fill(`e2e-${suffix}@example.com`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('link', { name: 'New execution' }).first().click();
  await expect(page.getByRole('heading', { name: 'New execution' })).toBeVisible();

  // Replace the starter program through Monaco's model.
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText('print("hello from e2e")');

  await page.getByRole('button', { name: /^Run/ }).click();

  // Live status chip appears and moves through states to SUCCESS.
  const chip = page.getByTestId('status-chip').first();
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await expect(chip).toHaveAttribute('data-status', 'SUCCESS', { timeout: 60_000 });
  await expect(page.getByTestId('timeline').getByTestId('status-chip').nth(1)).toBeVisible();

  await expect(page.getByTestId('stdout-panel')).toContainText('hello from e2e', { timeout: 30_000 });
});

import { expect, test, type Page } from '@playwright/test';

const TERMINAL = ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'DEAD_LETTERED'];

async function register(page: Page) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto('/register');
  await page.getByLabel('Workspace name').fill(`Runs ${suffix}`);
  await page.getByLabel('Email').fill(`runs-${suffix}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Run code, safely contained.');
}

/** Submit through the signed-in session (same endpoint the Playground uses). Returns the run id. */
async function submit(page: Page, language: string, path: string, content: string, timeoutMs = 5000): Promise<string> {
  const me = await (await page.request.get('/v1/me')).json();
  const res = await page.request.post('/v1/executions', {
    data: { language, files: [{ path, content }], entryFile: path, limits: { timeoutMs } },
    headers: { 'x-csrf-token': me.csrfToken },
  });
  expect(res.status()).toBe(202);
  return (await res.json()).id;
}

async function waitFinished(page: Page, ids: string[]) {
  await expect
    .poll(
      async () => {
        const statuses = await Promise.all(ids.map(async (id) => (await (await page.request.get(`/v1/executions/${id}`)).json()).status));
        return statuses.every((s) => TERMINAL.includes(s));
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

async function chooseOption(page: Page, selectLabel: string, option: string) {
  await page.getByRole('combobox', { name: selectLabel }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe.configure({ mode: 'serial' });

test('Runs list: filter, search, paginate and open a run', async ({ page }) => {
  await register(page);
  const okId = await submit(page, 'python', 'main.py', 'print("fine")');
  const failId = await submit(page, 'python', 'main.py', 'raise SystemExit(3)');
  const nodeId = await submit(page, 'node', 'index.js', 'console.log("n")');
  await waitFinished(page, [okId, failId, nodeId]);

  await page.getByRole('link', { name: 'Runs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
  const rows = page.getByTestId('run-row');
  await expect(rows).toHaveCount(3);

  // Status filter, kept in the URL; clearing restores everything.
  await chooseOption(page, 'Status', 'Failed');
  await expect(rows).toHaveCount(1);
  await expect(page).toHaveURL(/status=FAILED/);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows).toHaveCount(3);
  await expect(page).not.toHaveURL(/status=/);

  // Language filter.
  await chooseOption(page, 'Language', 'Node.js 20');
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters' }).click();

  // Search by the start of a run ID; bad input is explained instead of sent.
  await page.getByLabel('Search by run ID').fill(failId.slice(0, 8));
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole('link')).toHaveText(failId.slice(0, 8));
  await page.getByLabel('Search by run ID').fill('not an id!');
  await expect(page.getByRole('alert')).toContainText('only contain the characters 0-9, a-f');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows).toHaveCount(3);

  // A date range that excludes today matches nothing and says so.
  await page.getByLabel('From').fill('2000-01-01');
  await page.getByLabel('To').fill('2000-01-02');
  await expect(page.getByText('No runs match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(rows).toHaveCount(3);

  // Pagination (page size 2 through the URL).
  await page.goto('/executions?limit=2');
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('runs-count')).toContainText('Page 1');
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId('runs-count')).toContainText('Page 2');
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(rows).toHaveCount(2);

  // Opening a failed run explains what happened.
  await page.goto('/executions');
  await rows.filter({ hasText: failId.slice(0, 8) }).click();
  await expect(page).toHaveURL(new RegExp(`/executions/${failId}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Run ${failId.slice(0, 8)}`);
  await expect(page.getByRole('heading', { level: 1 }).getByTestId('status-chip')).toHaveAttribute('data-status', 'FAILED');
  await expect(page.getByTestId('outcome-notice')).toContainText('Exited with code 3');
  await expect(page.getByTestId('metrics')).toBeVisible();
});

test('Run detail: tabs, re-run, open in Playground', async ({ page }) => {
  await register(page);
  const id = await submit(page, 'python', 'main.py', 'print("detail-ok")');
  await waitFinished(page, [id]);

  await page.goto(`/executions/${id}`);
  await expect(page.getByTestId('stdout-panel')).toContainText('detail-ok');

  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByTestId('timeline')).toContainText('Finished successfully');
  await page.getByRole('tab', { name: 'Attempts' }).click();
  await expect(page.getByRole('row', { name: /^1 / })).toBeVisible();
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByLabel('Source of main.py')).toContainText('print("detail-ok")');

  // Re-run creates a new run and lands on it.
  await page.getByRole('button', { name: 'Re-run' }).click();
  await expect(page).not.toHaveURL(new RegExp(`/executions/${id}$`));
  await expect(page).toHaveURL(/\/executions\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 }).getByTestId('status-chip')).toHaveAttribute('data-status', 'SUCCESS', { timeout: 60_000 });

  // Open in Playground carries the code over.
  await page.goto(`/executions/${id}`);
  await page.getByRole('button', { name: 'Open in Playground' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('detail-ok', { timeout: 30_000 });
});

test('Run detail: cancel asks first, then stops the run', async ({ page }) => {
  await register(page);
  const id = await submit(page, 'python', 'main.py', 'import time\ntime.sleep(8)\nprint("late")', 10_000);
  await page.goto(`/executions/${id}`);

  await page.getByRole('button', { name: 'Cancel run' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Cancel this run?');
  await page.getByRole('button', { name: 'Keep running' }).click();
  await expect(page.getByRole('button', { name: 'Cancel run' })).toBeEnabled();

  await page.getByRole('button', { name: 'Cancel run' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel run' }).click();
  await expect(page.getByRole('heading', { level: 1 }).getByTestId('status-chip')).toHaveAttribute('data-status', 'CANCELLED', { timeout: 40_000 });
  await expect(page.getByTestId('outcome-notice')).toContainText('Cancelled');
});

test('Run detail: an unknown or foreign run says so', async ({ page }) => {
  await register(page);
  await page.goto('/executions/00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('Run not found')).toBeVisible();
  await page.getByRole('link', { name: 'Back to runs' }).click();
  await expect(page).toHaveURL(/\/executions$/);
});

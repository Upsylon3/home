import assert from 'node:assert/strict';

// Built editor + disposable demo API; injected failures stay in this context.
export async function verifyNoteSaveSafety(browser, origin, { token, notePattern = '**/#/notes/*' } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    ServiceWorkerContainer.prototype.register = async () => { throw new DOMException('Fixture page API', 'SecurityError'); };
  });
  if (token) await context.addInitScript(value => localStorage.setItem('home_session_token', value), token);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin + 'notes/');
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page.waitForURL(notePattern);
    const noteUrl = page.url();
    await page.getByLabel('Note title', { exact: true }).fill('Immediate navigation draft');
    await page.getByRole('link', { name: 'All Notes', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Unsaved note changes', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save and leave', exact: true }).click();
    await page.getByText('Immediate navigation draft', { exact: true }).waitFor();
    if (token) {
      await page.route('**/api/homenotes/notes/*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Injected load failure"}' }));
      await page.goto(noteUrl);
      await page.getByRole('alert').filter({ hasText: 'Injected load failure' }).waitFor();
      await page.unroute('**/api/homenotes/notes/*');
      await page.getByRole('button', { name: 'Retry loading note', exact: true }).click();
    }
    await page.goto(noteUrl);
    assert.equal(await page.getByLabel('Note title', { exact: true }).inputValue(), 'Immediate navigation draft');
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.noteSaveFailure = true;
      window.fetch = async (input, options) => {
        if (window.noteSaveFailure && options?.method === 'PATCH' && String(input).includes('/homenotes/notes/')) {
          return new Response(JSON.stringify({ error: 'Injected save failure' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        return originalFetch(input, options);
      };
    });
    await page.getByLabel('Note content', { exact: true }).fill('Keep this failed draft');
    await page.getByRole('link', { name: 'All Notes', exact: true }).click();
    await page.getByRole('button', { name: 'Save and leave', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Injected save failure' }).waitFor();
    assert.equal(page.url(), noteUrl);
    assert.equal(await page.getByLabel('Note content', { exact: true }).inputValue(), 'Keep this failed draft');
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await page.evaluate(() => { window.noteSaveFailure = false; });
    await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
    await page.reload();
    assert.equal(await page.getByLabel('Note content', { exact: true }).inputValue(), 'Keep this failed draft');
    await page.getByRole('link', { name: 'All Notes', exact: true }).click();
    await page.locator('.note-card').filter({ hasText: 'Immediate navigation draft' }).click();
    await page.getByLabel('Note content', { exact: true }).fill('Back navigation draft');
    await page.evaluate(() => history.back());
    await page.getByRole('alertdialog', { name: 'Unsaved note changes', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    assert.equal(await page.getByLabel('Note content', { exact: true }).inputValue(), 'Back navigation draft');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    assert.equal(await page.getByLabel('Note content', { exact: true }).inputValue(), 'Back navigation draft');
    await page.getByRole('link', { name: 'All Notes', exact: true }).click();
    await page.getByRole('button', { name: 'Save and leave', exact: true }).click();
    await page.getByText('Immediate navigation draft', { exact: true }).waitFor();
    await page.goto(noteUrl);
    await page.getByLabel('Note title', { exact: true }).fill('Deliberately discarded');
    await page.getByRole('link', { name: 'All Notes', exact: true }).click();
    await page.getByRole('button', { name: 'Discard queued changes and leave', exact: true }).click();
    await page.getByText('Immediate navigation draft', { exact: true }).waitFor();
    await page.goto(noteUrl);
    assert.equal(await page.getByLabel('Note title', { exact: true }).inputValue(), 'Immediate navigation draft');
    await page.getByLabel('Note content', { exact: true }).fill('Reload warning draft');
    assert.equal(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), true);
    await page.getByRole('link', { name: 'All Notes', exact: true }).click();
    await page.getByRole('button', { name: 'Save and leave', exact: true }).click();
    await page.getByText('Immediate navigation draft', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

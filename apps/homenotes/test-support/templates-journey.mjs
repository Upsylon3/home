import assert from 'node:assert/strict';

export async function verifyTemplates(browser, origin, { token, notePattern = '**/#/notes/*' } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    ServiceWorkerContainer.prototype.register = async () => { throw new DOMException('Fixture page API', 'SecurityError'); };
  });
  if (token) await context.addInitScript(value => localStorage.setItem('home_session_token', value), token);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await page.goto(origin + 'notes/');
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page.waitForURL(notePattern);
    const sourceUrl = page.url();
    await page.getByLabel('Note title', { exact: true }).fill('Reusable weekly plan');
    await page.getByLabel('Note content', { exact: true }).fill('# Week\n- [ ] Plan one thing');
    await page.getByPlaceholder('Add tag…', { exact: true }).fill('Weekly');
    await page.getByPlaceholder('Add tag…', { exact: true }).press('Enter');
    // Save immediately, before the note debounce: the template must include edits.
    await page.getByRole('button', { name: 'Save as template', exact: true }).click();
    await page.getByLabel('Template name', { exact: true }).fill('Weekly checklist');
    await page.getByRole('button', { name: 'Save template', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Template saved.' }).waitFor();
    await page.evaluate(() => {
      const original = window.fetch;
      let failList = true;
      window.fetch = async (input, options) => {
        if (failList && String(input).endsWith('/homenotes/templates') && (!options?.method || options.method === 'GET')) {
          failList = false;
          return new Response(JSON.stringify({ error: 'Injected template list failure' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        return original(input, options);
      };
    });
    await page.getByRole('navigation').getByRole('link', { name: 'Templates', exact: true }).first().click();
    await page.getByRole('alert').filter({ hasText: 'Injected template list failure' }).waitFor();
    await page.getByRole('button', { name: 'Retry loading templates', exact: true }).click();
    const template = page.getByRole('region', { name: 'Template Weekly checklist', exact: true });
    await template.getByText('Tags: Weekly', { exact: true }).waitFor();
    await page.reload();
    await template.getByRole('button', { name: 'New note from template', exact: true }).click();
    await page.waitForURL(notePattern);
    const createdUrl = page.url();
    assert.notEqual(createdUrl, sourceUrl);
    assert.equal(await page.getByLabel('Note title', { exact: true }).inputValue(), 'Reusable weekly plan');
    assert.equal(await page.getByLabel('Note content', { exact: true }).inputValue(), '# Week\n- [ ] Plan one thing');
    await page.getByLabel('Note content', { exact: true }).fill('Independent note content');
    await page.getByRole('navigation').getByRole('link', { name: 'Templates', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector('[role="alertdialog"]') || /templates/.test(location.hash || location.pathname));
    if (await page.getByRole('alertdialog').count()) await page.getByRole('button', { name: 'Save and leave', exact: true }).click();
    await template.waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    page.once('dialog', dialog => dialog.accept());
    await template.getByRole('button', { name: 'Remove template', exact: true }).click();
    await page.getByText('No templates yet. Open a note and choose Save as template.', { exact: true }).waitFor();
    await page.goto(createdUrl);
    assert.equal(await page.getByLabel('Note content', { exact: true }).inputValue(), 'Independent note content');
    await page.goto(sourceUrl);
    assert.equal(await page.getByLabel('Note content', { exact: true }).inputValue(), '# Week\n- [ ] Plan one thing');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

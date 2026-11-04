import assert from 'node:assert/strict';
export async function verifyPortal(page, origin) {
  const outgoing = [];
  const listener = request => { if (!request.url().startsWith(new URL(origin).origin)) outgoing.push(request.url()); };
  page.on('request', listener);
  try {
    await page.goto(origin + 'connect/');
    await page.getByRole('heading', { name: 'Open your HOME' }).waitFor();
    await page.getByLabel('Name', { exact: true }).fill('Family HOME');
    await page.getByLabel('Server address').fill('https://myhome.example.org');
    await page.getByRole('button', { name: 'Save address' }).click();
    await page.reload();
    const link = page.getByRole('link', { name: 'Family HOME — https://myhome.example.org/' });
    assert.equal(await link.getAttribute('href'), 'https://myhome.example.org/');
    assert.equal(await link.getAttribute('referrerpolicy'), 'no-referrer');
    await page.getByLabel('Name', { exact: true }).fill('Unsafe');
    await page.getByLabel('Server address').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Save address' }).click();
    assert.equal(await page.locator('#homes a').count(), 1);
    await page.getByRole('button', { name: 'Forget Family HOME' }).click();
    await page.reload();
    assert.equal(await page.locator('#homes a').count(), 0);
    assert.deepEqual(outgoing, [], 'Saving a shortcut must not contact that server or a third-party API');
    await page.screenshot({ path: 'demo-portal.png', fullPage: true });
  } finally { page.off('request', listener); }
}

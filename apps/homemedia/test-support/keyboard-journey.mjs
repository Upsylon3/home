import assert from 'node:assert/strict';

export async function verifyMediaKeyboard(page, origin) {
  await page.goto(origin + 'media/');
  const open = page.getByRole('button', { name: 'Open A little room to explore.svg', exact: true });
  await open.waitFor();
  // Exercise the actual Tab order rather than programmatically focusing a div.
  for (let index = 0; index < 40 && !await open.evaluate(node => node === document.activeElement); index++) await page.keyboard.press('Tab');
  assert.ok(await open.evaluate(node => node === document.activeElement), 'Gallery item is reachable by Tab');
  await page.keyboard.press('Enter');
  const viewer = page.getByRole('dialog', { name: 'Media viewer: A little room to explore.svg', exact: true });
  await viewer.waitFor();
  assert.ok(await viewer.getByRole('button', { name: 'Close', exact: true }).evaluate(node => node === document.activeElement));
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab');
    assert.ok(await viewer.evaluate(node => document.activeElement === document.body || node.contains(document.activeElement)), 'Modal Tab order cannot reach the underlying app');
  }
  await page.keyboard.press('Escape');
  await viewer.waitFor({ state: 'detached' });
  assert.ok(await open.evaluate(node => node === document.activeElement), 'Closing restores the opener');
  await page.keyboard.press('Space');
  await viewer.waitFor();
  await page.keyboard.press('Escape');
  await viewer.waitFor({ state: 'detached' });
  await page.keyboard.press('Tab');
  const favorite = page.locator('.photo-tile').filter({ has: open }).getByRole('button', { name: /favorites/ });
  assert.ok(await favorite.evaluate(node => node === document.activeElement));
  const before = await favorite.getAttribute('aria-pressed');
  await page.keyboard.press('Space');
  await page.waitForFunction(previous => document.querySelector('.photo-tile-favorite')?.getAttribute('aria-pressed') !== previous, before);
  assert.equal(await page.getByRole('dialog').count(), 0, 'Favoriting does not open the viewer');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.photo-tile-favorite')).opacity === '1');
  await page.setViewportSize({ width: 390, height: 844 });
  await open.click();
  await viewer.waitFor();
  assert.ok(await viewer.evaluate(node => node.getBoundingClientRect().width <= innerWidth + 1));
  if (process.env.MEDIA_KEYBOARD_SCREENSHOT) await page.screenshot({ path: process.env.MEDIA_KEYBOARD_SCREENSHOT });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 720 });
}

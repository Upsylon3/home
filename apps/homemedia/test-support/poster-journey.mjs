import assert from 'node:assert/strict';

export async function verifyVideoPosters(page, { mediaUrl, apiBase, token }) {
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(20_000);
  await page.addInitScript(() => {
    const create = document.createElement.bind(document);
    document.createElement = (...args) => {
      const element = create(...args);
      if (args[0] === 'video') element.addEventListener('error', () => { window.__fixtureVideoErrors = (window.__fixtureVideoErrors || 0) + 1; });
      return element;
    };
  });
  await page.goto(mediaUrl);
  await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
  await page.bringToFront();
  let sourceDeadline;
  const ids = await Promise.race([page.evaluate(async ({ apiBase, token }) => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:160px;height:90px;z-index:2147483647';
    document.body.append(canvas);
    const context = canvas.getContext('2d');
    const paint = () => { context.fillStyle = '#00c000'; context.fillRect(0, 0, 160, 90); };
    paint();
    // captureStream also requests an initial frame. Flush the green paint before
    // creating it so that frame is not a headless compositor's blank surface.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const stream = canvas.captureStream(0), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    // A manually driven track must send frames before an encoder may emit
    // onstart. Waiting for onstart here can deadlock on an already-painted canvas.
    recorder.start();
    for (let index = 0; index < 6; index++) {
      paint(); context.fillStyle = `rgb(${index},192,0)`; context.fillRect(0, 0, 1, 1);
      await new Promise(resolve => requestAnimationFrame(resolve));
      stream.getVideoTracks()[0].requestFrame(); await new Promise(resolve => setTimeout(resolve, 100));
    }
    recorder.stop(); await stopped;
    stream.getTracks().forEach(track => track.stop()); canvas.remove();
    if (chunks.reduce((size, chunk) => size + chunk.size, 0) < 200) throw new Error('Recorder produced no video frames');
    const ids = [];
    for (const [name, blob] of [['poster-proof.webm', new Blob(chunks, { type: 'video/webm' })], ['unsupported-proof.webm', new Blob(['not a video'], { type: 'video/webm' })], ['picker-proof.webm', new Blob(chunks, { type: 'video/webm' })]]) {
      const form = new FormData(); form.append('file', blob, name);
      const response = await fetch(apiBase + '/homecloud/files/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
      if (!response.ok) throw new Error('Fixture upload failed: ' + response.status + ' ' + await response.text());
      ids.push((await response.json()).file.id);
    }
    return ids;
  }, { apiBase, token }), new Promise((_, reject) => {
    sourceDeadline = setTimeout(() => reject(new Error('Video fixture recording/upload timed out')), 20_000);
  })]).finally(() => clearTimeout(sourceDeadline));
  let tickets = 0;
  const count = request => { if (request.url().includes(`/homemedia/${ids[0]}/poster-ticket`)) tickets++; };
  page.on('request', count);
  // Page fallback fetches stay local; real/worker paths also count network tickets.
  await page.goto(mediaUrl);
  const preview = page.getByRole('img', { name: 'poster-proof.webm video preview', exact: true });
  await preview.waitFor();
  const pixel = await preview.evaluate(async image => {
    await image.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data];
  });
  assert.ok(pixel[1] > 140 && pixel[0] < 60 && pixel[2] < 60, `Poster decoded the actual green video frame: ${pixel}`);
  await page.waitForFunction(() => window.__fixtureVideoErrors > 0);
  const unsupported = page.locator('.photo-tile').filter({ has: page.getByRole('button', { name: 'Open unsupported-proof.webm', exact: true }) });
  assert.equal(await unsupported.locator('img').count(), 0);
  if (process.env.MEDIA_POSTER_SCREENSHOT) await page.screenshot({ path: process.env.MEDIA_POSTER_SCREENSHOT });
  const tile = page.locator('.photo-tile').filter({ has: page.getByRole('button', { name: 'Open poster-proof.webm', exact: true }) });
  await tile.getByRole('button', { name: 'Add to favorites', exact: true }).click();
  await tile.getByRole('button', { name: 'Remove from favorites', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Favorites', exact: true }).first().click();
  await preview.waitFor();
  if (tickets) assert.equal(tickets, 1, 'A second mounted tile reuses the session cache');
  await page.getByRole('button', { name: 'Open poster-proof.webm', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.lightbox-video')?.readyState >= 2);
  await page.keyboard.press('Escape');
  await page.evaluate(async ({ apiBase, token, id }) => {
    const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const send = async (path, method, body) => {
      const response = await fetch(apiBase + '/homemedia' + path, { method, headers, body: JSON.stringify(body) });
      if (!response.ok) throw new Error('Album fixture failed: ' + response.status);
      return response.json();
    };
    const { album } = await send('/albums', 'POST', { name: 'Poster proof album' });
    await send(`/albums/${album.id}/items`, 'POST', { fileIds: [id] });
    await send(`/albums/${album.id}`, 'PATCH', { coverFileId: id });
  }, { apiBase, token, id: ids[0] });
  await page.getByRole('link', { name: 'Albums', exact: true }).first().click();
  const album = page.locator('.album-card').filter({ hasText: 'Poster proof album' });
  await album.locator('img').waitFor();
  await album.locator('img').evaluate(image => image.decode());
  await album.click(); await preview.waitFor();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByRole('button', { name: 'Select picker-proof.webm', exact: true }).getByRole('img', { name: 'picker-proof.webm video preview', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  if (tickets) assert.equal(tickets, 1, 'Album covers/grid/picker share the same cached source');
  page.off('request', count);
}

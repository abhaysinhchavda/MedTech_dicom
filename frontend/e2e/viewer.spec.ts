import { expect, test, type Page } from '@playwright/test';

// Permitted relaxation (see task-7-brief.md Step 3): cornerstone/vtk.js create
// their WebGL2 context with `preserveDrawingBuffer: false` (vtk.js
// RenderWindow.js), so by the time page.evaluate's callback runs, the
// drawing buffer has already been cleared for the next frame and
// gl.readPixels() reads back all zeros even when the panel is visibly
// rendered. canvas.toDataURL() is spec-guaranteed to capture the
// last-presented frame regardless of preserveDrawingBuffer, so compare that
// against a same-sized blank canvas instead of reading pixels directly.
async function canvasIsNonBlack(page: Page, panel: string): Promise<boolean> {
  return page.evaluate((label) => {
    const c = document.querySelector(
      `[data-testid="panel-${label}"] canvas`,
    ) as HTMLCanvasElement | null;
    if (!c) return false;
    const blank = document.createElement('canvas');
    blank.width = c.width;
    blank.height = c.height;
    return c.toDataURL() !== blank.toDataURL();
  }, panel);
}

// Time-to-first-paint grows with every viewer mounted in the same browser
// process -- measured at ~5s, ~20s and over 30s for the first, second and
// third -- because swiftshader is a software rasteriser and the GPU process
// reclaims a closed page's resources lazily. The budget therefore has to
// cover the LAST test to run, not the first; 30s only ever passed because
// this suite used to hold two tests. The assertion itself is unchanged: a
// real, non-black render is still required.
async function awaitPainted(page: Page, panel: string): Promise<void> {
  await expect.poll(() => canvasIsNonBlack(page, panel), { timeout: 90_000 }).toBe(true);
}

test('open series, scroll, crosshairs, preset, reopen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('row', { name: /Test\^Patient/ }).click();
  await page.getByRole('link', { name: /Synthetic series/ }).click();
  await expect(page.getByRole('progressbar')).toBeHidden({ timeout: 90_000 });
  for (const p of ['Axial', 'Sagittal', 'Coronal', '3D']) await awaitPainted(page, p);

  // Cornerstone3D's default MPR camera lands on image index
  // Math.floor((numberOfSlices - 1) / 2) = 19 for a 40-slice volume, i.e.
  // "20 / 40" (1-indexed) rather than the brief's "21 / 40" -- verified
  // against the actual rendered overlay, see task-7-report.md.
  const axialSlice = page.getByTestId('slice-Axial');
  await expect(axialSlice).toHaveText('20 / 40');
  await page.getByTestId('panel-Axial').hover();
  await page.mouse.wheel(0, 300);
  await expect(axialSlice).not.toHaveText('20 / 40');

  const sagBefore = await page.getByTestId('slice-Sagittal').textContent();
  const box = (await page.getByTestId('panel-Axial').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('slice-Sagittal')).not.toHaveText(sagBefore ?? '');

  await page.getByLabel('MPR window').selectOption('Bone');
  await expect(page.getByTestId('wl-Axial')).toContainText('W 1800');

  await page.getByRole('link', { name: /Studies/ }).click();
  await page.getByRole('row', { name: /Test\^Patient/ }).click();
  await page.getByRole('link', { name: /Synthetic series/ }).click();
  await expect(page.getByRole('progressbar')).toBeHidden({ timeout: 90_000 });
  await awaitPainted(page, 'Axial');
  expect(errors).toEqual([]);
});

test('a painted segmentation survives a reload as a stored DICOM SEG', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('row', { name: /Test\^Patient/ }).click();
  await page.getByRole('link', { name: /Synthetic series/ }).click();
  await expect(page.getByRole('progressbar')).toBeHidden({ timeout: 90_000 });
  await awaitPainted(page, 'Axial');

  await page.getByRole('button', { name: /brush/i }).click();
  const box = (await page.getByTestId('panel-Axial').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55, { steps: 12 });
  await page.mouse.up();

  const save = page.getByRole('button', { name: /save segmentation/i });
  await expect(save).toBeEnabled({ timeout: 15_000 });
  await save.click();
  await expect(page.getByRole('button', { name: /segmentation saved/i })).toBeVisible({
    timeout: 30_000,
  });

  await page.reload();
  await expect(page.getByRole('progressbar')).toBeHidden({ timeout: 90_000 });

  // The proof is the mask coming back out of the store, not rendered pixels:
  // asserting on the overlay under swiftshader would be flaky, and the
  // labelmap endpoint only answers 200 once a real SEG was written, indexed
  // and parsed back.
  const seriesUid = page.url().split('/').pop()!;
  const labelmap = await page.request.get(
    `http://localhost:8001/api/series/${seriesUid}/segmentation/labelmap`,
  );
  expect(labelmap.status()).toBe(200);
  const painted = (await labelmap.body()).reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);
  expect(painted).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('a measurement survives a reload as a stored Structured Report', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('row', { name: /Test\^Patient/ }).click();
  await page.getByRole('link', { name: /Synthetic series/ }).click();
  await expect(page.getByRole('progressbar')).toBeHidden({ timeout: 90_000 });
  await awaitPainted(page, 'Axial');

  await page.getByRole('button', { name: /length/i }).click();
  const box = (await page.getByTestId('panel-Axial').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 10 });
  await page.mouse.up();

  const save = page.getByRole('button', { name: /save measurements/i });
  await expect(save).toBeEnabled({ timeout: 15_000 });
  await save.click();
  await expect(page.getByRole('button', { name: /^saved$/i })).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByRole('progressbar')).toBeHidden({ timeout: 90_000 });
  // The download link only renders once the backend has reported an srSopUid
  // on a fresh GET, which means it wrote a real DICOM SR, indexed it as its
  // own series, and parsed it back. That is the whole round trip in one
  // assertion.
  const link = page.getByRole('link', { name: /download report/i });
  await expect(link).toBeVisible({ timeout: 30_000 });
  // And the report comes back as a DICOM object over WADO-RS.
  const href = await link.getAttribute('href');
  expect((await page.request.get(href!)).status()).toBe(200);

  expect(errors).toEqual([]);
});

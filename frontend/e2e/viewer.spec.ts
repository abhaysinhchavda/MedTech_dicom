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

test('open series, scroll, crosshairs, preset, reopen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('row', { name: /Test\^Patient/ }).click();
  await page.getByRole('link', { name: /Synthetic series/ }).click();
  await expect(page.getByRole('progressbar')).toBeHidden({ timeout: 90_000 });
  for (const p of ['Axial', 'Sagittal', 'Coronal', '3D'])
    await expect.poll(() => canvasIsNonBlack(page, p), { timeout: 30_000 }).toBe(true);

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
  await expect.poll(() => canvasIsNonBlack(page, 'Axial'), { timeout: 30_000 }).toBe(true);
  expect(errors).toEqual([]);
});

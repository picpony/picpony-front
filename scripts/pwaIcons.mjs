/** Reuse the app's square mark. The source is raster; no wordmark is cropped or redrawn. */
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const source = await readFile(path.join(root, 'public/icon-128.png'));
for (const size of [192, 512]) {
  await sharp(source).resize(size, size).png().toFile(path.join(root, `public/icon-${size}.png`));
}
// A 56% square fits wholly within the maskable 80%-diameter circular safe area.
const markSize = Math.floor(512 * 0.56);
const mark = await sharp(source).resize(markSize, markSize).png().toBuffer();
// Installed-app artwork precedes CSS; use the default surface from the theme authority.
const css = await readFile(path.join(root, 'app/globals.css'), 'utf8');
const background = css.match(/--md-sys-color-surface:\s*(#[\da-f]{6});/i)?.[1];
if (!background) throw new Error('Missing default surface token');
await sharp({ create: { width: 512, height: 512, channels: 4, background } })
  .composite([{ input: mark, gravity: 'centre' }]).png()
  .toFile(path.join(root, 'public/icon-maskable-512.png'));
console.log('PWA icons: 192, 512, maskable 512');

// Renders the PNG icons the install prompt needs from public/icon.svg.
//   npm run icons
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const svg = readFileSync(join(pub, 'icon.svg'));

await sharp(svg, { density: 300 }).resize(192, 192).png().toFile(join(pub, 'icon-192.png'));
await sharp(svg, { density: 300 }).resize(512, 512).png().toFile(join(pub, 'icon-512.png'));

// Maskable: full-bleed background with the artwork inside the central safe zone.
const inner = await sharp(svg, { density: 300 }).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#1c1b19' } })
  .composite([{ input: inner, gravity: 'centre' }])
  .png()
  .toFile(join(pub, 'icon-maskable-512.png'));

console.log('Icons written to public/');

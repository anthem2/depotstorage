/**
 * One-shot asset generator for Elizabethton Depot Storage.
 *
 * 1. Trace the source PNG into a real vector SVG (potrace) — true scalable logo.
 * 2. Render the SVG into responsive PNG variants (sharp) for header/footer/<img srcset>.
 * 3. Render favicon PNG sizes + apple-touch-icon.
 * 4. Composite the logo onto a cream OG/Twitter-card image (1200x630).
 *
 * Run from depotstorage/ with: node scripts/generate-images.js
 */

const sharp   = require('sharp');
const potrace = require('potrace');
const fs      = require('fs');
const path    = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_PNG = path.join(ROOT, 'public', 'assets', 'logo.png');
const OUT_SVG = path.join(ROOT, 'public', 'assets', 'logo.svg');
const PUB     = path.join(ROOT, 'public');
const ASS     = path.join(PUB, 'assets');

const BURGUNDY = '#6F2E32';                                  // brand --burgundy
const CREAM    = { r: 0xF3, g: 0xEB, b: 0xDD, alpha: 1 };    // brand --cream

if (!fs.existsSync(SRC_PNG)) {
  console.error('Source PNG not found:', SRC_PNG);
  process.exit(1);
}

/* ---------- Step 1: trace PNG → SVG ---------- */

async function traceToSvg() {
  // Pre-process: upscale 4x with high-quality kernel, then flatten alpha onto
  // white so potrace sees a clean burgundy-on-white image with crisp edges.
  const prepped = await sharp(SRC_PNG)
    .resize(2000, 2000, { fit: 'contain', kernel: sharp.kernel.lanczos3, background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 0 })
    .toBuffer();

  const svg = await new Promise((resolve, reject) => {
    potrace.trace(
      prepped,
      {
        threshold: 180,         // anything darker than this becomes a filled path
        color: BURGUNDY,        // recolor traced paths to brand burgundy
        background: 'transparent',
        turdSize: 4,            // drop noise smaller than 4px (at 2000px scale)
        optTolerance: 0.25,     // curve-fitting precision (lower = more accurate, bigger file)
        alphaMax: 1.0,
        turnPolicy: 'minority',
      },
      (err, out) => (err ? reject(err) : resolve(out)),
    );
  });

  // Normalize the SVG: drop hardcoded width/height so it scales freely; preserve viewBox.
  // potrace emits <svg version="..." xmlns="..." width="N" height="N" viewBox="...">
  const cleaned = svg
    .replace(/ width="[^"]+"/, '')
    .replace(/ height="[^"]+"/, '')
    .replace(
      /<svg /,
      '<svg role="img" aria-label="Elizabethton Depot Storage" '
    );

  fs.writeFileSync(OUT_SVG, cleaned);
  return Buffer.from(cleaned);
}

/* ---------- Step 2: render PNGs from the SVG ---------- */

async function renderPng(svgBuf, size, outFile, { background = null, padding = 0 } = {}) {
  const inner = Math.round(size * (1 - padding * 2));
  // Render the SVG at ~2x the inner size for sharp downsampling, then resize to exact.
  // Density is computed against the SVG viewBox of 2000 so we stay well below sharp's pixel limit.
  const density = Math.max(72, Math.ceil((inner * 2) * 72 / 2000));
  let pipeline = sharp(svgBuf, { density })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });

  if (background || padding > 0) {
    const pad = Math.round((size - inner) / 2);
    pipeline = pipeline.extend({
      top: pad, bottom: pad, left: pad, right: pad,
      background: background || { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  await pipeline.png({ compressionLevel: 9 }).toFile(outFile);
}

async function makeOgImage(svgBuf, outFile) {
  const W = 1200, H = 630, LOGO = 420;

  const logoBuf = await sharp(svgBuf, { density: Math.ceil(LOGO * 2 * 72 / 2000) })
    .resize(LOGO, LOGO, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const frame = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
       <rect x="24" y="24" width="${W - 48}" height="${H - 48}"
             fill="none" stroke="#A65A48" stroke-width="2"/>
       <rect x="40" y="40" width="${W - 80}" height="${H - 80}"
             fill="none" stroke="#A65A48" stroke-width="1" opacity="0.4"/>
     </svg>`
  );

  await sharp({ create: { width: W, height: H, channels: 4, background: CREAM } })
    .composite([
      { input: frame,   top: 0, left: 0 },
      { input: logoBuf, top: Math.round((H - LOGO) / 2), left: Math.round((W - LOGO) / 2) },
    ])
    .png({ compressionLevel: 9 })
    .toFile(outFile);
}

/* ---------- Main ---------- */

(async () => {
  console.log('Tracing PNG → SVG...');
  const svgBuf = await traceToSvg();
  const svgSize = fs.statSync(OUT_SVG).size;
  console.log(`  wrote public/assets/logo.svg (${(svgSize / 1024).toFixed(1)} KB)`);

  console.log('Rendering responsive PNG variants...');
  for (const s of [64, 96, 128, 192, 256]) {
    await renderPng(svgBuf, s, path.join(ASS, `logo-${s}.png`));
    console.log(`  wrote public/assets/logo-${s}.png`);
  }

  console.log('Rendering favicons...');
  await renderPng(svgBuf, 16,  path.join(PUB, 'favicon-16.png'),  { padding: 0.06 });
  await renderPng(svgBuf, 32,  path.join(PUB, 'favicon-32.png'),  { padding: 0.06 });
  await renderPng(svgBuf, 48,  path.join(PUB, 'favicon-48.png'),  { padding: 0.06 });
  await renderPng(svgBuf, 180, path.join(PUB, 'apple-touch-icon.png'),
                  { background: CREAM, padding: 0.08 });
  console.log('  wrote public/{favicon-16,favicon-32,favicon-48,apple-touch-icon}.png');

  console.log('Rendering OG image...');
  await makeOgImage(svgBuf, path.join(ASS, 'og-image.png'));
  console.log('  wrote public/assets/og-image.png');

  console.log('Done.');
})().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});

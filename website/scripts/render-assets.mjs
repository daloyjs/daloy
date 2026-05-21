#!/usr/bin/env node
/**
 * Rasterizes every SVG in `public/assets/source/` to PNG at platform-specific
 * sizes. Sources stay the canonical brand assets; PNGs are committed so
 * social platforms (X, Bluesky, Google profiles, app stores, etc.) and
 * Apple Touch / PWA manifests can consume them directly.
 *
 * Why PNG (and not JPEG):
 *   - The brand mark is vector with sharp anti-aliased curves; JPEG's lossy
 *     chroma subsampling produces visible halos around the strokes.
 *   - PNG supports the transparent corners on the masked monochrome mark.
 *   - Modern social platforms accept PNG up to a few MB without issue.
 *
 * Re-render the assets after editing any source SVG:
 *   pnpm run assets:render
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, "..", "public", "assets");
const SOURCE_DIR = path.join(ASSETS_DIR, "source");

/**
 * @typedef {object} Job
 * @property {string} src        Source SVG file in /public/assets/source/.
 * @property {string} out        Output PNG path relative to /public/assets/.
 * @property {number} width      Target width in px (height inferred unless `height` set).
 * @property {number} [height]   Target height in px (for non-1:1 aspect outputs).
 * @property {string} [bg]       Optional flat background color (e.g. "#0c0c0c").
 */

/** @type {Job[]} */
const JOBS = [
  // ── Browser favicons ────────────────────────────────────────────────────
  { src: "icon-dark.svg", out: "favicon-16.png", width: 16 },
  { src: "icon-dark.svg", out: "favicon-32.png", width: 32 },
  { src: "icon-dark.svg", out: "favicon-48.png", width: 48 },

  // ── iOS / Apple Touch ──────────────────────────────────────────────────
  // Apple recommends 180×180 with a fully-opaque background (no transparency).
  { src: "icon-dark.svg", out: "apple-touch-icon.png", width: 180 },

  // ── PWA / Android manifest icons ───────────────────────────────────────
  { src: "icon-dark.svg", out: "icon-192.png", width: 192 },
  { src: "icon-dark.svg", out: "icon-512.png", width: 512 },

  // ── Social profile pictures (X, Bluesky, Google, GitHub org) ───────────
  // 1000×1000 is the largest universally-accepted profile size and crops
  // cleanly to circles on X/Bluesky. 400×400 is the recommended X minimum.
  { src: "icon-dark.svg", out: "social-avatar-400.png", width: 400 },
  { src: "icon-dark.svg", out: "social-avatar-512.png", width: 512 },
  { src: "icon-dark.svg", out: "social-avatar-1000.png", width: 1000 },
  // Google Business / Workspace profile recommends 720×720 minimum.
  { src: "icon-dark.svg", out: "google-profile-720.png", width: 720 },
  // Light-background avatar variant for surfaces that need contrast.
  { src: "icon-light.svg", out: "social-avatar-light-1000.png", width: 1000 },

  // ── Social banners ─────────────────────────────────────────────────────
  // X header: 1500×500 (3:1). Bluesky banner: 3000×1000 (3:1). Same SVG.
  { src: "banner-social.svg", out: "banner-x-1500x500.png", width: 1500, height: 500 },
  {
    src: "banner-social.svg",
    out: "banner-bluesky-3000x1000.png",
    width: 3000,
    height: 1000,
  },

  // ── README banners (light theme, 3:1) ──────────────────────────────────
  // GitHub READMEs default to a light surface, so we ship a light variant at
  // a README-friendly width (~1280 displays crisply on retina without
  // ballooning page weight). The 1500-wide variant doubles as a generic
  // light social banner for marketing pages.
  {
    src: "banner-social-light.svg",
    out: "banner-light-1280x426.png",
    width: 1280,
    height: 426,
  },
  {
    src: "banner-social-light.svg",
    out: "banner-light-1500x500.png",
    width: 1500,
    height: 500,
  },

  // ── Static OG image fallback (some crawlers prefer a static URL) ───────
  { src: "og-image.svg", out: "og-image.png", width: 1200, height: 630 },
];

async function renderJob(/** @type {Job} */ job) {
  const srcPath = path.join(SOURCE_DIR, job.src);
  const outPath = path.join(ASSETS_DIR, job.out);
  const svg = await readFile(srcPath);
  // Default to a square output when no height is given. This is critical for
  // sharp's resize() with fit:"fill" — passing height:undefined silently
  // produces the wrong aspect ratio (sharp falls back to "inside" and
  // multiplies by the SVG's intrinsic ratio, which is unreliable for some
  // sources). Every icon job in this script is square; banners pass both.
  const targetWidth = job.width;
  const targetHeight = job.height ?? job.width;
  // Adaptive density: oversample 4× the target so anti-aliasing has headroom,
  // capped to avoid running into sharp's pixel-limit guard on huge banners.
  const targetMax = Math.max(targetWidth, targetHeight);
  const density = Math.min(1200, Math.max(96, targetMax * 4));
  const pipeline = sharp(svg, {
    density,
    // Banners can exceed sharp's default 268MP guard at 4× oversample.
    limitInputPixels: false,
  }).resize({
    width: targetWidth,
    height: targetHeight,
    fit: "fill",
    kernel: "lanczos3",
  });
  if (job.bg) {
    pipeline.flatten({ background: job.bg });
  }
  // Small icons compress dramatically better as 8-bit indexed PNGs without
  // visible quality loss; large social art keeps full 24-bit color.
  const usePalette = targetMax <= 64;
  await pipeline
    .png({
      compressionLevel: 9,
      palette: usePalette,
      quality: usePalette ? 90 : 100,
      effort: 10,
    })
    .toFile(outPath);
  return outPath;
}

/**
 * Build a multi-resolution ICO from the in-memory PNG buffers for the given
 * sizes. We embed PNG-encoded images (the Vista+ "PNG inside ICO" format)
 * which every modern browser, Windows Explorer (≥ Vista), and macOS support.
 * See https://en.wikipedia.org/wiki/ICO_(file_format)#Outline.
 *
 * @param {Array<{ size: number; png: Buffer }>} entries
 * @returns {Buffer}
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  const pngs = [];
  let offset = header.length + directory.length;
  for (let i = 0; i < entries.length; i += 1) {
    const { size, png } = entries[i];
    const base = i * 16;
    // ICO encodes 256 as 0.
    directory.writeUInt8(size >= 256 ? 0 : size, base + 0);
    directory.writeUInt8(size >= 256 ? 0 : size, base + 1);
    directory.writeUInt8(0, base + 2); // color count (0 for >= 8bpp)
    directory.writeUInt8(0, base + 3); // reserved
    directory.writeUInt16LE(1, base + 4); // color planes
    directory.writeUInt16LE(32, base + 6); // bits per pixel
    directory.writeUInt32LE(png.length, base + 8); // bytes in PNG
    directory.writeUInt32LE(offset, base + 12); // offset to PNG
    pngs.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, directory, ...pngs]);
}

/**
 * Render the favicon.ico file by rasterizing the source icon at 16, 32, and
 * 48 px and packaging the PNGs inside an ICO container. Writes the result to
 * both `public/favicon.ico` (root-path browser fallback) and
 * `public/assets/favicon.ico` (canonical location referenced from metadata).
 */
async function renderFavicon() {
  const srcPath = path.join(SOURCE_DIR, "icon-dark.svg");
  const svg = await readFile(srcPath);
  const sizes = [16, 32, 48];
  const entries = [];
  for (const size of sizes) {
    const png = await sharp(svg, { density: Math.max(96, size * 8) })
      .resize({ width: size, height: size, fit: "fill", kernel: "lanczos3" })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer();
    entries.push({ size, png });
  }
  const ico = buildIco(entries);
  const assetsIco = path.join(ASSETS_DIR, "favicon.ico");
  const publicRoot = path.resolve(ASSETS_DIR, "..");
  const rootIco = path.join(publicRoot, "favicon.ico");
  await writeFile(assetsIco, ico);
  await writeFile(rootIco, ico);
  return { bytes: ico.length, sizes };
}

async function main() {
  await mkdir(ASSETS_DIR, { recursive: true });
  const failures = [];
  for (const job of JOBS) {
    try {
      const out = await renderJob(job);
      const sizeLabel = job.height ? `${job.width}x${job.height}` : `${job.width}`;
      console.log(`  rendered  ${path.relative(ASSETS_DIR, out)}  (${sizeLabel}px)`);
    } catch (err) {
      failures.push({ job, err });
      console.error(`  failed    ${job.out}:`, err instanceof Error ? err.message : err);
    }
  }
  // Assemble the multi-size favicon.ico (16/32/48). Browsers and the
  // Windows shell auto-fetch /favicon.ico independently of the <link rel>
  // tags, so we always emit a fresh DaloyJS-branded ICO here.
  try {
    const ico = await renderFavicon();
    console.log(
      `  rendered  favicon.ico  (${ico.sizes.join("/")}px multi-res, ${ico.bytes} B)  -> public/ and public/assets/`,
    );
  } catch (err) {
    failures.push({ job: { out: "favicon.ico" }, err });
    console.error("  failed    favicon.ico:", err instanceof Error ? err.message : err);
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} asset(s) failed to render.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nDone. ${JOBS.length} PNG asset(s) + favicon.ico written to ${path.relative(process.cwd(), ASSETS_DIR)}/.`);
  // Quick byte-size summary for the README.
  const sizes = await Promise.all(
    JOBS.map(async (j) => {
      const fp = path.join(ASSETS_DIR, j.out);
      const buf = await readFile(fp);
      return { name: j.out, bytes: buf.length };
    }),
  );
  const total = sizes.reduce((acc, s) => acc + s.bytes, 0);
  console.log(`Total bytes: ${(total / 1024).toFixed(1)} KiB`);
  // Write a manifest so build steps can verify nothing was deleted.
  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: "scripts/render-assets.mjs",
    source: "public/assets/source/",
    files: sizes,
  };
  await writeFile(
    path.join(ASSETS_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import {
  copyFileSync,
  existsSync,
  mkdirSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const packageDirectory = join(rootDirectory, "node_modules", "@ffmpeg");
const targetRoot = join(rootDirectory, "public", "ffmpeg");

const assets = [
  {
    source: join(
      packageDirectory,
      "core",
      "dist",
      "esm",
      "ffmpeg-core.js"
    ),
    target: join(targetRoot, "core", "ffmpeg-core.js")
  },
  {
    source: join(
      packageDirectory,
      "core",
      "dist",
      "esm",
      "ffmpeg-core.wasm"
    ),
    target: join(targetRoot, "core", "ffmpeg-core.wasm")
  },
  {
    source: join(
      packageDirectory,
      "core-mt",
      "dist",
      "esm",
      "ffmpeg-core.js"
    ),
    target: join(targetRoot, "core-mt", "ffmpeg-core.js")
  },
  {
    source: join(
      packageDirectory,
      "core-mt",
      "dist",
      "esm",
      "ffmpeg-core.wasm"
    ),
    target: join(targetRoot, "core-mt", "ffmpeg-core.wasm")
  },
  {
    source: join(
      packageDirectory,
      "core-mt",
      "dist",
      "esm",
      "ffmpeg-core.worker.js"
    ),
    target: join(targetRoot, "core-mt", "ffmpeg-core.worker.js")
  }
];

for (const asset of assets) {
  if (!existsSync(asset.source)) {
    throw new Error(
      `FFmpeg asset not found: ${asset.source}. Run npm install first.`
    );
  }

  mkdirSync(dirname(asset.target), { recursive: true });
  copyFileSync(asset.source, asset.target);
}

console.log(`[ffmpeg-assets] copied ${assets.length} files to public/ffmpeg`);

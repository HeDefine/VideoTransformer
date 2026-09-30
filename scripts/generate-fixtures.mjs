import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDirectory = join(rootDirectory, "e2e", "fixtures");

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    ...options
  });
}

function runFfmpeg(args) {
  console.log(`[fixtures] ffmpeg ${args.join(" ")}`);
  const result = spawnSync("ffmpeg", args, {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with status ${result.status ?? "unknown"}`);
  }
}

const ffmpegVersion = run("ffmpeg", ["-version"]);

if (ffmpegVersion.error || ffmpegVersion.status !== 0) {
  console.warn(
    "[fixtures] 未找到系统 ffmpeg，已跳过媒体夹具生成。安装 ffmpeg 后重新运行 npm run generate:fixtures。"
  );
  process.exit(0);
}

const encodersResult = run("ffmpeg", ["-hide_banner", "-encoders"]);
const encoderList = `${encodersResult.stdout ?? ""}\n${encodersResult.stderr ?? ""}`;

if (encodersResult.status !== 0 || !encoderList.includes("libx264")) {
  console.warn("[fixtures] 当前 ffmpeg 不包含 libx264，已跳过夹具生成。");
  process.exit(0);
}

mkdirSync(fixtureDirectory, { recursive: true });

const inputArgs = [
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=160x120:rate=30",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=1000:sample_rate=48000"
];
const commonOutputArgs = [
  "-t",
  "2",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "64k",
  "-movflags",
  "+faststart"
];

runFfmpeg([
  "-y",
  ...inputArgs,
  "-c:v",
  "libx264",
  "-profile:v",
  "high",
  "-level:v",
  "4.1",
  ...commonOutputArgs,
  join(fixtureDirectory, "h264.mp4")
]);

runFfmpeg([
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=160x120:rate=30",
  "-t",
  "2",
  "-c:v",
  "libx264",
  "-profile:v",
  "high",
  "-level:v",
  "4.1",
  "-pix_fmt",
  "yuv420p",
  "-an",
  "-movflags",
  "+faststart",
  join(fixtureDirectory, "h264-no-audio.mp4")
]);

if (!encoderList.includes("libx265")) {
  console.warn(
    "[fixtures] 当前 ffmpeg 不包含 libx265，HEVC 夹具未生成；其他可用夹具已生成。"
  );
} else {
  runFfmpeg([
    "-y",
    ...inputArgs,
    "-c:v",
    "libx265",
    "-tag:v",
    "hvc1",
    "-preset",
    "ultrafast",
    ...commonOutputArgs,
    join(fixtureDirectory, "hevc.mp4")
  ]);

  runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x120:rate=30",
    "-t",
    "2",
    "-c:v",
    "libx265",
    "-tag:v",
    "hvc1",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-an",
    "-movflags",
    "+faststart",
    join(fixtureDirectory, "hevc-no-audio.mp4")
  ]);

  runFfmpeg([
    "-y",
    ...inputArgs,
    "-c:v",
    "libx265",
    "-tag:v",
    "hvc1",
    "-preset",
    "ultrafast",
    ...commonOutputArgs,
    join(fixtureDirectory, "hevc.mov")
  ]);

  copyFileSync(
    join(fixtureDirectory, "hevc.mp4"),
    join(fixtureDirectory, "中文HEVC.mp4")
  );
}

copyFileSync(
  join(fixtureDirectory, "h264.mp4"),
  join(fixtureDirectory, "中文文件名.mp4")
);

writeFileSync(
  join(fixtureDirectory, "damaged.mp4"),
  "this is not a valid mp4 file\n",
  "utf8"
);

console.log(`[fixtures] 夹具已生成：${fixtureDirectory}`);

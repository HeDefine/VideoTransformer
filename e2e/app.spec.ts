import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createFile, MP4BoxBuffer, type Movie } from "mp4box";

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDirectory = join(rootDirectory, "e2e", "fixtures");
const ffprobeBinary = process.env.FFPROBE_PATH ?? "ffprobe";
const ffprobeAvailable =
  spawnSync(ffprobeBinary, ["-version"], {
    encoding: "utf8"
  }).status === 0;

function fixturePath(fileName: string): string {
  return join(fixtureDirectory, fileName);
}

function fixtureExists(fileName: string): boolean {
  return existsSync(fixturePath(fileName));
}

function isSingleThreadProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.includes("single-thread");
}

async function selectFixture(page: Page, fileName: string): Promise<void> {
  await page.getByTestId("video-input").setInputFiles(fixturePath(fileName));
}

function hasFastStart(filePath: string): boolean {
  const fileSize = statSync(filePath).size;
  const descriptor = openSync(filePath, "r");
  const header = Buffer.alloc(16);
  let offset = 0;
  let moovOffset = -1;
  let mdatOffset = -1;

  try {
    while (offset + 8 <= fileSize) {
      const bytesRead = readSync(
        descriptor,
        header,
        0,
        Math.min(header.length, fileSize - offset),
        offset
      );

      if (bytesRead < 8) {
        break;
      }

      const size = header.readUInt32BE(0);
      const type = header.toString("ascii", 4, 8);

      if (type === "moov" && moovOffset < 0) {
        moovOffset = offset;
      }

      if (type === "mdat" && mdatOffset < 0) {
        mdatOffset = offset;
      }

      if (moovOffset >= 0 && mdatOffset >= 0) {
        break;
      }

      if (size < 8) {
        break;
      }

      offset += size;
    }
  } finally {
    closeSync(descriptor);
  }

  return moovOffset >= 0 && mdatOffset >= 0 && moovOffset < mdatOffset;
}

interface Mp4Inspection {
  videoCodec: string | undefined;
  audioCodec: string | undefined;
  width: number | undefined;
  height: number | undefined;
}

function inspectMp4(filePath: string): Mp4Inspection {
  const fileBuffer = readFileSync(filePath);
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );
  const isoFile = createFile();
  let movie: Movie | undefined;

  isoFile.onReady = (info) => {
    movie = info;
  };
  isoFile.appendBuffer(MP4BoxBuffer.fromArrayBuffer(arrayBuffer, 0));
  isoFile.flush();
  isoFile.stop();

  if (!movie) {
    throw new Error(`Unable to parse downloaded MP4: ${filePath}`);
  }

  const parsedMovie = movie as Movie;
  const videoTrack = parsedMovie.videoTracks[0];

  return {
    videoCodec: videoTrack?.codec,
    audioCodec: parsedMovie.audioTracks[0]?.codec,
    width: videoTrack?.video?.width ?? videoTrack?.track_width,
    height: videoTrack?.video?.height ?? videoTrack?.track_height
  };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("renders the local-only transcoder workspace", async ({ page }) => {
  await expect(
    page.getByRole("heading", {
      name: "把 HEVC 视频转换成 Android WebView 可播放的 H.264 MP4"
    })
  ).toBeVisible();
  await expect(page.getByText("文件仅在当前浏览器本地处理，不会上传服务器。单文件上限 300MB、5 分钟。")).toBeVisible();
  await expect(page.getByRole("link", { name: "第三方许可与源码获取说明" })).toBeVisible();
});

test("reports the active isolation mode", async ({ page }, testInfo) => {
  const expectedMode = isSingleThreadProject(testInfo)
    ? "单线程模式"
    : "多线程模式";

  await expect(page.getByText(expectedMode)).toBeVisible();
});

test("rejects unsupported file extensions", async ({ page }) => {
  await page.getByTestId("video-input").setInputFiles({
    name: "clip.mkv",
    mimeType: "video/x-matroska",
    buffer: Buffer.from("not a supported file")
  });

  await expect(page.getByRole("alert")).toContainText("仅支持 MP4 和 MOV");
});

test("rejects files larger than 300MB before reading them", async ({ page }) => {
  await page.evaluate(() => {
    const file = new File([new Uint8Array([1])], "huge.mp4", {
      type: "video/mp4"
    });
    Object.defineProperty(file, "size", {
      value: 300 * 1024 * 1024 + 1
    });

    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"]'
    );

    if (!input) {
      throw new Error("File input not found.");
    }

    Object.defineProperty(input, "files", {
      configurable: true,
      value: transfer.files
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(page.getByRole("alert")).toContainText("超过 300MB");
});

test("reports a damaged MP4", async ({ page }) => {
  test.skip(
    !fixtureExists("damaged.mp4"),
    "Run npm run generate:fixtures with ffmpeg first."
  );

  await selectFixture(page, "damaged.mp4");
  await expect(page.getByRole("alert")).toContainText("无法解析视频信息", {
    timeout: 30_000
  });
});

test("detects H.264 and disables conversion", async ({ page }) => {
  test.skip(
    !fixtureExists("h264.mp4"),
    "Run npm run generate:fixtures with ffmpeg first."
  );

  await selectFixture(page, "h264.mp4");

  await expect(page.getByText("H.264 / AVC")).toBeVisible();
  await expect(page.getByText("该文件已经是 H.264/AVC，无需转换。")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始转换" })).toBeDisabled();
});

test("detects HEVC in MP4 and MOV containers", async ({ page }) => {
  test.skip(
    !fixtureExists("hevc.mp4") || !fixtureExists("hevc.mov"),
    "Run npm run generate:fixtures with ffmpeg first."
  );

  await selectFixture(page, "hevc.mp4");
  await expect(page.getByText("HEVC / H.265")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始转换" })).toBeEnabled();

  await selectFixture(page, "hevc.mov");
  await expect(page.getByText("HEVC / H.265")).toBeVisible();
  await expect(page.getByText("MOV", { exact: true })).toBeVisible();
});

test("detects a video without an audio track", async ({ page }) => {
  test.skip(
    !fixtureExists("h264-no-audio.mp4"),
    "Run npm run generate:fixtures with ffmpeg first."
  );

  await selectFixture(page, "h264-no-audio.mp4");
  await expect(page.getByText("无音轨")).toBeVisible();
});

test("transcodes HEVC, reports progress, downloads, and verifies output", async (
  { page },
  testInfo
) => {
  test.skip(
    !fixtureExists("中文HEVC.mp4"),
    "Run npm run generate:fixtures with ffmpeg first."
  );

  await selectFixture(page, "中文HEVC.mp4");
  await expect(page.getByText("HEVC / H.265")).toBeVisible();
  await page.getByRole("button", { name: "开始转换" }).click();

  await expect(page.getByText("正在加载转换核心")).toBeVisible();
  await expect(page.getByTestId("download-link")).toBeVisible({
    timeout: 120_000
  });
  await expect(page.getByText("转换完成")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-link").click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();

  expect(download.suggestedFilename()).toBe("中文HEVC_h264_high.mp4");
  expect(downloadedPath).not.toBeNull();
  expect(hasFastStart(downloadedPath!)).toBe(true);

  const containerInspection = inspectMp4(downloadedPath!);

  expect(containerInspection.videoCodec).toMatch(/^avc1\.640029$/);
  expect(containerInspection.audioCodec).toMatch(/^mp4a\.40\.2$/);
  expect(containerInspection.width).toBe(160);
  expect(containerInspection.height).toBe(120);

  if (ffprobeAvailable) {
    const probeResult = spawnSync(
      ffprobeBinary,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,profile,level,pix_fmt",
        "-of",
        "json",
        downloadedPath!
      ],
      { encoding: "utf8" }
    );

    expect(probeResult.status, probeResult.stderr).toBe(0);
    const probeJson = JSON.parse(probeResult.stdout) as {
      streams: Array<{
        codec_name: string;
        profile: string;
        level: number;
        pix_fmt: string;
      }>;
    };
    const videoStream = probeJson.streams[0];

    expect(videoStream.codec_name).toBe("h264");
    expect(videoStream.profile).toBe("High");
    expect(videoStream.level).toBe(41);
    expect(videoStream.pix_fmt).toBe("yuv420p");

    const audioResult = spawnSync(
      ffprobeBinary,
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name,profile",
        "-of",
        "json",
        downloadedPath!
      ],
      { encoding: "utf8" }
    );

    expect(audioResult.status, audioResult.stderr).toBe(0);
    const audioJson = JSON.parse(audioResult.stdout) as {
      streams: Array<{ codec_name: string; profile?: string }>;
    };

    expect(audioJson.streams[0]?.codec_name).toBe("aac");
    expect(audioJson.streams[0]?.profile).toBe("LC");
  } else {
    testInfo.annotations.push({
      type: "skip-note",
      description:
        "System ffprobe is not installed; deep profile and pixel-format checks were skipped."
    });
  }
});

test("cancels an active conversion and returns to ready state", async (
  { page },
  testInfo
) => {
  test.skip(
    isSingleThreadProject(testInfo),
    "Single-thread projects only verify fallback startup."
  );
  test.skip(
    !fixtureExists("hevc.mp4"),
    "Run npm run generate:fixtures with ffmpeg first."
  );

  await selectFixture(page, "hevc.mp4");
  await page.getByRole("button", { name: "开始转换" }).click();
  await page.getByTestId("cancel-button").click();

  await expect(page.getByText("可以转换为 H.264，请选择目标设备预设。")).toBeVisible({
    timeout: 30_000
  });
  await expect(page.getByRole("button", { name: "开始转换" })).toBeEnabled();
});

import type { VideoProbe } from "../types";
import { UserFacingError } from "./errors";

export const MAX_FILE_SIZE_BYTES = 300 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 5 * 60;
export const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov"]);

export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

export function validateInputFile(file: File): void {
  const extension = getFileExtension(file.name);

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new UserFacingError(
      "仅支持 MP4 和 MOV 视频文件。",
      "invalid-file"
    );
  }

  if (file.size <= 0) {
    throw new UserFacingError("视频文件为空。", "invalid-file");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new UserFacingError(
      "视频大小超过 300MB，请先压缩或截短后重试。",
      "file-too-large"
    );
  }
}

export function validateProbeLimits(probe: VideoProbe): void {
  if (probe.durationSeconds <= 0) {
    throw new UserFacingError(
      "无法读取视频时长，文件可能已损坏。",
      "probe-failed"
    );
  }

  if (probe.durationSeconds > MAX_DURATION_SECONDS) {
    throw new UserFacingError(
      "视频时长超过 5 分钟，请先截短后重试。",
      "duration-too-long"
    );
  }
}

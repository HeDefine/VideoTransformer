import { describe, expect, it } from "vitest";
import type { VideoProbe } from "../types";
import { UserFacingError, type UserFacingErrorCode } from "./errors";
import {
  getFileExtension,
  MAX_DURATION_SECONDS,
  MAX_FILE_SIZE_BYTES,
  validateInputFile,
  validateProbeLimits
} from "./validation";

function makeFile(
  name: string,
  size: number,
  type = "video/mp4"
): File {
  const file = new File([new Uint8Array([1])], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function getErrorCode(action: () => void): UserFacingErrorCode {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(UserFacingError);
    return (error as UserFacingError).code;
  }

  throw new Error("Expected action to throw.");
}

function makeProbe(durationSeconds: number): VideoProbe {
  return {
    codec: "hevc",
    codecString: "hvc1.1.6.L120.90",
    container: "mp4",
    durationSeconds,
    sizeBytes: 1024,
    isHdr: false,
    compatible: false
  };
}

describe("file validation", () => {
  it("normalizes supported extensions", () => {
    expect(getFileExtension("clip.MP4")).toBe(".mp4");
    expect(getFileExtension("clip.MOV")).toBe(".mov");
    expect(getFileExtension("clip")).toBe("");
  });

  it("accepts MP4 and MOV within the size limit", () => {
    expect(() => validateInputFile(makeFile("clip.mp4", 1024))).not.toThrow();
    expect(() => validateInputFile(makeFile("clip.MOV", 1024))).not.toThrow();
  });

  it("rejects unsupported names, empty files, and files above 300MB", () => {
    expect(
      getErrorCode(() => validateInputFile(makeFile("clip.mkv", 1024)))
    ).toBe("invalid-file");
    expect(
      getErrorCode(() => validateInputFile(makeFile("clip.mp4", 0)))
    ).toBe("invalid-file");
    expect(
      getErrorCode(() =>
        validateInputFile(
          makeFile("clip.mp4", MAX_FILE_SIZE_BYTES + 1)
        )
      )
    ).toBe("file-too-large");
  });
});

describe("probe validation", () => {
  it("accepts media up to five minutes", () => {
    expect(() =>
      validateProbeLimits(makeProbe(MAX_DURATION_SECONDS))
    ).not.toThrow();
  });

  it("classifies unreadable durations and videos above five minutes", () => {
    expect(
      getErrorCode(() => validateProbeLimits(makeProbe(0)))
    ).toBe("probe-failed");
    expect(
      getErrorCode(() =>
        validateProbeLimits(makeProbe(MAX_DURATION_SECONDS + 0.01))
      )
    ).toBe("duration-too-long");
  });
});

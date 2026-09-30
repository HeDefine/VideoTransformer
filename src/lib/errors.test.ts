import { describe, expect, it } from "vitest";
import {
  getErrorMessage,
  UserFacingError,
  type UserFacingErrorCode
} from "./errors";

const ERROR_CODES: UserFacingErrorCode[] = [
  "invalid-file",
  "file-too-large",
  "duration-too-long",
  "unsupported-format",
  "probe-failed",
  "ffmpeg-failed",
  "cancelled"
];

describe("user-facing errors", () => {
  it("preserves every supported error classification", () => {
    for (const code of ERROR_CODES) {
      const error = new UserFacingError(`message:${code}`, code);
      expect(error.code).toBe(code);
      expect(getErrorMessage(error)).toBe(`message:${code}`);
    }
  });

  it("uses native and fallback messages for unknown failures", () => {
    expect(getErrorMessage(new Error("native failure"))).toBe("native failure");
    expect(getErrorMessage("unknown failure")).toBe(
      "处理视频时发生未知错误。"
    );
  });
});

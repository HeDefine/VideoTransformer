import { describe, expect, it } from "vitest";
import {
  buildOutputName,
  makeUniqueName,
  stripFileExtension
} from "./filename";

describe("output filenames", () => {
  it("strips the source extension", () => {
    expect(stripFileExtension("sample.MOV")).toBe("sample");
    expect(stripFileExtension("sample")).toBe("sample");
  });

  it("builds preset-specific MP4 names and keeps Chinese characters", () => {
    expect(buildOutputName("产品演示.mov", "android8-high")).toBe(
      "产品演示_h264_high.mp4"
    );
    expect(buildOutputName("clip.mp4", "android5-main")).toBe(
      "clip_h264_main.mp4"
    );
    expect(buildOutputName("clip.mp4", "legacy-baseline")).toBe(
      "clip_h264_baseline.mp4"
    );
  });

  it("sanitizes characters that are invalid in common file systems", () => {
    expect(buildOutputName('a:b<c>d|e?.mp4', "android8-high")).toBe(
      "a_b_c_d_e__h264_high.mp4"
    );
  });

  it("adds a sequence only when a generated name already exists", () => {
    expect(
      makeUniqueName("clip_h264_high.mp4", new Set())
    ).toBe("clip_h264_high.mp4");
    expect(
      makeUniqueName(
        "clip_h264_high.mp4",
        new Set(["clip_h264_high.mp4"])
      )
    ).toBe("clip_h264_high (1).mp4");
    expect(
      makeUniqueName(
        "clip_h264_high.mp4",
        new Set([
          "clip_h264_high.mp4",
          "clip_h264_high (1).mp4",
          "clip_h264_high (2).mp4"
        ])
      )
    ).toBe("clip_h264_high (3).mp4");
  });
});

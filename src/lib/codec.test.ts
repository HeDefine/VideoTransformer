import { describe, expect, it } from "vitest";
import { getCodecLabel, isDolbyVision, normalizeCodec } from "./codec";

describe("normalizeCodec", () => {
  it.each([
    ["hvc1.1.6.L120.90", "hevc"],
    ["hev1.1.6.L120.90", "hevc"],
    ["h265", "hevc"],
    ["avc1.640028", "h264"],
    ["avc3.4D401E", "h264"],
    ["h264", "h264"],
    ["vp09.00.10.08", "other"],
    ["", "other"]
  ] as const)("classifies %s as %s", (codecString, expected) => {
    expect(normalizeCodec(codecString)).toBe(expected);
  });
});

describe("codec labels", () => {
  it("labels supported codecs and unknown values", () => {
    expect(getCodecLabel("hevc")).toBe("HEVC / H.265");
    expect(getCodecLabel("h264")).toBe("H.264 / AVC");
    expect(getCodecLabel("other")).toBe("其他编码");
  });

  it("recognizes Dolby Vision sample entries", () => {
    expect(isDolbyVision("dvh1.05.06")).toBe(true);
    expect(isDolbyVision("dvhe.05.06")).toBe(true);
    expect(isDolbyVision("hvc1.1.6.L120.90")).toBe(false);
  });
});

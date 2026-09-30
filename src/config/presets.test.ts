import { describe, expect, it } from "vitest";
import type { ProfilePreset } from "../types";
import { buildVideoFilter, getPreset, PROFILE_PRESETS } from "./presets";

describe("profile presets", () => {
  it("defines the required Android compatibility ladder", () => {
    expect(PROFILE_PRESETS.map((item) => item.id)).toEqual([
      "android8-high",
      "android5-main",
      "legacy-baseline"
    ]);
    expect(PROFILE_PRESETS.map((item) => item.profileLabel)).toEqual([
      "高规格",
      "主规格",
      "基础规格"
    ]);
    expect(PROFILE_PRESETS.map((item) => item.blurLevel)).toEqual([
      "低",
      "中",
      "高"
    ]);

    expect(getPreset("android8-high")).toMatchObject({
      profile: "high",
      level: "4.1",
      maxLandscapeWidth: 1920,
      maxLandscapeHeight: 1080,
      maxFps: 30
    });
    expect(getPreset("android5-main")).toMatchObject({
      profile: "main",
      level: "4.0",
      maxLandscapeWidth: 1920,
      maxLandscapeHeight: 1080,
      maxFps: 30
    });
    expect(getPreset("legacy-baseline")).toMatchObject({
      profile: "baseline",
      level: "3.1",
      maxLandscapeWidth: 1280,
      maxLandscapeHeight: 720,
      maxFps: 30
    });
  });

  it("caps frame rate and resolution while preserving orientation", () => {
    const filter = buildVideoFilter(getPreset("legacy-baseline"));

    expect(filter).toContain("fps='min(source_fps,30)'");
    expect(filter).toContain("min(iw,1280)");
    expect(filter).toContain("min(iw,720)");
    expect(filter).toContain("min(ih,720)");
    expect(filter).toContain("min(ih,1280)");
    expect(filter).toContain("force_original_aspect_ratio=decrease");
    expect(filter).toContain("force_divisible_by=2");
  });

  it("rejects an unknown preset id", () => {
    expect(() => getPreset("unknown" as ProfilePreset)).toThrow(
      "Unknown preset"
    );
  });
});

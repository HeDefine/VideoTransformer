import type { ProfilePreset } from "../types";

export interface PresetDefinition {
  id: ProfilePreset;
  label: string;
  compatibility: string;
  codecSummary: string;
  profileLabel: string;
  blurLevel: "低" | "中" | "高";
  profile: "high" | "main" | "baseline";
  level: "4.1" | "4.0" | "3.1";
  maxFps: number;
  maxLandscapeWidth: number;
  maxLandscapeHeight: number;
  maxPortraitWidth: number;
  maxPortraitHeight: number;
}

export const PROFILE_PRESETS: readonly PresetDefinition[] = [
  {
    id: "android8-high",
    label: "Android 8+",
    compatibility: "现代设备",
    codecSummary: "高规格（High Profile）4.1 · 1080p30",
    profileLabel: "高规格",
    blurLevel: "低",
    profile: "high",
    level: "4.1",
    maxFps: 30,
    maxLandscapeWidth: 1920,
    maxLandscapeHeight: 1080,
    maxPortraitWidth: 1080,
    maxPortraitHeight: 1920
  },
  {
    id: "android5-main",
    label: "Android 5–7",
    compatibility: "旧版系统",
    codecSummary: "主规格（Main Profile）4.0 · 1080p30",
    profileLabel: "主规格",
    blurLevel: "中",
    profile: "main",
    level: "4.0",
    maxFps: 30,
    maxLandscapeWidth: 1920,
    maxLandscapeHeight: 1080,
    maxPortraitWidth: 1080,
    maxPortraitHeight: 1920
  },
  {
    id: "legacy-baseline",
    label: "旧设备兜底",
    compatibility: "最大兼容",
    codecSummary: "基础规格（Baseline Profile）3.1 · 720p30",
    profileLabel: "基础规格",
    blurLevel: "高",
    profile: "baseline",
    level: "3.1",
    maxFps: 30,
    maxLandscapeWidth: 1280,
    maxLandscapeHeight: 720,
    maxPortraitWidth: 720,
    maxPortraitHeight: 1280
  }
];

export function getPreset(presetId: ProfilePreset): PresetDefinition {
  const preset = PROFILE_PRESETS.find((item) => item.id === presetId);

  if (!preset) {
    throw new Error(`Unknown preset: ${presetId}`);
  }

  return preset;
}

export function buildVideoFilter(preset: PresetDefinition): string {
  const fpsFilter = `fps='min(source_fps,${preset.maxFps})'`;
  const widthExpression = [
    "if(gte(iw,ih)",
    `min(iw,${preset.maxLandscapeWidth})`,
    `min(iw,${preset.maxPortraitWidth}))`
  ].join(",");
  const heightExpression = [
    "if(gte(iw,ih)",
    `min(ih,${preset.maxLandscapeHeight})`,
    `min(ih,${preset.maxPortraitHeight}))`
  ].join(",");
  const scaleFilter = [
    `scale='${widthExpression}':'${heightExpression}'`,
    "force_original_aspect_ratio=decrease",
    "force_divisible_by=2"
  ].join(":");

  return `${fpsFilter},${scaleFilter}`;
}

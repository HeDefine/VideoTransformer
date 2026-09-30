import { buildVideoFilter, type PresetDefinition } from "../config/presets";

export function buildFfmpegArgs(
  inputName: string,
  outputName: string,
  preset: PresetDefinition
): string[] {
  return [
    "-hide_banner",
    "-i",
    inputName,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "0",
    "-vf",
    buildVideoFilter(preset),
    "-c:v",
    "libx264",
    "-profile:v",
    preset.profile,
    "-level:v",
    preset.level,
    "-preset",
    "fast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-tag:v",
    "avc1",
    "-c:a",
    "aac",
    "-profile:a",
    "aac_low",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    outputName
  ];
}

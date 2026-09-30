import type { ProfilePreset } from "../types";
import { getFileExtension } from "./validation";

const PRESET_SUFFIX: Record<ProfilePreset, string> = {
  "android8-high": "high",
  "android5-main": "main",
  "legacy-baseline": "baseline"
};

export function stripFileExtension(fileName: string): string {
  const extension = getFileExtension(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

export function buildOutputName(
  sourceName: string,
  preset: ProfilePreset
): string {
  const baseName = stripFileExtension(sourceName)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  const safeBaseName = baseName || "video";

  return `${safeBaseName}_h264_${PRESET_SUFFIX[preset]}.mp4`;
}

export function makeUniqueName(
  requestedName: string,
  usedNames: ReadonlySet<string>
): string {
  if (!usedNames.has(requestedName)) {
    return requestedName;
  }

  const extension = getFileExtension(requestedName);
  const baseName = stripFileExtension(requestedName);

  let sequence = 1;
  let candidate = `${baseName} (${sequence})${extension}`;

  while (usedNames.has(candidate)) {
    sequence += 1;
    candidate = `${baseName} (${sequence})${extension}`;
  }

  return candidate;
}

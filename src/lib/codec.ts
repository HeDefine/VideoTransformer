import type { CodecKind } from "../types";

export function normalizeCodec(codecString: string): CodecKind {
  const normalized = codecString.toLowerCase();

  if (
    normalized.startsWith("hvc1") ||
    normalized.startsWith("hev1") ||
    normalized.startsWith("hev2") ||
    normalized.startsWith("dvh1") ||
    normalized.startsWith("dvhe") ||
    normalized.startsWith("h265")
  ) {
    return "hevc";
  }

  if (
    normalized.startsWith("avc1") ||
    normalized.startsWith("avc2") ||
    normalized.startsWith("avc3") ||
    normalized.startsWith("avc4") ||
    normalized.startsWith("h264")
  ) {
    return "h264";
  }

  return "other";
}

export function getCodecLabel(kind: CodecKind): string {
  switch (kind) {
    case "hevc":
      return "HEVC / H.265";
    case "h264":
      return "H.264 / AVC";
    default:
      return "其他编码";
  }
}

export function isDolbyVision(codecString: string): boolean {
  const normalized = codecString.toLowerCase();
  return normalized.startsWith("dvh1") || normalized.startsWith("dvhe");
}

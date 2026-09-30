export type CodecKind = "hevc" | "h264" | "other";

export type ProfilePreset =
  | "android8-high"
  | "android5-main"
  | "legacy-baseline";

export type TranscodeMode = "multi-thread" | "single-thread";

export interface VideoProbe {
  codec: CodecKind;
  codecString: string;
  container: "mp4" | "mov";
  durationSeconds: number;
  sizeBytes: number;
  width?: number;
  height?: number;
  frameRate?: number;
  audioCodec?: string;
  isHdr: boolean;
  compatible: boolean;
}

export interface TranscodeRequest {
  preset: ProfilePreset;
  outputName: string;
  preferredMode?: TranscodeMode;
}

export interface TranscodeModeChange {
  from: TranscodeMode;
  to: TranscodeMode;
  reason: "unavailable" | "failed";
  message: string;
}

export interface TranscodeProgress {
  ratio: number;
  processedSeconds: number;
  speed?: number;
  stage: "loading-core" | "probing" | "transcoding" | "saving";
}

export interface TranscodeResult {
  blob: Blob;
  fileName: string;
}

export interface BrowserMediaEngine {
  probe(file: File): Promise<VideoProbe>;
  transcode(
    file: File,
    request: TranscodeRequest,
    onProgress: (progress: TranscodeProgress) => void,
    onModeChange?: (change: TranscodeModeChange) => void
  ): Promise<TranscodeResult>;
  cancel(): Promise<void>;
}

import {
  createFile,
  MP4BoxBuffer,
  type Box,
  type Movie,
  type SampleEntry
} from "mp4box";
import type { VideoProbe } from "../types";
import { normalizeCodec, isDolbyVision } from "./codec";
import { UserFacingError } from "./errors";
import { videoLogger } from "./logger";
import {
  getFileExtension,
  validateInputFile,
  validateProbeLimits
} from "./validation";

function getContainer(fileName: string): "mp4" | "mov" {
  return getFileExtension(fileName) === ".mov" ? "mov" : "mp4";
}

function getDurationSeconds(movie: Movie): number {
  const videoTrack = movie.videoTracks[0];

  if (videoTrack?.duration && videoTrack.timescale) {
    return videoTrack.duration / videoTrack.timescale;
  }

  if (movie.duration && movie.timescale) {
    return movie.duration / movie.timescale;
  }

  return 0;
}

function findColorBox(entry: SampleEntry | undefined): Box | undefined {
  if (!entry?.boxes?.length) {
    return undefined;
  }

  const pending = [...entry.boxes];

  while (pending.length > 0) {
    const box = pending.shift();

    if (!box) {
      continue;
    }

    if (box.type === "colr") {
      return box;
    }

    if (box.boxes?.length) {
      pending.push(...box.boxes);
    }
  }

  return undefined;
}

function hasHdrColorMetadata(entry: SampleEntry | undefined): boolean {
  const colorBox = findColorBox(entry) as
    | (Box & { transfer_characteristics?: number })
    | undefined;
  const transferCharacteristics = colorBox?.transfer_characteristics;

  return transferCharacteristics === 16 || transferCharacteristics === 18;
}

function getVideoSampleEntry(
  movie: Movie,
  entries: ReadonlyMap<number, SampleEntry>
): SampleEntry | undefined {
  const videoTrack = movie.videoTracks[0];
  return videoTrack ? entries.get(videoTrack.id) : undefined;
}

function getFrameRate(movie: Movie, durationSeconds: number): number | undefined {
  const videoTrack = movie.videoTracks[0];

  if (!videoTrack?.nb_samples || durationSeconds <= 0) {
    return undefined;
  }

  return videoTrack.nb_samples / durationSeconds;
}

function toProbe(
  file: File,
  movie: Movie,
  sampleEntry: SampleEntry | undefined
): VideoProbe {
  const videoTrack = movie.videoTracks[0];

  if (!videoTrack) {
    throw new UserFacingError(
      "文件中没有可识别的视频轨道。",
      "unsupported-format"
    );
  }

  const codec = normalizeCodec(videoTrack.codec);
  const durationSeconds = getDurationSeconds(movie);
  const width = videoTrack.video?.width || videoTrack.track_width;
  const height = videoTrack.video?.height || videoTrack.track_height;

  return {
    codec,
    codecString: videoTrack.codec,
    container: getContainer(file.name),
    durationSeconds,
    sizeBytes: file.size,
    width: width || undefined,
    height: height || undefined,
    frameRate: getFrameRate(movie, durationSeconds),
    audioCodec: movie.audioTracks[0]?.codec,
    isHdr:
      hasHdrColorMetadata(sampleEntry) || isDolbyVision(videoTrack.codec),
    compatible: codec === "h264"
  };
}

export async function probeVideoFile(file: File): Promise<VideoProbe> {
  const startedAt = performance.now();
  videoLogger.info("探测:引擎开始", {
    fileName: file.name,
    sizeBytes: file.size,
    mimeType: file.type
  });

  try {
    validateInputFile(file);
    videoLogger.info("探测:引擎校验通过", {
      fileName: file.name
    });

    const isoFile = createFile();
    const sampleEntries = new Map<number, SampleEntry>();
    let movie: Movie | undefined;
    let parseError: string | undefined;
    let offset = 0;
    let lastLoggedOffset = 0;

    isoFile.onReady = (info) => {
      movie = info;
      videoLogger.info("探测:元数据已就绪", {
        fileName: file.name,
        trackCount: info.tracks.length,
        videoTrackCount: info.videoTracks.length,
        audioTrackCount: info.audioTracks.length
      });

      for (const track of info.tracks) {
        const trackBox = isoFile.getTrackById(track.id);
        const entry = trackBox?.mdia.minf.stbl.stsd.entries[0];

        if (entry) {
          sampleEntries.set(track.id, entry);
        }
      }
    };

    isoFile.onError = (_module, message) => {
      parseError = message;
      videoLogger.error("探测:解析器错误", message, {
        fileName: file.name,
        offsetBytes: offset
      });
    };

    const reader = file.stream().getReader();

    videoLogger.info("探测:文件读取开始", {
      fileName: file.name,
      sizeBytes: file.size
    });

    try {
      while (!movie) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const exactBuffer =
          value.byteLength === value.buffer.byteLength
            ? value.buffer
            : value.buffer.slice(
                value.byteOffset,
                value.byteOffset + value.byteLength
              );

        isoFile.appendBuffer(MP4BoxBuffer.fromArrayBuffer(exactBuffer, offset));
        offset += value.byteLength;

        if (
          lastLoggedOffset === 0 ||
          offset - lastLoggedOffset >= 64 * 1024 * 1024 ||
          offset >= file.size
        ) {
          lastLoggedOffset = offset;
          videoLogger.info("探测:文件读取进度", {
            fileName: file.name,
            readBytes: offset,
            totalBytes: file.size,
            ratio:
              file.size > 0
                ? Number(Math.min(offset / file.size, 1).toFixed(3))
                : 1
          });
        }

        if (parseError) {
          throw new UserFacingError(
            `无法解析视频信息：${parseError}`,
            "probe-failed"
          );
        }
      }

      if (!movie) {
        isoFile.flush();
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      isoFile.stop();
      videoLogger.info("探测:文件读取结束", {
        fileName: file.name,
        readBytes: offset,
        metadataReady: Boolean(movie)
      });
    }

    if (!movie) {
      throw new UserFacingError(
        "无法解析视频信息，请确认文件未损坏。",
        "probe-failed"
      );
    }

    const probe = toProbe(
      file,
      movie,
      getVideoSampleEntry(movie, sampleEntries)
    );
    videoLogger.info("探测:限制检查开始", {
      fileName: file.name,
      durationSeconds: probe.durationSeconds,
      sizeBytes: probe.sizeBytes
    });
    validateProbeLimits(probe);
    videoLogger.info("探测:限制检查通过", {
      fileName: file.name
    });
    videoLogger.info("探测:引擎成功", {
      fileName: file.name,
      codec: probe.codec,
      codecString: probe.codecString,
      elapsedMs: Math.round(performance.now() - startedAt)
    });

    return probe;
  } catch (error) {
    videoLogger.error("探测:引擎失败", error, {
      fileName: file.name,
      elapsedMs: Math.round(performance.now() - startedAt)
    });
    throw error;
  }
}

import { FFmpeg } from "@ffmpeg/ffmpeg";
import type {
  BrowserMediaEngine,
  TranscodeMode,
  TranscodeModeChange,
  TranscodeProgress,
  TranscodeRequest,
  TranscodeResult,
  VideoProbe
} from "../types";
import { getPreset } from "../config/presets";
import { UserFacingError } from "../lib/errors";
import { buildFfmpegArgs } from "../lib/ffmpegCommand";
import { videoLogger } from "../lib/logger";
import { probeVideoFile } from "../lib/probeVideo";
import { getFileExtension } from "../lib/validation";

function getAssetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, location.href).href;
}

const CORE_URL = getAssetUrl("ffmpeg/core/ffmpeg-core.js");
const WASM_URL = getAssetUrl("ffmpeg/core/ffmpeg-core.wasm");
const MULTI_THREAD_CORE_URL = getAssetUrl(
  "ffmpeg/core-mt/ffmpeg-core.js"
);
const MULTI_THREAD_WASM_URL = getAssetUrl(
  "ffmpeg/core-mt/ffmpeg-core.wasm"
);
const MULTI_THREAD_WORKER_URL = getAssetUrl(
  "ffmpeg/core-mt/ffmpeg-core.worker.js"
);

function shouldUseMultiThread(): boolean {
  return (
    globalThis.crossOriginIsolated === true &&
    (navigator.hardwareConcurrency ?? 1) > 1
  );
}

function getMultiThreadUnavailableMessage(): string {
  if (globalThis.crossOriginIsolated !== true) {
    return "当前页面未启用跨源隔离（COOP/COEP）";
  }

  if ((navigator.hardwareConcurrency ?? 1) <= 1) {
    return "当前设备没有可用的多线程处理能力";
  }

  return "当前浏览器无法加载多线程 WASM 核心";
}

function notifyModeChange(
  onModeChange: ((change: TranscodeModeChange) => void) | undefined,
  change: TranscodeModeChange
): void {
  try {
    onModeChange?.(change);
  } catch (error) {
    videoLogger.error("运行模式:通知失败", error, { mode: change.to });
  }
}

function dataToUint8Array(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

function createTaskId(): string {
  return `transcode-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

interface LoadedFfmpeg {
  ffmpeg: FFmpeg;
  objectUrls: string[];
  mode: TranscodeMode;
  detachLog: () => void;
}

async function toBlobUrl(
  url: string,
  type: string,
  label: string
): Promise<string> {
  const startedAt = performance.now();
  videoLogger.info("核心:资源下载开始", { label, url });

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to load FFmpeg asset: ${url} (HTTP ${response.status})`
      );
    }

    const bytes = await response.arrayBuffer();
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type }));

    videoLogger.info("核心:资源下载成功", {
      label,
      sizeBytes: bytes.byteLength,
      elapsedMs: Math.round(performance.now() - startedAt)
    });

    return objectUrl;
  } catch (error) {
    videoLogger.error("核心:资源下载失败", error, {
      label,
      url,
      elapsedMs: Math.round(performance.now() - startedAt)
    });
    throw error;
  }
}

export class FfmpegBrowserEngine implements BrowserMediaEngine {
  private activeFfmpeg: FFmpeg | null = null;
  private activeTaskId: string | null = null;
  private cancelled = false;

  async probe(file: File): Promise<VideoProbe> {
    return probeVideoFile(file);
  }

  async transcode(
    file: File,
    request: TranscodeRequest,
    onProgress: (progress: TranscodeProgress) => void,
    onModeChange?: (change: TranscodeModeChange) => void
  ): Promise<TranscodeResult> {
    if (this.activeFfmpeg) {
      videoLogger.warn("转码:已有任务，拒绝新任务", {
        activeTaskId: this.activeTaskId
      });
      throw new UserFacingError(
        "当前已有转换任务正在执行。",
        "ffmpeg-failed"
      );
    }

    const taskId = createTaskId();
    const startedAt = performance.now();
    const multiThreadAvailable = shouldUseMultiThread();
    const preferredMode =
      request.preferredMode ??
      (multiThreadAvailable ? "multi-thread" : "single-thread");
    this.cancelled = false;
    this.activeTaskId = taskId;
    getPreset(request.preset);
    const extension = getFileExtension(file.name) || ".mp4";
    const inputName = `input${extension}`;
    const outputName = "output.mp4";
    const attempts =
      preferredMode === "multi-thread" && multiThreadAvailable
        ? [true, false]
        : [false];

    videoLogger.info("转码:引擎开始", {
      taskId,
      fileName: file.name,
      sizeBytes: file.size,
      preset: request.preset,
      outputName: request.outputName,
      crossOriginIsolated: globalThis.crossOriginIsolated,
      hardwareConcurrency: navigator.hardwareConcurrency,
      sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
      preferredMode
    });

    if (preferredMode === "multi-thread" && !multiThreadAvailable) {
      const message = getMultiThreadUnavailableMessage();
      videoLogger.warn("核心:多线程不可用，切换单线程", {
        taskId,
        from: "multi-thread",
        to: "single-thread",
        reason: message
      });
      notifyModeChange(onModeChange, {
        from: "multi-thread",
        to: "single-thread",
        reason: "unavailable",
        message
      });
    }

    try {
      for (const useMultiThread of attempts) {
        const mode = useMultiThread ? "multi-thread" : "single-thread";
        let loadedFfmpeg: LoadedFfmpeg | null = null;

        videoLogger.info("核心:尝试开始", { taskId, mode });

        try {
          loadedFfmpeg = await this.loadFfmpeg(
            useMultiThread,
            onProgress,
            taskId
          );
          const result = await this.runTranscode(
            loadedFfmpeg.ffmpeg,
            file,
            inputName,
            outputName,
            request.outputName,
            request.preset,
            onProgress,
            taskId,
            mode
          );

          videoLogger.info("转码:引擎成功", {
            taskId,
            mode,
            outputName: result.fileName,
            outputSizeBytes: result.blob.size,
            elapsedMs: Math.round(performance.now() - startedAt)
          });

          return result;
        } catch (error) {
          if (
            this.cancelled ||
            (error instanceof UserFacingError && error.code === "cancelled")
          ) {
            videoLogger.info("转码:引擎已取消", {
              taskId,
              mode,
              elapsedMs: Math.round(performance.now() - startedAt)
            });
            throw new UserFacingError("转换已取消。", "cancelled");
          }

          if (!useMultiThread) {
            videoLogger.error("转码:引擎失败", error, {
              taskId,
              mode,
              elapsedMs: Math.round(performance.now() - startedAt)
            });
            throw error;
          }

          const fallbackMessage =
            error instanceof Error ? error.message : String(error);
          videoLogger.warn("核心:多线程失败，回退单线程", {
            taskId,
            from: mode,
            to: "single-thread",
            reason: fallbackMessage,
            reasonName: error instanceof Error ? error.name : undefined,
            reasonStack: error instanceof Error ? error.stack : undefined,
            elapsedMs: Math.round(performance.now() - startedAt)
          });
          notifyModeChange(onModeChange, {
            from: "multi-thread",
            to: "single-thread",
            reason: "failed",
            message: fallbackMessage
          });
        } finally {
          if (loadedFfmpeg) {
            videoLogger.info("核心:释放实例开始", {
              taskId,
              mode
            });
            await this.disposeFfmpeg(
              loadedFfmpeg,
              inputName,
              outputName
            );
            videoLogger.info("核心:释放实例完成", {
              taskId,
              mode
            });
          }
        }
      }

      throw new UserFacingError(
        "转换失败，请稍后重试。",
        "ffmpeg-failed"
      );
    } catch (error) {
      if (this.cancelled || (error instanceof UserFacingError && error.code === "cancelled")) {
        throw new UserFacingError("转换已取消。", "cancelled");
      }

      videoLogger.error("转码:引擎失败", error, {
        taskId,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
      throw new UserFacingError(
        error instanceof UserFacingError
          ? error.message
          : "转换失败，请确认视频未损坏后重试。",
        error instanceof UserFacingError ? error.code : "ffmpeg-failed"
      );
    } finally {
      if (this.activeTaskId === taskId) {
        this.activeTaskId = null;
      }
    }
  }

  async cancel(): Promise<void> {
    videoLogger.info("转码:发送取消信号", {
      activeTaskId: this.activeTaskId,
      hasActiveCore: this.activeFfmpeg !== null
    });
    this.cancelled = true;
    this.activeFfmpeg?.terminate();
    this.activeFfmpeg = null;
    videoLogger.info("转码:核心已终止", {
      activeTaskId: this.activeTaskId
    });
  }

  private async loadFfmpeg(
    useMultiThread: boolean,
    onProgress: (progress: TranscodeProgress) => void,
    taskId: string
  ): Promise<LoadedFfmpeg> {
    const mode = useMultiThread ? "multi-thread" : "single-thread";
    const startedAt = performance.now();
    videoLogger.info("核心:加载开始", {
      taskId,
      mode,
      coreUrl: useMultiThread ? MULTI_THREAD_CORE_URL : CORE_URL,
      wasmUrl: useMultiThread ? MULTI_THREAD_WASM_URL : WASM_URL,
      workerUrl: useMultiThread ? MULTI_THREAD_WORKER_URL : undefined
    });

    onProgress({
      ratio: 0,
      processedSeconds: 0,
      stage: "loading-core"
    });

    if (useMultiThread) {
      const ffmpeg = new FFmpeg();
      const objectUrls: string[] = [];
      const handleLog = ({ type, message }: { type: string; message: string }) => {
        videoLogger.info("FFmpeg核心日志", { taskId, mode, type, message });
      };
      const detachLog = () => ffmpeg.off("log", handleLog);
      const loadedFfmpeg: LoadedFfmpeg = {
        ffmpeg,
        objectUrls,
        mode,
        detachLog
      };
      this.activeFfmpeg = ffmpeg;
      ffmpeg.on("log", handleLog);

      try {
        const coreUrl = await toBlobUrl(
          MULTI_THREAD_CORE_URL,
          "text/javascript",
          "core-mt:js"
        );
        objectUrls.push(coreUrl);
        const wasmUrl = await toBlobUrl(
          MULTI_THREAD_WASM_URL,
          "application/wasm",
          "core-mt:wasm"
        );
        objectUrls.push(wasmUrl);
        const workerUrl = await toBlobUrl(
          MULTI_THREAD_WORKER_URL,
          "text/javascript",
          "core-mt:worker"
        );
        objectUrls.push(workerUrl);

        if (this.cancelled) {
          throw new UserFacingError("转换已取消。", "cancelled");
        }

        videoLogger.info("核心:WASM初始化开始", { taskId, mode });
        await ffmpeg.load({
          coreURL: coreUrl,
          wasmURL: wasmUrl,
          workerURL: workerUrl
        });
        videoLogger.info("核心:加载成功", {
          taskId,
          mode,
          elapsedMs: Math.round(performance.now() - startedAt)
        });
        videoLogger.info("核心:转换模式已加载", {
          taskId,
          mode,
          crossOriginIsolated: globalThis.crossOriginIsolated,
          hardwareConcurrency: navigator.hardwareConcurrency,
          sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined"
        });

        return loadedFfmpeg;
      } catch (error) {
        videoLogger.error("核心:加载失败", error, {
          taskId,
          mode,
          elapsedMs: Math.round(performance.now() - startedAt)
        });
        await this.disposeFfmpeg(loadedFfmpeg);
        throw error;
      }
    }

    if (this.cancelled) {
      throw new UserFacingError("转换已取消。", "cancelled");
    }

    const ffmpeg = new FFmpeg();
    const handleLog = ({ type, message }: { type: string; message: string }) => {
      videoLogger.info("FFmpeg核心日志", { taskId, mode, type, message });
    };
    const detachLog = () => ffmpeg.off("log", handleLog);
    const loadedFfmpeg: LoadedFfmpeg = {
      ffmpeg,
      objectUrls: [],
      mode,
      detachLog
    };
    this.activeFfmpeg = ffmpeg;
    ffmpeg.on("log", handleLog);

    try {
      videoLogger.info("核心:WASM初始化开始", { taskId, mode });
      await ffmpeg.load({
        coreURL: CORE_URL,
        wasmURL: WASM_URL
      });
      videoLogger.info("核心:加载成功", {
        taskId,
        mode,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
      videoLogger.info("核心:转换模式已加载", {
        taskId,
        mode,
        crossOriginIsolated: globalThis.crossOriginIsolated,
        hardwareConcurrency: navigator.hardwareConcurrency,
        sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined"
      });

      return loadedFfmpeg;
    } catch (error) {
      videoLogger.error("核心:加载失败", error, {
        taskId,
        mode,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
      await this.disposeFfmpeg(loadedFfmpeg);
      throw error;
    }
  }

  private async runTranscode(
    ffmpeg: FFmpeg,
    file: File,
    inputName: string,
    outputName: string,
    resultFileName: string,
    presetId: TranscodeRequest["preset"],
    onProgress: (progress: TranscodeProgress) => void,
    taskId: string,
    mode: TranscodeMode
  ): Promise<TranscodeResult> {
    if (this.cancelled) {
      throw new UserFacingError("转换已取消。", "cancelled");
    }

    const startedAt = performance.now();
    let stage:
      | "file-read"
      | "write-input"
      | "exec"
      | "read-output" = "file-read";

    let lastProgressTime = 0;
    let lastProgressAt = performance.now();
    let lastLoggedRatio = -1;
    let lastProgressLogAt = 0;
    const handleProgress = ({
      progress,
      time
    }: {
      progress: number;
      time: number;
    }): void => {
      if (this.cancelled) {
        return;
      }

      const now = performance.now();
      const processedSeconds = time / 1_000_000;
      const elapsedSeconds = (now - lastProgressAt) / 1000;
      const mediaDeltaSeconds = processedSeconds - lastProgressTime;
      const speed =
        elapsedSeconds > 0 ? mediaDeltaSeconds / elapsedSeconds : undefined;
      const ratio = Math.min(Math.max(progress, 0), 0.99);

      lastProgressTime = processedSeconds;
      lastProgressAt = now;

      if (
        lastLoggedRatio < 0 ||
        ratio >= lastLoggedRatio + 0.1 ||
        now - lastProgressLogAt >= 3_000 ||
        ratio >= 0.99
      ) {
        lastLoggedRatio = ratio;
        lastProgressLogAt = now;
        videoLogger.info("转码:处理进度", {
          taskId,
          mode,
          ratio: Number(ratio.toFixed(3)),
          processedSeconds: Number(processedSeconds.toFixed(2)),
          speed: speed && speed > 0 ? Number(speed.toFixed(2)) : undefined
        });
      }

      onProgress({
        ratio,
        processedSeconds,
        speed: speed && speed > 0 ? speed : undefined,
        stage: "transcoding"
      });
    };

    let progressAttached = false;

    try {
      videoLogger.info("转码:读取文件开始", {
        taskId,
        mode,
        fileName: file.name,
        sizeBytes: file.size
      });
      const inputData = new Uint8Array(await file.arrayBuffer());
      videoLogger.info("转码:读取文件成功", {
        taskId,
        mode,
        sizeBytes: inputData.byteLength
      });

      stage = "write-input";
      videoLogger.info("转码:写入输入开始", {
        taskId,
        mode,
        inputName
      });
      await ffmpeg.writeFile(inputName, inputData);
      videoLogger.info("转码:写入输入成功", {
        taskId,
        mode,
        inputName
      });

      ffmpeg.on("progress", handleProgress);
      progressAttached = true;

      const preset = getPreset(presetId);
      const ffmpegArgs = buildFfmpegArgs(inputName, outputName, preset);

      stage = "exec";
      videoLogger.info("转码:FFmpeg执行开始", {
        taskId,
        mode,
        args: ffmpegArgs
      });
      const exitCode = await ffmpeg.exec(ffmpegArgs);
      videoLogger.info("转码:FFmpeg执行结束", {
        taskId,
        mode,
        exitCode,
        processedSeconds: Number(lastProgressTime.toFixed(2)),
        elapsedMs: Math.round(performance.now() - startedAt)
      });

      if (this.cancelled) {
        throw new UserFacingError("转换已取消。", "cancelled");
      }

      if (exitCode !== 0) {
        throw new UserFacingError(
          "编码失败，请确认视频未损坏且编码参数受支持。",
          "ffmpeg-failed"
        );
      }

      onProgress({
        ratio: 1,
        processedSeconds: lastProgressTime,
        stage: "saving"
      });

      stage = "read-output";
      videoLogger.info("转码:读取结果开始", {
        taskId,
        mode,
        outputName
      });
      const outputData = await ffmpeg.readFile(outputName);
      const bytes = dataToUint8Array(outputData);
      const stableBytes = new Uint8Array(bytes);
      videoLogger.info("转码:读取结果成功", {
        taskId,
        mode,
        outputName,
        sizeBytes: stableBytes.byteLength
      });

      return {
        blob: new Blob([stableBytes], { type: "video/mp4" }),
        fileName: resultFileName
      };
    } catch (error) {
      videoLogger.error("转码:阶段失败", error, {
        taskId,
        mode,
        stage,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
      throw error;
    } finally {
      if (progressAttached) {
        ffmpeg.off("progress", handleProgress);
      }
    }
  }

  private async disposeFfmpeg(
    loadedFfmpeg: LoadedFfmpeg,
    inputName?: string,
    outputName?: string
  ): Promise<void> {
    const { ffmpeg, objectUrls, mode, detachLog } = loadedFfmpeg;
    const startedAt = performance.now();

    videoLogger.info("核心:资源清理开始", {
      activeTaskId: this.activeTaskId,
      mode,
      hasInputFile: Boolean(inputName),
      hasOutputFile: Boolean(outputName)
    });
    detachLog();

    if (inputName) {
      await ffmpeg.deleteFile(inputName).catch((error) => {
        videoLogger.debug("核心:清理时删除输入失败", {
          fileName: inputName,
          message: error instanceof Error ? error.message : String(error)
        });
      });
    }

    if (outputName) {
      await ffmpeg.deleteFile(outputName).catch((error) => {
        videoLogger.debug("核心:清理时删除输出失败", {
          fileName: outputName,
          message: error instanceof Error ? error.message : String(error)
        });
      });
    }

    ffmpeg.terminate();
    objectUrls.forEach((url) => URL.revokeObjectURL(url));

    if (this.activeFfmpeg === ffmpeg) {
      this.activeFfmpeg = null;
    }

    videoLogger.info("核心:资源清理完成", {
      activeTaskId: this.activeTaskId,
      mode,
      elapsedMs: Math.round(performance.now() - startedAt)
    });
  }
}

export const browserMediaEngine = new FfmpegBrowserEngine();

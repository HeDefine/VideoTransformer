import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Cpu,
  Download,
  FileVideo2,
  Gauge,
  HardDrive,
  Info,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Upload,
  X,
  XCircle
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent
} from "react";
import { PROFILE_PRESETS, getPreset } from "./config/presets";
import { browserMediaEngine } from "./engine/browserMediaEngine";
import { getCodecLabel } from "./lib/codec";
import { getErrorMessage, UserFacingError } from "./lib/errors";
import { buildOutputName, makeUniqueName } from "./lib/filename";
import { formatBytes, formatDuration, formatPercent } from "./lib/format";
import { videoLogger } from "./lib/logger";
import { validateInputFile } from "./lib/validation";
import type {
  BrowserMediaEngine,
  ProfilePreset,
  TranscodeMode,
  TranscodeProgress,
  VideoProbe
} from "./types";

type AppPhase =
  | "idle"
  | "probing"
  | "ready"
  | "transcoding"
  | "cancelling"
  | "done"
  | "error";

interface DownloadResult {
  blob: Blob;
  fileName: string;
  url: string;
}

interface AppProps {
  engine?: BrowserMediaEngine;
}

const STAGE_LABELS: Record<TranscodeProgress["stage"], string> = {
  "loading-core": "正在加载转换核心",
  probing: "正在读取视频信息",
  transcoding: "正在转换",
  saving: "正在生成文件"
};

function getAudioLabel(codec: string | undefined): string {
  if (!codec) {
    return "无音轨";
  }

  if (codec.startsWith("mp4a")) {
    return `AAC (${codec})`;
  }

  return codec;
}

function isCancelledError(error: unknown): boolean {
  return error instanceof UserFacingError && error.code === "cancelled";
}

function getModeLabel(mode: TranscodeMode): string {
  return mode === "multi-thread" ? "多线程" : "单线程";
}

export function App({ engine = browserMediaEngine }: AppProps) {
  const multiThreadAvailable =
    globalThis.crossOriginIsolated === true &&
    (navigator.hardwareConcurrency ?? 1) > 1;
  const [phase, setPhase] = useState<AppPhase>("idle");
  const [executionMode, setExecutionMode] = useState<TranscodeMode>(
    multiThreadAvailable ? "multi-thread" : "single-thread"
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<VideoProbe | null>(null);
  const [preset, setPreset] = useState<ProfilePreset>("android8-high");
  const [progress, setProgress] = useState<TranscodeProgress | null>(null);
  const [download, setDownload] = useState<DownloadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionIdRef = useRef(0);
  const usedNamesRef = useRef(new Set<string>());

  const isBusy =
    phase === "probing" ||
    phase === "transcoding" ||
    phase === "cancelling";
  const selectedPreset = getPreset(preset);
  const canTranscode =
    phase === "ready" && selectedFile !== null && probe?.codec === "hevc";

  useEffect(() => {
    return () => {
      if (download) {
        URL.revokeObjectURL(download.url);
      }

      void engine.cancel();
    };
  }, [download, engine]);

  function clearDownload(): void {
    setDownload((current) => {
      if (current) {
        URL.revokeObjectURL(current.url);
      }

      return null;
    });
  }

  function resetAll(): void {
    if (isBusy) {
      return;
    }

    selectionIdRef.current += 1;
    clearDownload();
    setSelectedFile(null);
    setProbe(null);
    setProgress(null);
    setError(null);
    setPhase("idle");

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  async function inspectFile(file: File): Promise<void> {
    if (isBusy) {
      videoLogger.warn("探测:忙碌中已忽略", {
        fileName: file.name,
        phase
      });
      return;
    }

    const inspectStartedAt = performance.now();
    const selectionId = selectionIdRef.current + 1;
    selectionIdRef.current = selectionId;
    clearDownload();
    setSelectedFile(file);
    setProbe(null);
    setProgress({
      ratio: 0,
      processedSeconds: 0,
      stage: "probing"
    });
    setError(null);
    setPhase("probing");
    videoLogger.info("探测:开始", {
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: file.type
    });

    try {
      validateInputFile(file);
      videoLogger.info("探测:文件校验通过", {
        fileName: file.name
      });
      const nextProbe = await engine.probe(file);

      if (selectionIdRef.current !== selectionId) {
        videoLogger.warn("探测:已丢弃过期结果", {
          fileName: file.name,
          selectionId
        });
        return;
      }

      setProbe(nextProbe);
      setProgress(null);
      setPhase("ready");
      videoLogger.info("探测:成功", {
        fileName: file.name,
        codec: nextProbe.codec,
        codecString: nextProbe.codecString,
        container: nextProbe.container,
        durationSeconds: nextProbe.durationSeconds,
        width: nextProbe.width,
        height: nextProbe.height,
        frameRate: nextProbe.frameRate,
        audioCodec: nextProbe.audioCodec,
        isHdr: nextProbe.isHdr,
        elapsedMs: Math.round(performance.now() - inspectStartedAt)
      });

      if (nextProbe.codec === "other") {
        setError(
          `检测到不支持的视频编码：${nextProbe.codecString}。仅支持 HEVC/H.265 和 H.264/AVC。`
        );
      }
    } catch (nextError) {
      if (selectionIdRef.current !== selectionId) {
        videoLogger.warn("探测:已丢弃过期错误", {
          fileName: file.name,
          selectionId
        });
        return;
      }

      setProgress(null);
      setError(getErrorMessage(nextError));
      setPhase("error");
      videoLogger.error("探测:失败", nextError, {
        fileName: file.name,
        elapsedMs: Math.round(performance.now() - inspectStartedAt)
      });
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (file) {
      void inspectFile(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);

    if (isBusy) {
      videoLogger.warn("拖放:忙碌中已忽略", { phase });
      return;
    }

    const file = event.dataTransfer.files?.[0];

    if (file) {
      videoLogger.info("拖放:收到文件", {
        fileName: file.name,
        sizeBytes: file.size,
        mimeType: file.type
      });
      void inspectFile(file);
    }
  }

  async function handleTranscode(): Promise<void> {
    if (!canTranscode || !selectedFile) {
      return;
    }

    const activeSelectionId = selectionIdRef.current;
    const outputName = makeUniqueName(
      buildOutputName(selectedFile.name, preset),
      usedNamesRef.current
    );
    const transcodeStartedAt = performance.now();

    clearDownload();
    setError(null);
    setProgress({
      ratio: 0,
      processedSeconds: 0,
      stage: "loading-core"
    });
    setPhase("transcoding");
    videoLogger.info("转码:收到请求", {
      fileName: selectedFile.name,
      preset,
      outputName,
      sizeBytes: selectedFile.size,
      durationSeconds: probe?.durationSeconds,
      codec: probe?.codec,
      audioCodec: probe?.audioCodec
    });

    try {
      const result = await engine.transcode(
        selectedFile,
        { preset, outputName, preferredMode: executionMode },
        (nextProgress) => {
          if (selectionIdRef.current === activeSelectionId) {
            setProgress(nextProgress);
          }
        },
        (change) => {
          setExecutionMode(change.to);
          videoLogger.warn("运行模式:自动切换", {
            from: change.from,
            to: change.to,
            reason: change.message
          });
          window.alert(
            `${
              change.reason === "unavailable"
                ? "多线程模式不可用"
                : "多线程转码失败"
            }，已自动切换为单线程模式。\n\n原因：${change.message}`
          );
        }
      );

      if (selectionIdRef.current !== activeSelectionId) {
        return;
      }

      usedNamesRef.current.add(result.fileName);
      setDownload({
        ...result,
        url: URL.createObjectURL(result.blob)
      });
      setProgress({
        ratio: 1,
        processedSeconds: probe?.durationSeconds ?? 0,
        stage: "saving"
      });
      setPhase("done");
      videoLogger.info("转码:界面处理成功", {
        outputName: result.fileName,
        outputSizeBytes: result.blob.size,
        elapsedMs: Math.round(performance.now() - transcodeStartedAt)
      });
    } catch (nextError) {
      if (selectionIdRef.current !== activeSelectionId) {
        videoLogger.warn("转码:已丢弃过期结果", {
          selectionId: activeSelectionId
        });
        return;
      }

      setProgress(null);

      if (isCancelledError(nextError)) {
        setPhase("ready");
        videoLogger.info("转码:界面已取消", {
          elapsedMs: Math.round(performance.now() - transcodeStartedAt)
        });
        return;
      }

      setError(getErrorMessage(nextError));
      setPhase("error");
      videoLogger.error("转码:界面处理失败", nextError, {
        elapsedMs: Math.round(performance.now() - transcodeStartedAt)
      });
    }
  }

  async function handleCancel(): Promise<void> {
    if (phase !== "transcoding") {
      return;
    }

    videoLogger.info("转码:收到取消请求");
    setPhase("cancelling");
    await engine.cancel();
  }

  function handleModeSwitch(nextMode: TranscodeMode): void {
    if (isBusy) {
      videoLogger.warn("运行模式:切换失败", {
        from: executionMode,
        to: nextMode,
        reason: "转换任务正在执行"
      });
      window.alert("转换任务正在执行，暂时无法切换运行模式。");
      return;
    }

    if (nextMode === executionMode) {
      window.alert(`当前已经是${getModeLabel(nextMode)}模式。`);
      return;
    }

    if (nextMode === "multi-thread" && !multiThreadAvailable) {
      const reason = "当前部署未启用 COOP/COEP，或设备没有可用的多线程处理能力。";
      videoLogger.warn("运行模式:切换失败", {
        from: executionMode,
        to: nextMode,
        reason
      });
      window.alert(`无法切换到多线程模式。\n\n原因：${reason}`);
      return;
    }

    setExecutionMode(nextMode);
    videoLogger.info("运行模式:手动切换", {
      from: executionMode,
      to: nextMode
    });
    window.alert(`已切换为${getModeLabel(nextMode)}模式。`);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              H.264
            </span>
            <div>
              <strong>Web 视频转码器</strong>
              <span>HEVC/H.265 → H.264</span>
            </div>
          </div>
          <div className="runtime-status">
            <Cpu size={15} aria-hidden="true" />
            <div
              className="runtime-mode-switch"
              role="group"
              aria-label="选择转码运行模式"
            >
              <button
                className={`runtime-mode-switch__button${
                  executionMode === "multi-thread"
                    ? " runtime-mode-switch__button--active"
                    : ""
                }${
                  multiThreadAvailable
                    ? ""
                    : " runtime-mode-switch__button--unavailable"
                }`}
                type="button"
                aria-pressed={executionMode === "multi-thread"}
                title={
                  multiThreadAvailable
                    ? "切换为多线程模式"
                    : "当前环境不支持多线程模式"
                }
                onClick={() => handleModeSwitch("multi-thread")}
              >
                多线程
              </button>
              <button
                className={`runtime-mode-switch__button${
                  executionMode === "single-thread"
                    ? " runtime-mode-switch__button--active"
                    : ""
                }`}
                type="button"
                aria-pressed={executionMode === "single-thread"}
                title="切换为单线程模式"
                onClick={() => handleModeSwitch("single-thread")}
              >
                单线程
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="intro">
          <div>
            <h1>HEVC 视频转换成 H.264 MP4</h1>
            <p>
              文件仅在当前浏览器本地处理，不会上传服务器。单文件上限 300MB、5
              分钟。
            </p>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={18} aria-hidden="true" />
            <span>本地处理</span>
          </div>
        </section>

        <div className="layout">
          <section className="panel source-panel">
            <div className="panel__heading">
              <div>
                <span className="step-label">输入文件</span>
                <h2>选择或拖入视频</h2>
              </div>
              {selectedFile && (
                <button
                  className="icon-button"
                  type="button"
                  onClick={resetAll}
                  disabled={isBusy}
                  title="移除当前文件"
                  aria-label="移除当前文件"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              )}
            </div>

            <div
              className={`dropzone${isDragging ? " dropzone--active" : ""}${
                selectedFile ? " dropzone--selected" : ""
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!isBusy) {
                  setIsDragging(true);
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (event.currentTarget === event.target) {
                  setIsDragging(false);
                }
              }}
              onDrop={handleDrop}
            >
              <input
                ref={inputRef}
                className="visually-hidden"
                type="file"
                accept=".mp4,.mov,video/mp4,video/quicktime"
                onChange={handleFileChange}
                disabled={isBusy}
                data-testid="video-input"
              />

              {selectedFile ? (
                <div className="selected-file">
                  <FileVideo2 size={28} aria-hidden="true" />
                  <div className="selected-file__body">
                    <strong>{selectedFile.name}</strong>
                    <span>
                      {formatBytes(selectedFile.size)} ·{" "}
                      {probe?.container.toUpperCase() ??
                        selectedFile.name.split(".").pop()?.toUpperCase()}
                    </span>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={isBusy}
                  >
                    更换
                  </button>
                </div>
              ) : (
                <button
                  className="dropzone__button"
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={isBusy}
                >
                  <span className="upload-icon">
                    <Upload size={24} aria-hidden="true" />
                  </span>
                  <strong>选择 MP4 / MOV</strong>
                  <span>或拖放文件到这里</span>
                </button>
              )}
            </div>

            {phase === "probing" && (
              <div className="inline-status" role="status">
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
                <span>正在读取视频编码和元数据</span>
              </div>
            )}

            {probe && (
              <div className="probe-result">
                <div className="codec-row">
                  <div>
                    <span className="meta-label">视频编码</span>
                    <strong>{getCodecLabel(probe.codec)}</strong>
                  </div>
                  <span className={`codec-badge codec-badge--${probe.codec}`}>
                    {probe.codecString}
                  </span>
                </div>

                <dl className="metadata-grid">
                  <div>
                    <dt>
                      <Clock3 size={15} aria-hidden="true" />
                      时长
                    </dt>
                    <dd>{formatDuration(probe.durationSeconds)}</dd>
                  </div>
                  <div>
                    <dt>
                      <HardDrive size={15} aria-hidden="true" />
                      大小
                    </dt>
                    <dd>{formatBytes(probe.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt>
                      <FileVideo2 size={15} aria-hidden="true" />
                      分辨率
                    </dt>
                    <dd>
                      {probe.width && probe.height
                        ? `${probe.width} × ${probe.height}`
                        : "未知"}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <Gauge size={15} aria-hidden="true" />
                      帧率
                    </dt>
                    <dd>
                      {probe.frameRate
                        ? `${probe.frameRate.toFixed(1)} fps`
                        : "未知"}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <Info size={15} aria-hidden="true" />
                      音轨
                    </dt>
                    <dd>{getAudioLabel(probe.audioCodec)}</dd>
                  </div>
                </dl>
              </div>
            )}

            {probe?.isHdr && (
              <div className="notice notice--warning" role="status">
                <AlertTriangle size={18} aria-hidden="true" />
                <span>
                  检测到 HDR 色彩元数据。首版不会转为 SDR，部分 Android
                  设备仍可能无法正确显示色彩。
                </span>
              </div>
            )}

            {error && (
              <div className="notice notice--error" role="alert">
                <XCircle size={18} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {probe?.codec === "h264" && !error && (
              <div className="notice notice--success" role="status">
                <CheckCircle2 size={18} aria-hidden="true" />
                <span>该文件已经是 H.264/AVC，无需转换。</span>
              </div>
            )}

            {probe?.codec === "hevc" && !error && (
              <div className="notice notice--success" role="status">
                <CheckCircle2 size={18} aria-hidden="true" />
                <span>可以转换为 H.264，请选择目标设备预设。</span>
              </div>
            )}
          </section>

          <aside className="panel output-panel">
            <div className="panel__heading">
              <div>
                <span className="step-label">输出设置</span>
                <h2>Android 兼容预设</h2>
              </div>
            </div>

            <fieldset className="preset-list" disabled={phase !== "ready"}>
              <legend className="visually-hidden">选择输出预设</legend>
              {PROFILE_PRESETS.map((item) => (
                <label
                  className={`preset${
                    preset === item.id ? " preset--selected" : ""
                  }`}
                  key={item.id}
                >
                  <input
                    type="radio"
                    name="preset"
                    value={item.id}
                    checked={preset === item.id}
                    onChange={() => setPreset(item.id)}
                  />
                  <span className="preset__check" aria-hidden="true">
                    <Check size={15} />
                  </span>
                  <span className="preset__body">
                    <strong>{item.label}</strong>
                    <span>{item.codecSummary}</span>
                  </span>
                  <span className="preset__meta">
                    <span className="preset__tag">{item.compatibility}</span>
                    <span className="preset__blur">
                      模糊程度：{item.blurLevel}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="output-summary">
              <div>
                <span>编码</span>
                <strong>H.264 / yuv420p</strong>
              </div>
              <div>
                <span>音频</span>
                <strong>AAC-LC 128kbps</strong>
              </div>
              <div>
                <span>输出规格</span>
                <strong>
                  {selectedPreset.profileLabel} {selectedPreset.level}
                </strong>
              </div>
            </div>

            {(phase === "transcoding" || phase === "cancelling") && progress && (
              <div className="progress-panel" aria-live="polite">
                <div className="progress-panel__head">
                  <span>
                    {phase === "cancelling"
                      ? "正在取消"
                      : STAGE_LABELS[progress.stage]}
                  </span>
                  <strong>{formatPercent(progress.ratio)}</strong>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress.ratio * 100)}
                >
                  <span style={{ width: formatPercent(progress.ratio) }} />
                </div>
                <div className="progress-details">
                  <span>
                    {progress.processedSeconds > 0
                      ? `${formatDuration(progress.processedSeconds)} / ${formatDuration(
                          probe?.durationSeconds ?? 0
                        )}`
                      : "准备转换"}
                  </span>
                  <span>
                    {progress.speed
                      ? `${progress.speed.toFixed(2)}× 实时速度`
                      : "计算速度中"}
                  </span>
                </div>
              </div>
            )}

            {phase === "done" && download && (
              <div className="download-panel" aria-live="polite">
                <div className="download-panel__icon">
                  <CheckCircle2 size={22} aria-hidden="true" />
                </div>
                <div>
                  <strong>转换完成</strong>
                  <span>{download.fileName}</span>
                </div>
                <a
                  className="download-button"
                  href={download.url}
                  download={download.fileName}
                  data-testid="download-link"
                >
                  <Download size={17} aria-hidden="true" />
                  下载
                </a>
              </div>
            )}

            <div className="actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleTranscode()}
                disabled={!canTranscode}
              >
                {phase === "transcoding" ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <FileVideo2 size={18} aria-hidden="true" />
                )}
                开始转换
              </button>

              {phase === "transcoding" ? (
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void handleCancel()}
                  data-testid="cancel-button"
                >
                  <X size={17} aria-hidden="true" />
                  取消转换
                </button>
              ) : (
                <button
                  className="secondary-button actions__reset"
                  type="button"
                  onClick={resetAll}
                  disabled={!selectedFile || isBusy}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  清空
                </button>
              )}
            </div>
          </aside>
        </div>
      </main>

      <footer className="footer">
        <span>
          浏览器转码基于 FFmpeg.wasm（GPL-2.0-or-later），编码识别基于 MP4Box.js
          （BSD-3-Clause）。
        </span>
        <a href="/THIRD-PARTY-NOTICES.txt" target="_blank" rel="noreferrer">
          第三方许可与源码获取说明
        </a>
      </footer>
    </div>
  );
}

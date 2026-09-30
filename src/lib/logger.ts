type LogLevel = "debug" | "error" | "info" | "warn";
type LogDetails = Record<string, unknown>;

const LOG_PREFIX = "[视频转码器]";

const DETAIL_LABELS: Record<string, string> = {
  activeTaskId: "活动任务ID",
  audioCodec: "音频编码",
  args: "FFmpeg参数",
  codec: "视频编码",
  codecString: "编码标识",
  container: "封装格式",
  coreUrl: "核心地址",
  crossOriginIsolated: "跨源隔离",
  durationSeconds: "时长秒数",
  elapsedMs: "耗时毫秒",
  error: "错误详情",
  exitCode: "退出码",
  fileName: "文件名",
  frameRate: "帧率",
  from: "原模式",
  hardwareConcurrency: "处理器线程数",
  hasActiveCore: "存在活动核心",
  hasInputFile: "存在输入文件",
  hasOutputFile: "存在输出文件",
  height: "高度",
  inputName: "输入文件名",
  isHdr: "是否HDR",
  label: "资源类型",
  message: "消息",
  metadataReady: "元数据已就绪",
  mimeType: "MIME类型",
  mode: "运行模式",
  offsetBytes: "偏移字节",
  outputName: "输出文件名",
  outputSizeBytes: "输出大小字节",
  phase: "界面阶段",
  preferredMode: "首选模式",
  preset: "兼容预设",
  processedSeconds: "已处理秒数",
  ratio: "进度比例",
  readBytes: "已读取字节",
  reason: "原因",
  reasonName: "错误名称",
  reasonStack: "错误堆栈",
  selectionId: "选择编号",
  sharedArrayBuffer: "支持共享内存",
  sizeBytes: "文件大小字节",
  speed: "处理速度",
  stage: "失败阶段",
  taskId: "任务ID",
  to: "目标模式",
  totalBytes: "总字节数",
  trackCount: "轨道数量",
  type: "日志类型",
  url: "地址",
  videoTrackCount: "视频轨道数",
  audioTrackCount: "音频轨道数",
  wasmUrl: "WASM地址",
  width: "宽度",
  workerUrl: "线程文件地址"
};

const DETAIL_VALUE_LABELS: Record<string, Record<string, string>> = {
  codec: {
    h264: "H.264/AVC",
    hevc: "HEVC/H.265",
    other: "其他编码"
  },
  container: {
    mov: "MOV",
    mp4: "MP4"
  },
  from: {
    "multi-thread": "多线程",
    "single-thread": "单线程"
  },
  mode: {
    "multi-thread": "多线程",
    "single-thread": "单线程"
  },
  preferredMode: {
    "multi-thread": "多线程",
    "single-thread": "单线程"
  },
  stage: {
    exec: "FFmpeg执行",
    "file-read": "读取文件",
    "read-output": "读取结果",
    "write-input": "写入输入"
  },
  to: {
    "multi-thread": "多线程",
    "single-thread": "单线程"
  }
};

function localizeValue(key: string, value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return DETAIL_VALUE_LABELS[key]?.[value] ?? value;
}

function localizeDetails(details?: LogDetails): LogDetails {
  if (!details) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      DETAIL_LABELS[key] ?? key,
      localizeValue(key, value)
    ])
  );
}

function serializeError(error: unknown): LogDetails {
  if (error instanceof Error) {
    return {
      错误名称: error.name,
      错误信息: error.message,
      错误堆栈: error.stack
    };
  }

  return { 错误信息: String(error) };
}

function emit(
  level: LogLevel,
  event: string,
  details?: LogDetails
): void {
  console[level](`${LOG_PREFIX} ${event}`, {
    时间: new Date().toISOString(),
    ...localizeDetails(details)
  });
}

export const videoLogger = {
  debug(event: string, details?: LogDetails): void {
    emit("debug", event, details);
  },

  info(event: string, details?: LogDetails): void {
    emit("info", event, details);
  },

  warn(event: string, details?: LogDetails): void {
    emit("warn", event, details);
  },

  error(event: string, error: unknown, details?: LogDetails): void {
    emit("error", event, {
      ...details,
      error: serializeError(error)
    });
  }
};

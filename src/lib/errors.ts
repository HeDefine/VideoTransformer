export type UserFacingErrorCode =
  | "invalid-file"
  | "file-too-large"
  | "duration-too-long"
  | "unsupported-format"
  | "probe-failed"
  | "ffmpeg-failed"
  | "cancelled";

export class UserFacingError extends Error {
  readonly code: UserFacingErrorCode;

  constructor(message: string, code: UserFacingErrorCode) {
    super(message);
    this.name = "UserFacingError";
    this.code = code;
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof UserFacingError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "处理视频时发生未知错误。";
}

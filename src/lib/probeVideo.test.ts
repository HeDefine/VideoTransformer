import { beforeEach, describe, expect, it, vi } from "vitest";

const createFileMock = vi.hoisted(() => vi.fn());
const fromArrayBufferMock = vi.hoisted(() => vi.fn());

vi.mock("mp4box", () => ({
  createFile: createFileMock,
  MP4BoxBuffer: {
    fromArrayBuffer: fromArrayBufferMock
  }
}));

import { probeVideoFile } from "./probeVideo";

interface MockMovie {
  duration: number;
  timescale: number;
  tracks: Array<{ id: number }>;
  videoTracks: Array<Record<string, unknown>>;
  audioTracks: Array<{ codec: string }>;
}

interface MockIsoFile {
  onReady?: (movie: MockMovie) => void;
  onError?: (module: unknown, message: string) => void;
  getTrackById: (id: number) => {
    mdia: {
      minf: {
        stbl: {
          stsd: {
            entries: unknown[];
          };
        };
      };
    };
  };
  appendBuffer: (buffer: unknown) => void;
  flush: () => void;
  stop: () => void;
}

let movie: MockMovie;
let trackById: ReturnType<MockIsoFile["getTrackById"]>;

function createMovie(codec: string): MockMovie {
  return {
    duration: 120,
    timescale: 30,
    tracks: [{ id: 1 }],
    videoTracks: [
      {
        id: 1,
        codec,
        duration: 120,
        timescale: 30,
        nb_samples: 120,
        track_width: 1920,
        track_height: 1080,
        video: {
          width: 1920,
          height: 1080
        }
      }
    ],
    audioTracks: [{ codec: "mp4a.40.2" }]
  };
}

function makeVideoFile(name: string): File {
  const file = new File([new Uint8Array([1])], name, {
    type: "video/mp4"
  });

  Object.defineProperty(file, "stream", {
    value: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        }
      })
  });

  return file;
}

beforeEach(() => {
  createFileMock.mockReset();
  fromArrayBufferMock.mockReset();

  movie = createMovie("hvc1.1.6.L120.90");
  trackById = {
    mdia: {
      minf: {
        stbl: {
          stsd: {
            entries: [
              {
                type: "hvc1",
                boxes: [
                  {
                    type: "colr",
                    transfer_characteristics: 1,
                    boxes: []
                  }
                ]
              }
            ]
          }
        }
      }
    }
  };

  fromArrayBufferMock.mockImplementation(
    (buffer: ArrayBuffer, offset: number) => ({ buffer, offset })
  );
  createFileMock.mockImplementation(() => {
    const isoFile: MockIsoFile = {
      getTrackById: () => trackById,
      appendBuffer: () => isoFile.onReady?.(movie),
      flush: vi.fn(),
      stop: vi.fn()
    };

    return isoFile;
  });
});

describe("probeVideoFile codec detection", () => {
  it.each([
    ["hvc1.1.6.L120.90", "hevc"],
    ["hev1.1.6.L120.90", "hevc"],
    ["avc1.640028", "h264"]
  ] as const)("reports %s as %s", async (codec, expected) => {
    movie = createMovie(codec);
    trackById.mdia.minf.stbl.stsd.entries[0] = {
      type: codec.split(".")[0],
      boxes: [
        {
          type: "colr",
          transfer_characteristics: 1,
          boxes: []
        }
      ]
    };

    const probe = await probeVideoFile(makeVideoFile("sample.mp4"));

    expect(probe.codec).toBe(expected);
    expect(probe.codecString).toBe(codec);
    expect(probe.width).toBe(1920);
    expect(probe.height).toBe(1080);
    expect(probe.frameRate).toBe(30);
    expect(probe.audioCodec).toBe("mp4a.40.2");
  });

  it("marks HDR transfer characteristics", async () => {
    trackById.mdia.minf.stbl.stsd.entries[0] = {
      type: "hvc1",
      boxes: [
        {
          type: "colr",
          transfer_characteristics: 16,
          boxes: []
        }
      ]
    };

    const probe = await probeVideoFile(makeVideoFile("hdr.mp4"));

    expect(probe.isHdr).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import net from "node:net";
import { EventEmitter } from "node:events";

type MockSocket = EventEmitter & {
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
};

function mockSocket(): MockSocket {
  const socket = new EventEmitter() as MockSocket;
  socket.write = vi.fn();
  socket.destroy = vi.fn();
  socket.setTimeout = vi.fn();
  return socket;
}

vi.mock("node:net", () => ({
  default: {
    createConnection: vi.fn(),
  },
}));

describe("clamav scanner", () => {
  it("skips scan when CLAMAV_HOST is unset", async () => {
    const prev = process.env.CLAMAV_HOST;
    delete process.env.CLAMAV_HOST;
    const { scanBytesWithClamav, clamavConfigured } = await import("@/lib/clamav.server");
    const result = await scanBytesWithClamav(Buffer.from("clean"));
    expect(result.clean).toBe(true);
    expect(result.detail).toBe("scan_skipped_no_clamav");
    expect(clamavConfigured()).toBe(false);
    if (prev) process.env.CLAMAV_HOST = prev;
  });

  it("uses PING newline and resolves on PONG without waiting for close", async () => {
    process.env.CLAMAV_HOST = "clamav";
    vi.mocked(net.createConnection).mockImplementation(() => {
      const socket = mockSocket();
      queueMicrotask(() => {
        socket.emit("connect");
        socket.emit("data", "PONG\n");
      });
      return socket as unknown as net.Socket;
    });

    const { clamavReachable } = await import("@/lib/clamav.server");
    const result = await clamavReachable();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("PONG");
    const socket = vi.mocked(net.createConnection).mock.results[0]?.value as MockSocket;
    expect(socket.write).toHaveBeenCalledWith("PING\n");
  });

  it("fails closed when CLAMAV_REQUIRED=true but host unset", async () => {
    delete process.env.CLAMAV_HOST;
    process.env.CLAMAV_REQUIRED = "true";
    const { scanBytesWithClamav } = await import("@/lib/clamav.server");
    const result = await scanBytesWithClamav(Buffer.from("payload"));
    expect(result.clean).toBe(false);
    expect(result.detail).toBe("clamav_required_but_not_configured");
    delete process.env.CLAMAV_REQUIRED;
  });

  it("uses zINSTREAM null delimiter for scans", async () => {
    process.env.CLAMAV_HOST = "clamav";
    vi.mocked(net.createConnection).mockImplementation(() => {
      const socket = mockSocket();
      queueMicrotask(() => {
        socket.emit("connect");
        socket.emit("data", "stream: OK\0");
      });
      return socket as unknown as net.Socket;
    });

    const { scanBytesWithClamav } = await import("@/lib/clamav.server");
    const result = await scanBytesWithClamav(Buffer.from("clean"));
    expect(result.clean).toBe(true);
    const socket = vi.mocked(net.createConnection).mock.results.at(-1)?.value as MockSocket;
    expect(socket.write).toHaveBeenCalledWith(Buffer.from("zINSTREAM\0", "latin1"));
  });
});

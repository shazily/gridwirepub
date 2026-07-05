/**
 * ClamAV INSTREAM scanning over TCP — attachments never touch the API process filesystem.
 *
 * clamd protocol: PING/PONG use newline; zINSTREAM uses a null byte after the command.
 * The daemon keeps connections open — resolve on first complete response, not on "end".
 */

import net from "node:net";

export type ClamScanResult = {
  clean: boolean;
  detail: string;
};

function clamavEndpoint(): { host: string; port: number } | null {
  const host = process.env.CLAMAV_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  return { host, port };
}

function stripNulls(value: string): string {
  return value.replace(/\0/g, "").trim();
}

/** Ping ClamAV daemon (PING → PONG). */
export async function clamavReachable(): Promise<{ ok: boolean; detail: string }> {
  const endpoint = clamavEndpoint();
  if (!endpoint) return { ok: false, detail: "not_configured" };

  return new Promise((resolve) => {
    let response = "";
    let settled = false;

    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, detail });
    };

    const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });

    socket.on("connect", () => {
      socket.write("PING\n");
    });

    socket.setTimeout(5000);
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      const trimmed = stripNulls(response);
      if (trimmed.includes("PONG")) {
        finish(true, trimmed);
      }
    });
    socket.on("timeout", () => finish(false, "timeout"));
    socket.on("error", (err) => finish(false, err.message));
    socket.on("close", () => {
      const trimmed = stripNulls(response);
      finish(trimmed.includes("PONG"), trimmed || "no_response");
    });
  });
}

/** Scan buffer via ClamAV INSTREAM. Fails closed when CLAMAV_REQUIRED=true but host unset. */
export async function scanBytesWithClamav(bytes: Buffer): Promise<ClamScanResult> {
  const endpoint = clamavEndpoint();
  if (!endpoint) {
    if (process.env.CLAMAV_REQUIRED === "true") {
      return { clean: false, detail: "clamav_required_but_not_configured" };
    }
    return { clean: true, detail: "scan_skipped_no_clamav" };
  }

  return new Promise((resolve) => {
    let response = "";
    let settled = false;

    const finish = (result: ClamScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });

    socket.on("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0", "latin1"));
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length, 0);
        socket.write(len);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });

    socket.setTimeout(60_000);
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      const trimmed = stripNulls(response);
      if (/FOUND/i.test(trimmed)) {
        finish({ clean: false, detail: trimmed });
      } else if (/OK/i.test(trimmed)) {
        finish({ clean: true, detail: trimmed });
      }
    });
    socket.on("timeout", () => finish({ clean: false, detail: "scan_timeout" }));
    socket.on("error", (err) => finish({ clean: false, detail: `scan_error:${err.message}` }));
    socket.on("close", () => {
      const trimmed = stripNulls(response);
      if (/FOUND/i.test(trimmed)) finish({ clean: false, detail: trimmed });
      else if (/OK/i.test(trimmed)) finish({ clean: true, detail: trimmed });
      else finish({ clean: false, detail: trimmed || "scan_empty_response" });
    });
  });
}

export function clamavConfigured(): boolean {
  return Boolean(process.env.CLAMAV_HOST?.trim());
}

export function clamavRequired(): boolean {
  return process.env.CLAMAV_REQUIRED === "true";
}

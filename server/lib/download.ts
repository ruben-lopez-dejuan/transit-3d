import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

function escapePowerShell(value: string) {
  return value.replaceAll("'", "''");
}

export async function downloadFile(
  url: string,
  destination: string,
): Promise<number> {
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  fs.rmSync(temporary, { force: true });

  try {
  if (process.platform === "win32") {
    const script = [
      "$ErrorActionPreference='Stop'",
      "$ProgressPreference='SilentlyContinue'",
      `Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Uri '${escapePowerShell(url)}' -OutFile '${escapePowerShell(temporary)}'`,
    ].join("; ");

    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      {
        windowsHide: true,
        timeout: 45_000,
        maxBuffer: 1024 * 1024,
      },
    );
  } else {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        "User-Agent": "transit-3d/0.2",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Download failed: ${response.status} ${response.statusText}`,
      );
    }

    fs.writeFileSync(
      temporary,
      Buffer.from(await response.arrayBuffer()),
    );
  }

  const size = fs.statSync(temporary).size;

  if (size <= 0) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`Downloaded file is empty: ${url}`);
  }

  fs.renameSync(temporary, destination);
  return size;
  } finally { fs.rmSync(temporary, { force: true }); }
}

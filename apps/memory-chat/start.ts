import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const foundation = fileURLToPath(new URL("../../", import.meta.url));
const server = fileURLToPath(new URL("./server.py", import.meta.url));
const installedPython = join(
  foundation,
  ".bootstrap",
  "python",
  "bin",
  "python",
);
const python =
  process.env.PYTHON?.trim() ||
  (existsSync(installedPython) ? installedPython : "python3");

// Explicit caller arguments follow the defaults, so argparse can override them.
// No shell, dependency installation, credential loading, or model request here.
const child = spawn(
  python,
  [
    server,
    "--foundation",
    foundation,
    "--root",
    join(foundation, ".lab", "memory-chat"),
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    detached: process.platform !== "win32",
  },
);

let requestedSignal: "SIGINT" | "SIGTERM" | "SIGHUP" | undefined;
function stop(signal: "SIGINT" | "SIGTERM" | "SIGHUP") {
  if (requestedSignal) return;
  requestedSignal = signal;
  // Stop the Python host first; it owns the SDK and native-process cleanup.
  child.kill(signal === "SIGHUP" ? "SIGTERM" : signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGHUP", () => stop("SIGHUP"));

child.once("error", () => {
  console.error(
    "Unable to start Python. Set PYTHON to an executable with the installed openclaw-memory-bridge package.",
  );
  process.exitCode = 1;
});

child.once("close", (code, signal) => {
  if (requestedSignal || signal) {
    const interruptedBy = (requestedSignal ?? signal) as NodeJS.Signals;
    process.exitCode = 128 + (constants.signals[interruptedBy] ?? 1);
  } else {
    process.exitCode = code !== null && code >= 0 ? code : 1;
  }
});

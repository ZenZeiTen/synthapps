#!/usr/bin/env node
// Launcher: runs src/cli.ts through tsx (the server has no build step).
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
// Resolve tsx from this package, not from the caller's working directory.
const tsx = import.meta.resolve("tsx");
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", tsx, cli, ...process.argv.slice(2)], { stdio: "inherit" });

// The terminal sends Ctrl+C to the whole process group; forward signals sent to this process alone.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (child.exitCode === null) child.kill(signal);
  });
}
child.on("exit", (code, signal) => {
  process.exit(signal ? 128 + (constants.signals[signal] ?? 1) : (code ?? 1));
});

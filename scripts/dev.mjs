import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Start development with npm run dev");
const children = [
  spawn(process.execPath, [npmCli, "run", "dev:web"], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, [npmCli, "run", "dev:worker"], { stdio: "inherit", env: process.env })
];

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const exitCode = await new Promise((resolve) => {
  for (const child of children) {
    child.once("exit", (code) => {
      stop();
      resolve(code ?? 1);
    });
    child.once("error", () => {
      stop();
      resolve(1);
    });
  }
});

process.exitCode = exitCode;

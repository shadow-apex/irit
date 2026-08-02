import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";
const electronCli = path.join(root, "node_modules", "electron", "cli.js");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (process.argv.includes("--prod")) {
  env.IRIS_START_PROD = "1";
}

const child = spawn(process.execPath, [electronCli, "."], {
  cwd: root,
  env,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

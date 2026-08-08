import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";
const electronCli = path.join(root, "node_modules", "electron", "cli.js");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

<<<<<<< HEAD
// Skip elevation in dev mode so the UAC prompt doesn't cause Electron to exit 
// and accidentally kill the Vite and Omni servers via `concurrently -k`.
env.IRIS_SKIP_ELEVATE = "1";

=======
>>>>>>> c2102e8c6ceadd879791aa1f668f45800624ca68
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

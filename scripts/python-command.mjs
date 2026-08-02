import { spawn } from "node:child_process";

const mode = process.argv[2];
const extraArgs = process.argv.slice(3);

const commands = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];

function tryRun(index = 0) {
  const command = commands[index];
  if (!command) {
    console.error("Could not find Python. Install Python 3 or skip sidecar-only checks.");
    process.exit(127);
  }

  const args =
    mode === "check"
      ? [
          "-m",
          "py_compile",
          "sidecar/__init__.py",
          "sidecar/protocol.py",
          "sidecar/hermes_client.py",
          "sidecar/hermes_process.py",
          "sidecar/voice_server.py",
        ]
      : ["sidecar/voice_server.py", "--mode", "none", ...extraArgs];

  const child = spawn(command, args, { stdio: "inherit" });

  child.on("error", () => tryRun(index + 1));
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (mode !== "check" && mode !== "sidecar") {
  console.error("Usage: node scripts/python-command.mjs <check|sidecar>");
  process.exit(2);
}

tryRun();

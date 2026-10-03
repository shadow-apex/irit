import { ChromaClient } from "chromadb";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// BUGFIX-MEM-01: `chromadb` (npm) is an HTTP client ONLY — it has no
// embedded/in-process mode like the Python library. The old code did
// `new ChromaClient()` and just assumed a server was already listening on
// localhost:8000, but nothing in this repo ever started one — every call
// failed with `ChromaNotFoundError`. The `chromadb` package does ship a CLI
// (`chroma run`, at node_modules/chromadb/dist/cli.mjs) that starts a real
// local server using plain Node — no Python required. We spawn that
// ourselves, on demand, the same way main.mjs manages the Python sidecars.
const CHROMA_HOST = "127.0.0.1";
const CHROMA_PORT = 8000;
const CHROMA_CLI = path.join(__dirname, "..", "node_modules", "chromadb", "dist", "cli.mjs");
const CHROMA_DB_PATH = path.join(os.homedir(), ".iris", "chroma");

let client = null;
let collection = null;
let serverProc = null;
let serverStartPromise = null;

async function isServerUp() {
  try {
    const probeClient = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });
    await probeClient.heartbeat();
    return true;
  } catch {
    return false;
  }
}

function waitForServerReady(timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await isServerUp()) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("Chroma server did not become ready in time"));
      }
      setTimeout(tick, 400);
    };
    tick();
  });
}

// Idempotent: if a server (from this process or a leftover one) is already
// answering on 8000, reuse it instead of spawning a second one.
async function ensureChromaServer() {
  if (await isServerUp()) return;
  if (serverStartPromise) return serverStartPromise;

  serverStartPromise = (async () => {
    console.log("[Memory] No Chroma server detected — starting embedded one at", CHROMA_DB_PATH);
    serverProc = spawn(
      process.execPath,
      [CHROMA_CLI, "run", "--path", CHROMA_DB_PATH, "--port", String(CHROMA_PORT)],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    serverProc.stdout?.on("data", (d) => console.log("[chroma]", d.toString().trim()));
    serverProc.stderr?.on("data", (d) => console.error("[chroma]", d.toString().trim()));
    serverProc.on("error", (err) => {
      console.error("[Memory] Failed to spawn Chroma server:", err.message);
      serverProc = null;
    });
    serverProc.on("exit", (code, signal) => {
      console.warn(`[Memory] Chroma server exited (code=${code}, signal=${signal})`);
      serverProc = null;
      collection = null; // force re-init (and possibly respawn) next call
      client = null;
    });

    await waitForServerReady();
  })();

  try {
    await serverStartPromise;
  } finally {
    serverStartPromise = null;
  }
}

// Stops the embedded server we spawned. Safe to call even if we never
// started one (e.g. an already-running instance was reused).
export function stopMemoryServer() {
  if (serverProc) {
    try { serverProc.kill(); } catch { /* ignore */ }
    serverProc = null;
  }
}

async function initMemory() {
  if (collection) return collection;
  await ensureChromaServer();
  client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });
  collection = await client.getOrCreateCollection({ name: "iris_memory" });
  return collection;
}

// BUGFIX-MEM-02: previously these threw straight out of initMemory(). That
// exception is technically caught further up in handleToolCall (main.mjs),
// so it didn't crash the whole app — but every single save/query attempt
// came back as a raw stack-trace error to Gemini, over and over, with no
// way to recover for the rest of the session. Now: on failure we drop the
// half-initialized client/collection (so the NEXT call retries cleanly
// instead of being stuck) and return a normal, friendly error response.
export async function saveToMemory(text) {
  try {
    const col = await initMemory();
    const id = crypto.randomUUID();
    await col.add({
      ids: [id],
      documents: [text],
      metadatas: [{ timestamp: Date.now() }],
    });
    return { status: "success", id, message: "Saved to memory." };
  } catch (e) {
    console.error("[Memory] saveToMemory failed:", e.message);
    client = null;
    collection = null;
    return { status: "error", error: "Second Brain (ChromaDB) hiện không khả dụng, chưa lưu được." };
  }
}

export async function queryMemory(query) {
  try {
    const col = await initMemory();
    const results = await col.query({
      queryTexts: [query],
      nResults: 3,
    });
    if (results && results.documents && results.documents[0].length > 0) {
      return { status: "success", memories: results.documents[0] };
    }
    return { status: "success", memories: [] };
  } catch (e) {
    console.error("[Memory] queryMemory failed:", e.message);
    client = null;
    collection = null;
    return { status: "error", error: "Second Brain (ChromaDB) hiện không khả dụng, chưa tra được trí nhớ." };
  }
}

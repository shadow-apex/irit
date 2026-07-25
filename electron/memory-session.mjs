import { ChromaClient } from "chromadb";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

let client = null;
let collection = null;

async function initMemory() {
  if (collection) return collection;
  try {
    const dbPath = path.join(os.homedir(), ".iris", "chroma");
    // Connect to a local Chroma instance if running, or instantiate
    client = new ChromaClient(); 
    collection = await client.getOrCreateCollection({ name: "iris_memory" });
    return collection;
  } catch (e) {
    console.error("Failed to init ChromaDB", e);
    throw e;
  }
}

export async function saveToMemory(text) {
  const col = await initMemory();
  const id = crypto.randomUUID();
  await col.add({
    ids: [id],
    documents: [text],
    metadatas: [{ timestamp: Date.now() }]
  });
  return { status: "success", id, message: "Saved to memory." };
}

export async function queryMemory(query) {
  const col = await initMemory();
  const results = await col.query({
    queryTexts: [query],
    nResults: 3
  });
  if (results && results.documents && results.documents[0].length > 0) {
    return {
      status: "success",
      memories: results.documents[0]
    };
  }
  return { status: "success", memories: [] };
}

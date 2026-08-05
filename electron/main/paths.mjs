/**
 * electron/main/paths.mjs
 *
 * repoRoot for the split-out main-process modules (electron/main/*.mjs is
 * one directory deeper than the original electron/main.mjs, so this is
 * computed relative to *this* file, not reused from electron/main.mjs).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..", "..");


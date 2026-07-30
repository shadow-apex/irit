// Irit runs on Windows (and macOS). Unlike myiris upstream, we do NOT
// restrict to macOS-only — irit is a Windows-first fork.
export function shouldRefuseLaunch(_platform, _env) {
  return false;
}

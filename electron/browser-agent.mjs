// electron/browser-agent.mjs
//
// A direct browser-automation tool set for Iris, built on Playwright.
//
// electron/computer-session.mjs already gives Iris full-screen control
// (mouse + keyboard, via nut.js + a Claude computer-use agent loop) — that
// is the right tool for "do this multi-step thing across whatever app is
// open". But most browser requests ("open X", "click the login button",
// "read me this page", "search for Y") don't need a whole screen and a
// second LLM loop to plan mouse movement pixel-by-pixel. This module talks
// to one Chromium page directly through Playwright's DOM-aware API, so
// these actions are fast, cheap, and don't fight the real mouse cursor the
// user might be using at the same time.
//
// One page is reused across calls (like a browser tab Iris keeps open) so
// "open google.com" then "click the search box" then "type hello" behaves
// like a real session. Call browserClose() to end it explicitly; otherwise
// it stays open until the app quits.

let playwrightModule = null;
let browser = null;
let context = null;
let page = null;

async function loadPlaywright() {
  if (!playwrightModule) {
    // Lazy import: Playwright (and its downloaded browser binary) is an
    // optional dependency. Iris should still boot and do everything else
    // even if the user hasn't run `npx playwright install chromium` yet —
    // they just get a clear, actionable error the first time they ask for
    // a browser action instead of a crash at app startup.
    try {
      playwrightModule = await import("playwright");
    } catch {
      throw new Error(
        "Playwright chưa sẵn sàng. Chạy `npm install` rồi `npx playwright install chromium` trong thư mục dự án, sau đó thử lại."
      );
    }
  }
  return playwrightModule;
}

async function ensurePage({ headless = true } = {}) {
  const { chromium } = await loadPlaywright();
  if (!browser || !browser.isConnected()) {
    try {
      browser = await chromium.launch({ headless });
    } catch (error) {
      // The `playwright` package can be installed (loadPlaywright() above
      // succeeds) while the actual Chromium binary hasn't been downloaded
      // yet — this is the single most common first-run failure, since
      // `npm install` does NOT fetch browser binaries by itself. Playwright's
      // own error for this is a big raw ASCII-art stack trace; catch it here
      // and surface the same clear, actionable message loadPlaywright()
      // gives for the "package missing entirely" case.
      const msg = String(error?.message || error);
      if (/Executable doesn't exist|playwright install/i.test(msg)) {
        throw new Error(
          "Chưa cài trình duyệt Chromium cho Playwright. Chạy `npx playwright install chromium` trong thư mục dự án, sau đó thử lại."
        );
      }
      throw error;
    }
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
  }
  if (!page || page.isClosed()) {
    page = await context.newPage();
  }
  return page;
}

function normalizeUrl(url) {
  if (!url) throw new Error("Thiếu 'url' để mở trang.");
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export async function browserOpen({ url, headless = true } = {}) {
  const target = normalizeUrl(url);
  const p = await ensurePage({ headless });
  await p.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
  const title = await p.title().catch(() => "");
  return { status: "success", url: p.url(), title };
}

export async function browserClick({ text, selector } = {}) {
  const p = await ensurePage();
  if (selector) {
    await p.click(selector, { timeout: 10000 });
    return { status: "success", message: `Đã click vào selector: ${selector}` };
  }
  if (text) {
    await p.getByText(text, { exact: false }).first().click({ timeout: 10000 });
    return { status: "success", message: `Đã click vào phần tử có chữ: "${text}"` };
  }
  throw new Error("Cần 'text' hoặc 'selector' để biết click vào đâu.");
}

export async function browserType({ text, selector, submit = false } = {}) {
  if (!text) throw new Error("Thiếu 'text' để gõ.");
  const p = await ensurePage();
  if (selector) {
    await p.fill(selector, text, { timeout: 10000 });
  } else {
    // No selector given: type into whatever element currently has focus
    // (e.g. right after browser_click focused a search box).
    await p.keyboard.type(text, { delay: 15 });
  }
  if (submit) await p.keyboard.press("Enter");
  return { status: "success", message: `Đã nhập văn bản${selector ? ` vào ${selector}` : ""}.` };
}

export async function browserExtractText({ selector } = {}) {
  const p = await ensurePage();
  const raw = selector
    ? await p.locator(selector).first().innerText({ timeout: 10000 })
    : await p.evaluate(() => document.body.innerText);
  const text = raw.trim();
  // Keep this small — it goes straight into a voice-model turn, and a whole
  // page of text would both blow the context budget and be unreadable aloud.
  const MAX_CHARS = 4000;
  return {
    status: "success",
    text: text.slice(0, MAX_CHARS),
    truncated: text.length > MAX_CHARS,
    url: p.url(),
  };
}

export async function browserScreenshot() {
  const p = await ensurePage();
  const buffer = await p.screenshot({ type: "png" });
  return { status: "success", base64: buffer.toString("base64"), url: p.url() };
}

export async function browserClose() {
  if (page && !page.isClosed()) await page.close().catch(() => {});
  if (browser && browser.isConnected()) await browser.close().catch(() => {});
  browser = null;
  context = null;
  page = null;
  return { status: "success", message: "Đã đóng trình duyệt." };
}

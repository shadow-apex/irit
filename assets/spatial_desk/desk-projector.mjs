/**
 * assets/spatial_desk/desk-projector.mjs
 *
 * Tự động dò tìm màn hình máy chiếu (Display Detection & Mapping) và
 * tính toán chuyển giao cửa sổ Infinite Desk Extension (kéo cửa sổ máy tính
 * thả tuột qua mép dưới màn hình chính xuống mặt bàn gỗ).
 */
import electron from "electron";

const PROJECTOR_KEYWORDS = /projector|máy chiếu|nebula|xgimi|epson|benq|optoma|viewsonic|anker|wanbo|formovie|dangbei|hdmi|dp/i;

function getDefaultScreenApi() {
  if (electron && typeof electron === "object" && electron.screen) {
    return electron.screen;
  }
  return null;
}

/**
 * Quét toàn bộ màn hình qua Electron `screen.getAllDisplays()` và tự động chọn
 * màn hình phụ của máy chiếu. Nếu chỉ có 1 màn hình máy tính, tự động chuyển sang
 * chế độ Giả lập (Simulator / Test Window) trên màn hình chính.
 *
 * @param {object} [screenApi] Electron screen module (hoặc mock khi test)
 */
export function detectProjectorDisplay(screenApi = getDefaultScreenApi()) {
  const fallbackBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  const fallbackDisplay = {
    id: 1,
    label: "Primary Simulator Display",
    bounds: fallbackBounds,
    workArea: fallbackBounds,
    scaleFactor: 1,
    internal: true,
  };

  if (!screenApi || typeof screenApi.getAllDisplays !== "function") {
    return {
      mode: "simulator",
      isSimulator: true,
      display: fallbackDisplay,
      primaryDisplay: fallbackDisplay,
      allDisplays: [fallbackDisplay],
      displayCount: 1,
    };
  }

  let allDisplays = [];
  let primaryDisplay = null;
  try {
    allDisplays = screenApi.getAllDisplays() || [];
    primaryDisplay =
      typeof screenApi.getPrimaryDisplay === "function"
        ? screenApi.getPrimaryDisplay()
        : allDisplays[0] || fallbackDisplay;
  } catch {
    allDisplays = [fallbackDisplay];
    primaryDisplay = fallbackDisplay;
  }

  if (!primaryDisplay) {
    primaryDisplay = allDisplays[0] || fallbackDisplay;
  }

  // Lọc danh sách màn hình phụ (khác id màn hình chính)
  const secondaryDisplays = allDisplays.filter((d) => d && d.id !== primaryDisplay.id);

  if (secondaryDisplays.length === 0) {
    return {
      mode: "simulator",
      isSimulator: true,
      display: primaryDisplay,
      primaryDisplay,
      allDisplays: allDisplays.length ? allDisplays : [primaryDisplay],
      displayCount: Math.max(1, allDisplays.length),
    };
  }

  // Ưu tiên màn hình phụ có tên nhãn khớp máy chiếu hoặc màn hình gắn ngoài (internal === false)
  const projectorMatch =
    secondaryDisplays.find((d) => PROJECTOR_KEYWORDS.test(String(d.label || ""))) ||
    secondaryDisplays.find((d) => d.internal === false) ||
    secondaryDisplays[0];

  return {
    mode: "projector",
    isSimulator: false,
    display: projectorMatch,
    primaryDisplay,
    allDisplays,
    displayCount: allDisplays.length,
  };
}

/**
 * Kiểm tra xem con trỏ / cửa sổ đang kéo có chạm mép dưới của màn hình chính
 * để "rơi tuột" xuống mặt bàn (Infinite Desk Extension) hay không.
 *
 * @param {{x:number, y:number}} cursorPoint Toạ độ con trỏ màn hình hiện tại
 * @param {{x:number, y:number, width:number, height:number}} primaryBounds Bounds màn hình chính
 * @param {{x:number, y:number, width:number, height:number}} deskBounds Bounds màn hình máy chiếu/bàn
 * @param {number} [edgeThresholdPx=14] Ngưỡng mép dưới tính bằng pixel
 */
export function computeInfiniteDeskTransfer(
  cursorPoint,
  primaryBounds = { x: 0, y: 0, width: 1920, height: 1080 },
  deskBounds = { x: 0, y: 0, width: 1920, height: 1080 },
  edgeThresholdPx = 14,
) {
  if (!cursorPoint || typeof cursorPoint.x !== "number" || typeof cursorPoint.y !== "number") {
    return { triggered: false, nx: 0.5, deskX: 0, deskY: 0 };
  }

  const pX = Number(primaryBounds.x) || 0;
  const pY = Number(primaryBounds.y) || 0;
  const pW = Math.max(1, Number(primaryBounds.width) || 1920);
  const pH = Math.max(1, Number(primaryBounds.height) || 1080);

  const dW = Math.max(1, Number(deskBounds.width) || 1920);
  const dH = Math.max(1, Number(deskBounds.height) || 1080);

  const withinHorizontal = cursorPoint.x >= pX && cursorPoint.x <= pX + pW;
  const bottomEdgeY = pY + pH;
  const distanceToBottom = bottomEdgeY - cursorPoint.y;

  const triggered = withinHorizontal && distanceToBottom <= edgeThresholdPx && distanceToBottom >= -edgeThresholdPx * 3;
  const nx = Math.max(0.05, Math.min(0.95, (cursorPoint.x - pX) / pW));

  // Khi rơi qua mép dưới màn hình chính, cửa sổ xuất hiện ở nửa trên mặt bàn đúng vị trí gióng thẳng xuống
  const deskX = Math.round(nx * dW);
  const deskY = Math.round(Math.min(dH * 0.22, 160));

  return {
    triggered,
    nx: Number(nx.toFixed(4)),
    deskX,
    deskY,
    distanceToBottom,
  };
}

/**
 * Chuyển đổi thông tin cửa sổ ứng dụng trên màn hình chính sang khung cửa sổ ảo chiếu trên mặt bàn.
 */
export function mapMainToDeskWindowCard(
  activeWin = {},
  primaryBounds = { x: 0, y: 0, width: 1920, height: 1080 },
  deskBounds = { x: 0, y: 0, width: 1920, height: 1080 },
) {
  const pW = Math.max(1, Number(primaryBounds.width) || 1920);
  const dW = Math.max(1, Number(deskBounds.width) || 1920);
  const dH = Math.max(1, Number(deskBounds.height) || 1080);

  const winX = typeof activeWin.x === "number" ? activeWin.x : (primaryBounds.x || 0) + pW * 0.25;
  const winW = Math.max(320, Math.min(820, Number(activeWin.width) || 560));
  const winH = Math.max(220, Math.min(540, Number(activeWin.height) || 360));

  const centerRatio = Math.max(0.15, Math.min(0.85, (winX + winW / 2 - (primaryBounds.x || 0)) / pW));
  const targetX = Math.round(centerRatio * dW - winW / 2);
  const targetY = Math.round(Math.min(dH * 0.16, 140));

  return {
    id: `desk-win-${Date.now().toString(36)}`,
    title: String(activeWin.title || activeWin.process_name || "Cửa sổ Ứng dụng Windows"),
    app: String(activeWin.process_name || "Application"),
    x: Math.max(40, Math.min(dW - winW - 40, targetX)),
    y: Math.max(70, targetY),
    width: winW,
    height: winH,
    scale: 1.0,
    droppedAt: Date.now(),
  };
}

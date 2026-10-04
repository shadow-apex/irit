/**
 * electron/main/coords.mjs
 *
 * TL-05: đổi toạ độ đọc từ KHUNG vision (đã thu nhỏ ≤ 1280×720) sang pixel vật lý của màn hình.
 * Module thuần.
 */

/**
 * @param {number} x
 * @param {number} y
 * @param {{frame_w:number,frame_h:number,screen_w:number,screen_h:number,origin_x?:number,origin_y?:number}} g
 * @returns {{x:number,y:number}}
 */
export function frameToScreen(x, y, g) {
  if (!g || !(g.frame_w > 0) || !(g.frame_h > 0)) throw new Error("Thiếu hình học khung vision.");
  const fx = Math.min(Math.max(x, 0), g.frame_w);
  const fy = Math.min(Math.max(y, 0), g.frame_h);
  return {
    x: Math.round((g.origin_x || 0) + (fx * g.screen_w) / g.frame_w),
    y: Math.round((g.origin_y || 0) + (fy * g.screen_h) / g.frame_h),
  };
}

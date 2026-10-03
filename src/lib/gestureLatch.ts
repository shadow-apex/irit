// src/lib/gestureLatch.ts
//
// V-09: kích hoạt cử chỉ THEO CẠNH (edge-triggered). Trước đây effect chạy lại mỗi khi `hand.point`
// đổi (60 lần/giây) và bắn lại cử chỉ sau mỗi 1 s nếu người dùng vẫn giữ nguyên tư thế — Thumb_Up =
// phím Win lặp lại, Victory = Win+D lặp lại...
//
// Quy tắc:
//  - cử chỉ "giữ" (shush, pinch, thumb_up, victory, thumb_down): chỉ bắn khi chuyển từ KHÔNG CÓ
//    sang CÓ, sau khi đã nhả ≥ releaseMs, qua cooldown, và (nếu có holdMs) đã giữ đủ lâu;
//  - cử chỉ "xung" (swipe_*, zoom_*): bắn một lần khi xuất hiện, chỉ qua cooldown.
//
// Chỉ dùng cú pháp TypeScript "erasable" để Node chạy test trực tiếp.

export interface GestureLatchOptions {
  cooldownMs?: number;
  releaseMs?: number;
  /** Thời gian phải giữ liên tục trước khi bắn, theo tên cử chỉ (vd shush: 800, thumb_down: 2000). */
  holdMs?: Record<string, number>;
}

interface Track {
  active: boolean;
  activeSince: number;
  inactiveSince: number;
  armed: boolean; // true = lần xuất hiện hiện tại vẫn còn quyền bắn
  lastFire: number;
}

export function createGestureLatch(options: GestureLatchOptions = {}) {
  const cooldownMs = options.cooldownMs ?? 1200;
  const releaseMs = options.releaseMs ?? 300;
  const holdMs = options.holdMs ?? {};
  const tracks = new Map<string, Track>();

  const trackOf = (name: string): Track => {
    let t = tracks.get(name);
    if (!t) {
      t = { active: false, activeSince: 0, inactiveSince: -Infinity, armed: false, lastFire: -Infinity };
      tracks.set(name, t);
    }
    return t;
  };

  return {
    /** Gọi định kỳ với tập cử chỉ đang được giữ; trả về các cử chỉ cần bắn NGAY LÚC NÀY. */
    update(activeNow: Iterable<string>, t: number): string[] {
      const current = new Set(activeNow);
      const fired: string[] = [];
      for (const name of new Set([...tracks.keys(), ...current])) {
        const tr = trackOf(name);
        if (current.has(name)) {
          if (!tr.active) {
            tr.active = true;
            tr.activeSince = t;
            // chỉ "armed" nếu trước đó đã nhả đủ lâu (hoặc chưa từng xuất hiện)
            tr.armed = t - tr.inactiveSince >= releaseMs;
          }
          const need = holdMs[name] ?? 0;
          if (tr.armed && t - tr.activeSince >= need && t - tr.lastFire >= cooldownMs) {
            tr.armed = false; // một lần cho mỗi lần xuất hiện
            tr.lastFire = t;
            fired.push(name);
          }
        } else if (tr.active) {
          tr.active = false;
          tr.armed = false;
          tr.inactiveSince = t;
        }
      }
      return fired;
    },

    /** Cử chỉ xung (swipe/zoom): bắn một lần nếu qua cooldown. */
    pulse(name: string, t: number): boolean {
      const tr = trackOf(name);
      if (t - tr.lastFire < cooldownMs) return false;
      tr.lastFire = t;
      return true;
    },

    reset() {
      tracks.clear();
    },
  };
}

export type GestureLatch = ReturnType<typeof createGestureLatch>;

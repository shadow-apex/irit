/**
 * electron/main/network-utils.mjs
 *
 * G-04: chọn IPv4 LAN "thật" cho mã QR companion. Trước đây lấy địa chỉ đầu tiên không-internal — có thể
 * là adapter ảo (WSL/Hyper-V/Docker/VPN) làm QR trỏ sai IP. Module thuần.
 */
const VIRTUAL = /(vethernet|wsl|hyper-?v|docker|virtualbox|vbox|vmware|vmnet|tailscale|zerotier|vpn|tun|tap|utun|bridge|loopback|bluetooth|npcap|pseudo)/i;

function isPrivateLan(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false;
  return p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
}

/** @param {Record<string, Array<{family:string|number,internal:boolean,address:string}>>} interfaces */
export function pickLanAddress(interfaces) {
  const candidates = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const net of list || []) {
      const v4 = net.family === "IPv4" || net.family === 4;
      if (!v4 || net.internal || /^169\.254\./.test(net.address)) continue; // bỏ link-local
      candidates.push({ name, address: net.address, virtual: VIRTUAL.test(name), lan: isPrivateLan(net.address) });
    }
  }
  const best =
    candidates.find((c) => !c.virtual && c.lan) ||
    candidates.find((c) => !c.virtual) ||
    candidates.find((c) => c.lan) ||
    candidates[0];
  return best ? best.address : "localhost";
}

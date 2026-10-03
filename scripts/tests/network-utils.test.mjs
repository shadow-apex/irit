import test from "node:test";
import assert from "node:assert/strict";
import { pickLanAddress } from "../../electron/main/network-utils.mjs";
const n = (address, internal = false) => ({ family: "IPv4", internal, address });
test("ưu tiên Wi-Fi/Ethernet LAN thật, bỏ adapter ảo (WSL/Docker/VPN) và link-local", () => {
  assert.equal(pickLanAddress({
    "vEthernet (WSL)": [n("172.28.0.1")], "docker0": [n("172.17.0.1")], "Tailscale": [n("100.64.0.5")],
    "Wi-Fi": [n("192.168.1.23")], "Ethernet": [n("169.254.3.4")], lo: [n("127.0.0.1", true)],
  }), "192.168.1.23");
});
test("chỉ có adapter ảo => vẫn trả một địa chỉ; không có gì => localhost", () => {
  assert.equal(pickLanAddress({ "vEthernet (WSL)": [n("172.28.0.1")] }), "172.28.0.1");
  assert.equal(pickLanAddress({ lo: [n("127.0.0.1", true)] }), "localhost");
  assert.equal(pickLanAddress({}), "localhost");
});

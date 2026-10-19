import test from "node:test";
import assert from "node:assert/strict";
import {
  parseGeminiKeys,
  getAllGeminiKeys,
  getNextGeminiKey,
  markKeyRateLimited,
  isKeyRateLimited,
  withGeminiFailover,
  getGenAiClient,
  resetGeminiKeyPoolState,
  getGeminiPartitions,
} from "../../electron/main/gemini-keys.mjs";

function withSavedEnv(fn) {
  return async () => {
    const prev = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_API_KEYS: process.env.GEMINI_API_KEYS,
      GEMINI_VISION_API_KEY: process.env.GEMINI_VISION_API_KEY,
    };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEYS;
    delete process.env.GEMINI_VISION_API_KEY;
    resetGeminiKeyPoolState();
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetGeminiKeyPoolState();
    }
  };
}

test("parseGeminiKeys: tách chuỗi bằng dấu phẩy, chấm phẩy, xuống dòng, khoảng trắng và khử trùng lặp", () => {
  assert.deepEqual(parseGeminiKeys(""), []);
  assert.deepEqual(parseGeminiKeys(null), []);
  assert.deepEqual(parseGeminiKeys(undefined), []);

  const raw = "  key_1 , key_2 ; key_3 \n key_4 \r\n key_2 , 'key_5' , \"key_1\"  ";
  assert.deepEqual(parseGeminiKeys(raw), ["key_1", "key_2", "key_3", "key_4", "key_5"]);
});

test(
  "getAllGeminiKeys: đọc từ GEMINI_API_KEYS, GEMINI_API_KEY và GEMINI_VISION_API_KEY (tương thích ngược 1 key)",
  withSavedEnv(() => {
    process.env.GEMINI_API_KEY = "single_key_only";
    assert.deepEqual(getAllGeminiKeys(), ["single_key_only"]);

    process.env.GEMINI_API_KEYS = "pool_1, pool_2";
    process.env.GEMINI_API_KEY = "pool_2, pool_3";
    process.env.GEMINI_VISION_API_KEY = "vision_1";

    assert.deepEqual(getAllGeminiKeys(), ["pool_1", "pool_2", "pool_3", "vision_1"]);
    assert.deepEqual(getAllGeminiKeys({ preferVision: true }), ["vision_1", "pool_1", "pool_2", "pool_3"]);
    assert.deepEqual(getAllGeminiKeys({ includeVision: false }), ["pool_1", "pool_2", "pool_3"]);
  })
);

test(
  "getNextGeminiKey: xoay vòng Round-Robin đều qua các key và bỏ qua key đang cooldown",
  withSavedEnv(() => {
    process.env.GEMINI_API_KEY = "key_A,key_B,key_C";

    assert.equal(getNextGeminiKey(), "key_A");
    assert.equal(getNextGeminiKey(), "key_B");
    assert.equal(getNextGeminiKey(), "key_C");
    assert.equal(getNextGeminiKey(), "key_A");

    // Đánh dấu key_B bị giới hạn 429 (cooldown 60s) -> lượt kế tiếp phải nhảy qua key_B sang key_C
    markKeyRateLimited("key_B", 60);
    assert.equal(isKeyRateLimited("key_B"), true);
    assert.equal(getNextGeminiKey(), "key_C");
    assert.equal(getNextGeminiKey(), "key_A");
    assert.equal(getNextGeminiKey(), "key_C");

    // Hết hạn cooldown (cooldownSeconds = 0) -> key_B hoạt động trở lại
    markKeyRateLimited("key_B", 0);
    assert.equal(isKeyRateLimited("key_B"), false);
  })
);

test(
  "withGeminiFailover: bắt lỗi 429 / RESOURCE_EXHAUSTED / quota exceeded và tự động chuyển ngay sang key kế tiếp",
  withSavedEnv(async () => {
    process.env.GEMINI_API_KEY = "key_1,key_2,key_3";

    const triedKeys = [];
    const startTime = Date.now();

    const result = await withGeminiFailover(
      async (apiKey) => {
        triedKeys.push(apiKey);
        if (apiKey === "key_1") {
          const err = new Error("429 Too Many Requests: RESOURCE_EXHAUSTED");
          err.status = 429;
          throw err;
        }
        if (apiKey === "key_2") {
          throw new Error("You exceeded your current quota, please check your plan and billing details.");
        }
        return `success-with-${apiKey}`;
      },
      { maxRetries: 3, cooldownSeconds: 60 }
    );

    const elapsedMs = Date.now() - startTime;
    assert.equal(result, "success-with-key_3");
    assert.deepEqual(triedKeys, ["key_1", "key_2", "key_3"]);
    assert.equal(isKeyRateLimited("key_1"), true);
    assert.equal(isKeyRateLimited("key_2"), true);
    assert.equal(isKeyRateLimited("key_3"), false);
    assert.ok(elapsedMs < 300, `Thời gian tự động chuyển key phải < 300ms (thực tế: ${elapsedMs}ms)`);
  })
);

test(
  "withGeminiFailover: ném ngay các lỗi không phải 429 mà không đánh dấu cooldown key",
  withSavedEnv(async () => {
    process.env.GEMINI_API_KEY = "key_1,key_2";

    await assert.rejects(
      () =>
        withGeminiFailover(async () => {
          throw new Error("Invalid argument: bad request payload");
        }),
      /Invalid argument/
    );

    assert.equal(isKeyRateLimited("key_1"), false);
  })
);

test(
  "getGenAiClient: trả về instance GoogleGenAI theo key khả dụng tiếp theo",
  withSavedEnv(() => {
    assert.equal(getGenAiClient(), null);
    process.env.GEMINI_API_KEY = "key_alpha,key_beta";
    const client1 = getGenAiClient();
    const client2 = getGenAiClient();
    assert.ok(client1 && typeof client1.models === "object");
    assert.ok(client2 && typeof client2.models === "object");
    assert.notEqual(client1, client2);
  })
);

test(
  "getGeminiPartitions: phân bổ 3 key độc lập (Live: k1, Meeting/Teleprompter: k2, Vision: k3) + 7 keys kho dự phòng chung (k4..k10)",
  withSavedEnv(() => {
    process.env.GEMINI_API_KEYS = "k1,k2,k3,k4,k5,k6,k7,k8,k9,k10";
    const partitions = getGeminiPartitions();

    assert.equal(partitions.all.length, 10);
    assert.equal(partitions.primary.live, "k1");
    assert.equal(partitions.primary.meeting, "k2");
    assert.equal(partitions.primary.vision, "k3");
    assert.deepEqual(partitions.standby, ["k4", "k5", "k6", "k7", "k8", "k9", "k10"]);
  })
);

test(
  "getNextGeminiKey: bình thường dùng 3 key độc lập (k1, k2, k3) không đụng nhau; khi 1 key chạm 429 thì lấy từ kho dự phòng 7 keys",
  withSavedEnv(() => {
    process.env.GEMINI_API_KEYS = "k1,k2,k3,k4,k5,k6,k7,k8,k9,k10";

    // 1) Khi bình thường: Mỗi nhóm chỉ dùng ĐÚNG key độc lập của mình
    assert.equal(getNextGeminiKey({ purpose: "live" }), "k1");
    assert.equal(getNextGeminiKey({ purpose: "live" }), "k1");
    assert.equal(getNextGeminiKey({ purpose: "meeting" }), "k2");
    assert.equal(getNextGeminiKey({ purpose: "teleprompter" }), "k2");
    assert.equal(getNextGeminiKey({ purpose: "vision" }), "k3");
    assert.equal(getNextGeminiKey({ purpose: "vision" }), "k3");

    // 2) Khi key độc lập của Live (k1) bị 429 / cooldown 60s:
    markKeyRateLimited("k1", 60);
    // Live lập tức lấy key từ kho dự phòng dùng chung (k4, k5...)
    assert.equal(getNextGeminiKey({ purpose: "live" }), "k4");
    assert.equal(getNextGeminiKey({ purpose: "live" }), "k5");

    // Trong lúc đó, Meeting vẫn an toàn dùng k2, Vision vẫn dùng k3!
    assert.equal(getNextGeminiKey({ purpose: "meeting" }), "k2");
    assert.equal(getNextGeminiKey({ purpose: "vision" }), "k3");

    // 3) Khi k1 hết hạn cooldown (hết 60s): Live tự động quay về sử dụng lại k1 độc lập của mình!
    markKeyRateLimited("k1", 0);
    assert.equal(getNextGeminiKey({ purpose: "live" }), "k1");
  })
);

test(
  "Standby Exhaustion: khi tất cả 7 keys kho dự phòng cũng cạn, mượn tạm key chính của nhóm khác",
  withSavedEnv(() => {
    process.env.GEMINI_API_KEYS = "k1,k2,k3,k4,k5,k6,k7,k8,k9,k10";

    // Cho k1 và cả 7 keys standby (k4..k10) vào cooldown
    markKeyRateLimited("k1", 60);
    for (const k of ["k4", "k5", "k6", "k7", "k8", "k9", "k10"]) {
      markKeyRateLimited(k, 60);
    }

    // Lần gọi của Live sẽ mượn tạm key k2 hoặc k3 còn rảnh để tác vụ không bị chết
    const fallbackKey = getNextGeminiKey({ purpose: "live" });
    assert.ok(["k2", "k3"].includes(fallbackKey));
  })
);

test(
  "Tương thích ngược 1 key duy nhất: cả 3 nhóm đều dùng key đó, và withGeminiFailover không lặp vô nghĩa",
  withSavedEnv(async () => {
    process.env.GEMINI_API_KEY = "sole_key";
    const partitions = getGeminiPartitions();

    assert.equal(partitions.primary.live, "sole_key");
    assert.equal(partitions.primary.meeting, "sole_key");
    assert.equal(partitions.primary.vision, "sole_key");
    assert.deepEqual(partitions.standby, []);

    assert.equal(getNextGeminiKey({ purpose: "live" }), "sole_key");
    assert.equal(getNextGeminiKey({ purpose: "meeting" }), "sole_key");
    assert.equal(getNextGeminiKey({ purpose: "vision" }), "sole_key");

    let callCount = 0;
    await assert.rejects(
      () =>
        withGeminiFailover(
          async (apiKey) => {
            callCount++;
            const err = new Error("429 RESOURCE_EXHAUSTED");
            err.status = 429;
            throw err;
          },
          { maxRetries: 3, purpose: "meeting" }
        ),
      /RESOURCE_EXHAUSTED/
    );

    // Với 1 key duy nhất, sau khi key đó bị 429 và đưa vào cooldown,
    // withGeminiFailover không cố chấp gọi lại key đó 3 lần liên tiếp trong 0ms.
    assert.equal(callCount, 1);
    assert.equal(isKeyRateLimited("sole_key"), true);
  })
);

/**
 * assets/spatial_desk/desk-hud/desk-canvas.js
 *
 * Bộ dựng đồ hoạ không gian 2D/3D chiếu xuống mặt bàn (Spatial AI Desk HUD):
 *  1. Infinite Desk Extension: Cửa sổ máy tính trượt từ mép trên xuống mặt bàn gỗ.
 *  2. Touch & Pinch-to-Zoom: Chạm ngón trỏ di chuyển cửa sổ & chụm/tách THUMB_TIP + INDEX_FINGER_TIP để thu phóng.
 *  3. Virtual Laser Caliper: Vẽ vạch thước laze neon xanh chuẩn milimet (5mm/10mm ticks).
 *  4. X-Ray Hardware Inspector & Aura Object Locator: Quét tia laser X-Ray linh kiện & vòng hào quang Pulsing Aura tìm đồ vật.
 *  5. 3D .STL Hologram Turntable: Chiếu mô hình 3D (.STL) xoay 360 độ trên mặt bàn.
 *  6. Auto ProCam Calibration (2s): Nháy mẫu bàn cờ ArUco tương phản cao 1.5s & chiếu vòng hào quang xanh "Hiệu chuẩn thành công!".
 *  7. Interactive PCB Pinout Overlay: Chiếu tia laze từ chân chip thật ra bàn gỗ ([VCC - Đỏ], [GND - Xanh sẫm], [GPIO/PWM - Cyan], [TX/RX - Cam], [ADC - Tím]) & chạm ngón tay xem điện áp/I2C/SPI.
 *  8. Direct 3D Printer Progress Ring: Nút ảo phát sáng "Bắt đầu In 3D" & vòng tròn tiến độ (%) xoay quanh mô hình 3D.
 *  9. Multi-View 3D Photogrammetry HUD: Vòng radar chụp 8-16 góc & khung dây 3D xoay 360° ngay bên cạnh vật thể thật.
 */

(function initSpatialDeskHud() {
  const canvas = document.getElementById("desk-spatial-canvas");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const windowsLayer = document.getElementById("desk-windows-layer");
  const dropPortal = document.getElementById("infinite-drop-portal");
  const pinoutPopover = document.getElementById("pinout-detail-popover");

  const params = new URLSearchParams(window.location.search);
  const initialMode = params.get("mode") || "simulator";
  const initialPpm = parseFloat(params.get("ppm") || "4.25") || 4.25;

  const DEFAULT_ESP32_PINS = [
    { pin_number: 1, name: "3V3", category: "VCC", color: "#ff2a55", category_tag: "[VCC - Đỏ]", side: "left", voltage: "3.3V", protocols: ["Power"], max_current_ma: 600, description_vi: "Ngõ ra nguồn ổn áp 3.3V cấp cho cảm biến ngoại vi (tối đa 600mA)." },
    { pin_number: 2, name: "EN / RST", category: "GPIO_PWM", color: "#00f3ff", category_tag: "[GPIO / PWM - Xanh cyan]", side: "left", voltage: "3.3V", protocols: ["Control"], max_current_ma: 12, description_vi: "Chân Enable / Reset chip ESP32 (kéo xuống GND để khởi động lại)." },
    { pin_number: 3, name: "VP (GPIO36)", category: "ADC", color: "#c44dff", category_tag: "[ADC - Tím]", side: "left", voltage: "3.3V", protocols: ["ADC1_CH0", "Input-Only"], max_current_ma: 12, description_vi: "Chân đọc tín hiệu Analog 12-bit ADC1_CH0 (Chỉ nhận tín hiệu vào)." },
    { pin_number: 4, name: "D34 (GPIO34)", category: "ADC", color: "#c44dff", category_tag: "[ADC - Tím]", side: "left", voltage: "3.3V", protocols: ["ADC1_CH6"], max_current_ma: 12, description_vi: "Chân Analog ADC1_CH6 độ nhạy cao (0V - 3.3V)." },
    { pin_number: 5, name: "D32 (GPIO32)", category: "ADC", color: "#c44dff", category_tag: "[ADC - Tím]", side: "left", voltage: "3.3V", protocols: ["ADC1_CH4", "PWM", "Touch9"], max_current_ma: 40, description_vi: "Chân đa năng: Đọc Analog ADC1_CH4, phát xung PWM và cảm ứng Touch9." },
    { pin_number: 6, name: "D25 (DAC1)", category: "ADC", color: "#c44dff", category_tag: "[ADC - Tím]", side: "left", voltage: "3.3V", protocols: ["DAC1", "ADC2_CH8"], max_current_ma: 40, description_vi: "Bộ xuất tín hiệu tương tự thực DAC1 (8-bit) & đọc ADC2_CH8." },
    { pin_number: 7, name: "D14 (HSPI)", category: "GPIO_PWM", color: "#00f3ff", category_tag: "[GPIO / PWM - Xanh cyan]", side: "left", voltage: "3.3V", protocols: ["HSPI_CLK", "PWM"], max_current_ma: 40, description_vi: "Chân xung nhịp SPI tốc độ cao (HSPI_CLK) & điều khiển PWM." },
    { pin_number: 8, name: "GND", category: "GND", color: "#1e64ff", category_tag: "[GND - Xanh sẫm]", side: "left", voltage: "0V", protocols: ["Ground"], max_current_ma: 1000, description_vi: "Chân nối đất chung (0V Reference Ground) của toàn mạch." },
    { pin_number: 9, name: "VIN (5V)", category: "VCC", color: "#ff2a55", category_tag: "[VCC - Đỏ]", side: "left", voltage: "5.0V", protocols: ["Power_In", "USB_5V"], max_current_ma: 1000, description_vi: "Chân cấp nguồn đầu vào 5V DC (hoặc lấy nguồn 5V trực tiếp từ USB)." },
    { pin_number: 10, name: "D23 (MOSI)", category: "GPIO_PWM", color: "#00f3ff", category_tag: "[GPIO / PWM - Xanh cyan]", side: "right", voltage: "3.3V", protocols: ["VSPI_MOSI", "PWM"], max_current_ma: 40, description_vi: "Chân truyền dữ liệu SPI chính (VSPI MOSI) & điều xung PWM." },
    { pin_number: 11, name: "D22 (SCL)", category: "GPIO_PWM", color: "#00f3ff", category_tag: "[GPIO / PWM - Xanh cyan]", side: "right", voltage: "3.3V", protocols: ["I2C_SCL", "PWM"], max_current_ma: 40, description_vi: "Chân xung nhịp giao tiếp I2C mặc định (I2C SCL) mức điện áp 3.3V." },
    { pin_number: 12, name: "TX0 (GPIO1)", category: "UART", color: "#ff9d00", category_tag: "[TX/RX - Vàng cam]", side: "right", voltage: "3.3V", protocols: ["UART0_TX"], max_current_ma: 40, description_vi: "Chân truyền dữ liệu nối tiếp UART0 TX." },
    { pin_number: 13, name: "RX0 (GPIO3)", category: "UART", color: "#ff9d00", category_tag: "[TX/RX - Vàng cam]", side: "right", voltage: "3.3V", protocols: ["UART0_RX"], max_current_ma: 40, description_vi: "Chân nhận dữ liệu nối tiếp UART0 RX." },
    { pin_number: 14, name: "D21 (SDA)", category: "GPIO_PWM", color: "#00f3ff", category_tag: "[GPIO / PWM - Xanh cyan]", side: "right", voltage: "3.3V", protocols: ["I2C_SDA", "PWM"], max_current_ma: 40, description_vi: "Chân dữ liệu giao tiếp I2C mặc định (I2C SDA) mức điện áp 3.3V." },
    { pin_number: 15, name: "D19 (MISO)", category: "GPIO_PWM", color: "#00f3ff", category_tag: "[GPIO / PWM - Xanh cyan]", side: "right", voltage: "3.3V", protocols: ["VSPI_MISO", "PWM"], max_current_ma: 40, description_vi: "Chân nhận dữ liệu giao tiếp SPI chính (VSPI MISO)." },
    { pin_number: 16, name: "D18 (SCK)", category: "GPIO_PWM", color: "#00f3ff", category_tag: "[GPIO / PWM - Xanh cyan]", side: "right", voltage: "3.3V", protocols: ["VSPI_SCK", "PWM"], max_current_ma: 40, description_vi: "Chân xung nhịp giao tiếp SPI chính (VSPI SCK)." },
    { pin_number: 17, name: "TX2 (GPIO17)", category: "UART", color: "#ff9d00", category_tag: "[TX/RX - Vàng cam]", side: "right", voltage: "3.3V", protocols: ["UART2_TX"], max_current_ma: 40, description_vi: "Chân truyền dữ liệu nối tiếp phần cứng thứ hai UART2 TX." },
    { pin_number: 18, name: "GND", category: "GND", color: "#1e64ff", category_tag: "[GND - Xanh sẫm]", side: "right", voltage: "0V", protocols: ["Ground"], max_current_ma: 1000, description_vi: "Chân nối đất chung bên phải bo mạch." },
  ];

  const state = {
    mode: initialMode,
    ppm: initialPpm,
    activeTool: "laser-caliper",
    showLaserCaliper: true,
    showXray: false,
    showAura: true,
    show3dStl: true,
    showCalibrationGrid: false,
    showPinout: false,
    showPhotogrammetry: false,
    autoCalib: {
      flashingPattern: false,
      flashStartedAt: 0,
      flashDurationMs: 1500,
      successHaloActive: false,
      haloStartedAt: 0,
      haloDurationMs: 2800,
      lastMessage: "HIỆU CHUẨN THÀNH CÔNG!",
      markersDetected: 4,
    },
    pinout: {
      board_id: "esp32",
      board_name: "ESP32-WROOM-32 DevKit V1",
      chip_marking: "ESP32-D0WDQ6",
      operating_voltage: "3.3V (VIN 5V)",
      pose: {
        center_x: 560,
        center_y: 430,
        width_px: 136,
        height_px: 248,
        angle_deg: 0,
      },
      pins: [],
      selectedPin: null,
    },
    printerJob: {
      active: false,
      state: "idle",
      printer_name: "Bambu Lab X1 Carbon",
      protocol: "bambu_lan_mqtt_ftps",
      progress_percent: 0,
      layer_current: 0,
      layer_count: 114,
      nozzle_temp_c: 215,
      bed_temp_c: 60,
      filament_g: 14.2,
      estimated_time_min: 18,
      startedAt: 0,
    },
    photogrammetry: {
      label: "Vật thể quét 3D đa góc",
      stl_path: "Desktop/iris_reconstructed_mesh.stl",
      obj_path: "Desktop/iris_reconstructed_mesh.obj",
      views_captured: 12,
      capture_angles_deg: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
      vertex_count: 98,
      facet_count: 192,
      outer_dimensions_mm: { length: 48.0, width: 42.0, height: 44.0 },
      vertices: [],
      edges: [],
    },
    xrayScanPhase: 0,
    stlRotationAngle: 0,
    caliper: {
      label: "Bo mạch ESP32 / Vật mẫu",
      length_mm: 52.0,
      width_mm: 28.0,
      height_mm: 15.0,
      bbox: [360, 290, Math.round(52 * initialPpm), Math.round(28 * initialPpm)],
    },
    xrayCallouts: [
      { dx: -115, dy: -65, title: "Chip ESP32-S3 Wi-Fi/BLE", sub: "Dual-Core 240MHz • 8MB PSRAM" },
      { dx: 135, dy: -55, title: "Cổng USB Type-C PD", sub: "Nguồn cấp 5V / Giao tiếp UART" },
      { dx: -120, dy: 70, title: "Chân nguồn 5V & GND", sub: "Dòng định mức 2.0A Max" },
      { dx: 135, dy: 68, title: "Anten PCB 2.4GHz", sub: "Độ lợi +2.5dBi • Tín hiệu tốt" },
    ],
    auraObjects: [
      { id: "aura-1", label: "[Chìa khóa nhà]", x: 260, y: 540, radius: 54, color: "#00ff9d" },
      { id: "aura-2", label: "[Bút dạ quang]", x: 960, y: 560, radius: 48, color: "#00f3ff" },
    ],
    stlModel: {
      stl_path: "Desktop/iris_spatial_box.stl",
      model_type: "sliding_box",
      outer_dimensions_mm: { length: 57.6, width: 33.6, height: 22.8 },
      wall_mm: 2.0,
      vertices: [
        [-28.8, -16.8, -11.4], [28.8, -16.8, -11.4], [28.8, 16.8, -11.4], [-28.8, 16.8, -11.4],
        [-28.8, -16.8, 11.4], [28.8, -16.8, 11.4], [28.8, 16.8, 11.4], [-28.8, 16.8, 11.4],
        [-26.8, -14.8, -9.4], [26.8, -14.8, -9.4], [26.8, 14.8, -9.4], [-26.8, 14.8, -9.4],
        [-26.8, -14.8, 11.4], [26.8, -14.8, 11.4], [26.8, 14.8, 11.4], [-26.8, 14.8, 11.4],
      ],
      edges: [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
        [8, 9], [9, 10], [10, 11], [11, 8],
        [12, 13], [13, 14], [14, 15], [15, 12],
        [8, 12], [9, 13], [10, 14], [11, 15],
        [4, 12], [5, 13], [6, 14], [7, 15],
      ],
    },
    cadAssembly: {
      active: true,
      file_name: "iris_spatial_box.stl",
      dimensions_mm: { length: 58.0, width: 34.0, height: 24.0 },
      is_exploded: false,
      explode_distance_mm: 38.0,
      scale: 2.2,
      posX: null,
      posY: null,
      angleY: 0.0,
      angleX: 0.48,
      autoRotate: true,
      isDraggingModel: false,
      isRotatingModel: false,
      dragStartPt: null,
      startPos: null,
      startAngleY: 0.0,
      startAngleX: 0.48,
      components: [],
      handles: [],
      draggingGizmo: null,
      gizmoStartPt: null,
      startDimensions: null,
    },
    hand: {
      active: false,
      thumbTip: null,
      indexTip: null,
      center: null,
      pinchDistancePx: 0,
      isTouching: false,
      isPinchZoomActive: false,
      scale: 1.0,
      lastSeenAt: 0,
    },
    touchRipples: [],
    wasTouching: false,
    projectedWindows: [],
    draggingCalibPoint: false,
  };

  // Khởi tạo toạ độ tia laze mặc định cho sơ đồ chân ESP32 và khung dây Photogrammetry
  function rebuildPinoutRaysFromPose() {
    const pose = state.pinout.pose;
    const cx = Number(pose.center_x) || Math.round(window.innerWidth * 0.44);
    const cy = Number(pose.center_y) || Math.round(window.innerHeight * 0.48);
    const bw = Number(pose.width_px) || 136;
    const bh = Number(pose.height_px) || 248;
    const rad = ((Number(pose.angle_deg) || 0) * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    const rawPins = state.pinout.pins.length > 0 ? state.pinout.pins : DEFAULT_ESP32_PINS;
    const leftPins = rawPins.filter((p) => p.side === "left");
    const rightPins = rawPins.filter((p) => p.side !== "left");
    const computed = [];

    function layoutSide(list, isLeft) {
      const n = list.length || 1;
      const edgeX = isLeft ? -bw / 2 : bw / 2;
      const dirX = isLeft ? -1 : 1;
      const rayLen = 88;
      list.forEach((p, idx) => {
        const t = (idx + 0.5) / n - 0.5;
        const localY = t * (bh * 0.86);
        const pinX = cx + (edgeX * cosA - localY * sinA);
        const pinY = cy + (edgeX * sinA + localY * cosA);
        const lblLocalX = edgeX + dirX * rayLen;
        const labelX = cx + (lblLocalX * cosA - localY * sinA);
        const labelY = cy + (lblLocalX * sinA + localY * cosA);
        computed.push({
          ...p,
          pin_x: pinX,
          pin_y: pinY,
          label_x: labelX,
          label_y: labelY,
          touch_radius_px: 24,
        });
      });
    }

    layoutSide(leftPins, true);
    layoutSide(rightPins, false);
    state.pinout.pins = computed;
  }

  function buildDefaultPhotogrammetryWireframe() {
    const views = 12;
    const slices = 6;
    const verts = [];
    const edges = [];
    for (let s = 0; s < slices; s++) {
      const zNorm = s / (slices - 1);
      const z = (zNorm - 0.5) * 44;
      const r = 18 + 7 * Math.sin(zNorm * Math.PI);
      for (let v = 0; v < views; v++) {
        const ang = (v * Math.PI * 2) / views;
        verts.push([r * Math.cos(ang), r * Math.sin(ang), z]);
        const cur = s * views + v;
        const nextRing = s * views + ((v + 1) % views);
        edges.push([cur, nextRing]);
        if (s < slices - 1) {
          edges.push([cur, (s + 1) * views + v]);
        }
      }
    }
    state.photogrammetry.vertices = verts;
    state.photogrammetry.edges = edges;
  }

  function buildDefaultCadComponents() {
    const d = state.cadAssembly.dimensions_mm || { length: 58.0, width: 34.0, height: 24.0 };
    const l2 = d.length / 2.0;
    const w2 = d.width / 2.0;
    const h2 = d.height / 2.0;
    const lidH = 5.0;
    const explodeOffset = state.cadAssembly.is_exploded ? state.cadAssembly.explode_distance_mm : 0.0;

    // 1. Thân hộp (Box Body)
    const bodyTop = h2 - lidH;
    const bodyVerts = [
      [-l2, -w2, -h2], [l2, -w2, -h2], [l2, w2, -h2], [-l2, w2, -h2],
      [-l2, -w2, bodyTop], [l2, -w2, bodyTop], [l2, w2, bodyTop], [-l2, w2, bodyTop],
      [-l2 + 2, -w2 + 2, -h2 + 2], [l2 - 2, -w2 + 2, -h2 + 2], [l2 - 2, w2 - 2, -h2 + 2], [-l2 + 2, w2 - 2, -h2 + 2],
      [-l2 + 2, -w2 + 2, bodyTop], [l2 - 2, -w2 + 2, bodyTop], [l2 - 2, w2 - 2, bodyTop], [-l2 + 2, w2 - 2, bodyTop],
    ];
    const bodyEdges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
      [8, 9], [9, 10], [10, 11], [11, 8],
      [12, 13], [13, 14], [14, 15], [15, 12],
      [8, 12], [9, 13], [10, 14], [11, 15],
    ];

    // 2. Nắp trượt (Sliding Lid)
    const lidBot = bodyTop + 0.4 + explodeOffset;
    const lidTop = h2 + explodeOffset;
    const lidVerts = [
      [-l2, -w2, lidBot], [l2, -w2, lidBot], [l2, w2, lidBot], [-l2, w2, lidBot],
      [-l2, -w2, lidTop], [l2, -w2, lidTop], [l2, w2, lidTop], [-l2, w2, lidTop],
      [-l2 * 0.4, -w2 * 0.3, lidTop], [l2 * 0.4, -w2 * 0.3, lidTop], [l2 * 0.4, w2 * 0.3, lidTop], [-l2 * 0.4, w2 * 0.3, lidTop],
    ];
    const lidEdges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
      [8, 9], [9, 10], [10, 11], [11, 8],
    ];

    state.cadAssembly.components = [
      { id: "part-body", name: "Thân Hộp", color: "#00f3ff", vertices: bodyVerts, edges: bodyEdges },
      { id: "part-lid", name: "Nắp Trượt", color: "#00ff9d", vertices: lidVerts, edges: lidEdges },
    ];
  }

  function syncCadDimensionsDom() {
    const d = state.cadAssembly.dimensions_mm || { length: 58, width: 34, height: 24 };
    const lenEl = document.getElementById("cad-len-display");
    const widEl = document.getElementById("cad-wid-display");
    const heiEl = document.getElementById("cad-hei-display");
    if (lenEl) lenEl.textContent = `${Math.round(d.length)}mm`;
    if (widEl) widEl.textContent = `${Math.round(d.width)}mm`;
    if (heiEl) heiEl.textContent = `${Math.round(d.height)}mm`;
    const nameEl = document.getElementById("stl-model-name");
    if (nameEl) {
      nameEl.textContent = `${state.cadAssembly.file_name} (${Math.round(d.length)}×${Math.round(d.width)}×${Math.round(d.height)}mm)`;
    }
  }

  rebuildPinoutRaysFromPose();
  buildDefaultPhotogrammetryWireframe();
  buildDefaultCadComponents();
  syncCadDimensionsDom();

  function addTouchRipple(x, y, color = "#00ff9d") {
    state.touchRipples.push({
      x,
      y,
      radius: 6,
      maxRadius: 44,
      alpha: 0.95,
      color,
    });
    if (state.touchRipples.length > 15) state.touchRipples.shift();
  }

  function showPinoutDetailPopover(pin) {
    if (!pin) return;
    state.pinout.selectedPin = pin;
    if (!pinoutPopover) return;
    pinoutPopover.classList.remove("hidden");
    pinoutPopover.style.borderColor = pin.color || "#00f3ff";

    const badgeEl = document.getElementById("pinout-popover-badge");
    const titleEl = document.getElementById("pinout-popover-title");
    const voltEl = document.getElementById("pinout-popover-voltage");
    const protoEl = document.getElementById("pinout-popover-protocols");
    const curEl = document.getElementById("pinout-popover-current");
    const numEl = document.getElementById("pinout-popover-pinnum");
    const descEl = document.getElementById("pinout-popover-desc");

    if (badgeEl) {
      badgeEl.textContent = pin.category_tag || `[${pin.category}]`;
      badgeEl.style.borderColor = pin.color || "#00f3ff";
      badgeEl.style.color = pin.color || "#00f3ff";
    }
    if (titleEl) titleEl.textContent = pin.name || `Pin #${pin.pin_number}`;
    if (voltEl) voltEl.textContent = pin.voltage || "3.3V / 5.0V";
    if (protoEl) {
      protoEl.textContent = Array.isArray(pin.protocols) ? pin.protocols.join(" • ") : String(pin.protocols || "GPIO");
    }
    if (curEl) curEl.textContent = `${pin.max_current_ma || 40} mA`;
    if (numEl) numEl.textContent = `Chân #${pin.pin_number} (${String(pin.side || "left").toUpperCase()})`;
    if (descEl) descEl.textContent = pin.description_vi || "Chân giao tiếp chức năng của bo mạch.";
  }

  const closePopoverBtn = document.getElementById("pinout-popover-close");
  if (closePopoverBtn && pinoutPopover) {
    closePopoverBtn.addEventListener("click", () => {
      pinoutPopover.classList.add("hidden");
      state.pinout.selectedPin = null;
    });
  }

  function checkPinoutTouchHit(x, y) {
    if (!state.showPinout || !Array.isArray(state.pinout.pins)) return null;
    for (const pin of state.pinout.pins) {
      const distLabel = Math.hypot(x - (pin.label_x || 0), y - (pin.label_y || 0));
      const distPin = Math.hypot(x - (pin.pin_x || 0), y - (pin.pin_y || 0));
      if (distLabel <= 34 || distPin <= 22) {
        showPinoutDetailPopover(pin);
        addTouchRipple(pin.label_x || x, pin.label_y || y, pin.color || "#00f3ff");
        return pin;
      }
    }
    return null;
  }

  function triggerDeskClick(x, y) {
    addTouchRipple(x, y, "#00ff9d");

    // 1. Kiểm tra chạm ngón tay vào chân linh kiện điện tử (Interactive PCB Pinout)
    if (checkPinoutTouchHit(x, y)) {
      return;
    }

    // 2. Nhấp vào hào quang để nhặt đồ nếu chạm trúng
    if (state.showAura && state.auraObjects.length > 0) {
      const hitIdx = state.auraObjects.findIndex((obj) => Math.hypot(x - obj.x, y - obj.y) <= obj.radius * 1.5);
      if (hitIdx >= 0) {
        state.auraObjects.splice(hitIdx, 1);
        return;
      }
    }

    // 3. Kích hoạt nút ảo trên mặt bàn (bao gồm nút "Bắt đầu In 3D" và thanh Dock)
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    const clickable = el.closest("button, .dock-btn, .win-ctrl-btn, .virtual-3d-print-cta");
    if (clickable) {
      clickable.click();
      clickable.classList.add("touch-activated");
      setTimeout(() => clickable.classList.remove("touch-activated"), 260);
    }
  }

  function syncModeBadge() {
    const modeBadge = document.getElementById("projector-mode-badge");
    if (modeBadge) {
      modeBadge.textContent =
        state.mode === "projector"
          ? `PROJECTOR DISPLAY MAPPED • ${state.ppm.toFixed(2)} PPM`
          : `SIMULATOR / TEST MODE (1 DISPLAY) • ${state.ppm.toFixed(2)} PPM`;
    }
  }
  syncModeBadge();

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // Đồng hồ Neon phát sáng thời gian thực
  function updateClock() {
    const now = new Date();
    const timeEl = document.getElementById("neon-clock-time");
    const dateEl = document.getElementById("neon-clock-date");
    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString("vi-VN", { hour12: false });
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString("vi-VN", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).toUpperCase();
    }
  }
  updateClock();
  const clockTimer = setInterval(updateClock, 1000);

  // =========================================================================
  // 1. INFINITE DESK EXTENSION & TOUCH / PINCH-TO-ZOOM WINDOWS
  // =========================================================================
  function createProjectedWindowElement(winCard) {
    if (!windowsLayer) return null;
    const card = document.createElement("div");
    card.className = "projected-window-card";
    card.id = winCard.id;
    card.style.left = `${winCard.x}px`;
    card.style.top = `${winCard.y}px`;
    card.style.width = `${winCard.width}px`;
    card.style.height = `${winCard.height}px`;
    card.style.transform = `scale(${winCard.scale || 1})`;

    card.innerHTML = `
      <div class="projected-window-header">
        <span class="projected-window-title">🪟 ${escapeHtml(winCard.title)}</span>
        <div class="projected-window-controls">
          <button class="win-ctrl-btn" data-action="zoom-out" title="Thu nhỏ (-)">−</button>
          <button class="win-ctrl-btn" data-action="zoom-in" title="Phóng to (+)">+</button>
          <button class="win-ctrl-btn" data-action="return-up" title="Đẩy ngược lên màn hình chính">⬆</button>
          <button class="win-ctrl-btn" data-action="close" title="Đóng cửa sổ chiếu">✕</button>
        </div>
      </div>
      <div class="projected-window-body">
        <div>
          <strong>Ứng dụng nguồn:</strong> ${escapeHtml(winCard.app || "Windows App")}<br/>
          <span>Cửa sổ đã được kéo trượt từ mép dưới màn hình chính xuống mặt bàn không gian.</span>
        </div>
        <div class="window-gesture-hint">
          ☝ <strong>Chạm ngón trỏ:</strong> Kéo di chuyển trên mặt bàn<br/>
          🤏 <strong>Pinch-to-Zoom (Ngón cái + Ngón trỏ):</strong> Tỷ lệ <span class="scale-label">${Math.round((winCard.scale || 1) * 100)}%</span>
        </div>
      </div>
    `;

    const header = card.querySelector(".projected-window-header");
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      isDragging = true;
      card.classList.add("window-touching");
      dragOffsetX = e.clientX - winCard.x;
      dragOffsetY = e.clientY - winCard.y;
      header.setPointerCapture(e.pointerId);
    });

    header.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      winCard.x = Math.max(16, Math.min(window.innerWidth - winCard.width - 16, e.clientX - dragOffsetX));
      winCard.y = Math.max(8, Math.min(window.innerHeight - 100, e.clientY - dragOffsetY));
      card.style.left = `${winCard.x}px`;
      card.style.top = `${winCard.y}px`;
      if (dropPortal) {
        dropPortal.classList.toggle("portal-active", winCard.y < 42);
      }
    });

    header.addEventListener("pointerup", () => {
      if (!isDragging) return;
      isDragging = false;
      card.classList.remove("window-touching");
      if (dropPortal) dropPortal.classList.remove("portal-active");
      if (winCard.y < 36) {
        removeProjectedWindow(winCard.id);
      }
    });

    card.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      updateWindowScale(winCard.id, (winCard.scale || 1) + delta);
    }, { passive: false });

    card.querySelectorAll(".win-ctrl-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-action");
        if (act === "zoom-in") updateWindowScale(winCard.id, (winCard.scale || 1) + 0.15);
        else if (act === "zoom-out") updateWindowScale(winCard.id, (winCard.scale || 1) - 0.15);
        else if (act === "return-up" || act === "close") removeProjectedWindow(winCard.id);
      });
    });

    windowsLayer.appendChild(card);
    return card;
  }

  function updateWindowScale(id, nextScale) {
    const winCard = state.projectedWindows.find((w) => w.id === id);
    if (!winCard) return;
    winCard.scale = Math.max(0.5, Math.min(2.4, Number(nextScale.toFixed(2))));
    const el = document.getElementById(id);
    if (el) {
      el.style.transform = `scale(${winCard.scale})`;
      const lbl = el.querySelector(".scale-label");
      if (lbl) lbl.textContent = `${Math.round(winCard.scale * 100)}%`;
    }
  }

  function removeProjectedWindow(id) {
    const idx = state.projectedWindows.findIndex((w) => w.id === id);
    if (idx >= 0) state.projectedWindows.splice(idx, 1);
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function dropWindowToDesk(rawCard = {}) {
    const card = {
      id: rawCard.id || `desk-win-${Date.now().toString(36)}`,
      title: rawCard.title || "Cửa sổ Không gian Iris",
      app: rawCard.app || "Desktop Window",
      x: typeof rawCard.x === "number" ? rawCard.x : Math.round(window.innerWidth * 0.12),
      y: typeof rawCard.y === "number" ? rawCard.y : 120,
      width: rawCard.width || 420,
      height: rawCard.height || 260,
      scale: rawCard.scale || 1.0,
    };
    state.projectedWindows.push(card);
    createProjectedWindowElement(card);
    if (dropPortal) {
      dropPortal.classList.add("portal-active");
      setTimeout(() => dropPortal.classList.remove("portal-active"), 650);
    }
    return card;
  }

  dropWindowToDesk({
    id: "desk-win-welcome",
    title: "Infinite Desk Extension — Cửa sổ Cảm ứng",
    app: "Iris Spatial Engine",
    x: 42,
    y: 128,
    width: 340,
    height: 210,
    scale: 1.0,
  });

  // =========================================================================
  // 2. TƯƠNG TÁC ĐO LAZE & CHẠM CHÂN MẠCH TRÊN MẶT BÀN
  // =========================================================================
  let isMeasuringDrag = false;
  let measureStart = null;

  if (canvas) {
    canvas.addEventListener("pointerdown", (e) => {
      addTouchRipple(e.clientX, e.clientY, "#00f3ff");

      // Kiểm tra chạm vào điểm neo Gizmo 3D (Kéo nắn kích thước trên bàn)
      if (state.show3dStl && state.cadAssembly.handles && state.cadAssembly.handles.length > 0) {
        for (const h of state.cadAssembly.handles) {
          if (Math.hypot(e.clientX - h.x, e.clientY - h.y) <= h.radius * 2.0) {
            state.cadAssembly.draggingGizmo = h.axis;
            state.cadAssembly.gizmoStartPt = { x: e.clientX, y: e.clientY };
            state.cadAssembly.startDimensions = { ...state.cadAssembly.dimensions_mm };
            addTouchRipple(h.x, h.y, h.color);
            return;
          }
        }
      }

      // Kiểm tra chạm vào mô hình CAD 3D để Di Chuyển hoặc Xoay tự do 360°
      if (state.show3dStl && state.cadAssembly.posX !== null) {
        const cx = state.cadAssembly.posX;
        const cy = state.cadAssembly.posY;
        const dist = Math.hypot(e.clientX - cx, e.clientY - (cy + 68));

        // 1. Chạm vào vành ngoài Orbit Ring (105px - 165px) -> Xoay mô hình 3D
        if (dist >= 105 && dist <= 165) {
          state.cadAssembly.isRotatingModel = true;
          state.cadAssembly.dragStartPt = { x: e.clientX, y: e.clientY };
          state.cadAssembly.startAngleY = state.cadAssembly.angleY;
          state.cadAssembly.startAngleX = state.cadAssembly.angleX;
          addTouchRipple(e.clientX, e.clientY, "#00ff9d");
          return;
        }

        // 2. Chạm vào thân khối 3D hoặc bệ xoay (< 105px) -> Di chuyển khối 3D trên bàn
        if (dist < 105) {
          state.cadAssembly.isDraggingModel = true;
          state.cadAssembly.dragStartPt = { x: e.clientX, y: e.clientY };
          state.cadAssembly.startPos = { x: cx, y: cy };
          addTouchRipple(e.clientX, e.clientY, "#00f3ff");
          return;
        }
      }

      // Kiểm tra chạm vào chân mạch điện tử để bật hộp thoại chi tiết
      if (checkPinoutTouchHit(e.clientX, e.clientY)) {
        return;
      }

      // Nhấc đồ vật lên / chạm vào hào quang -> Hào quang tan biến
      if (state.showAura && state.auraObjects.length > 0) {
        const hitIdx = state.auraObjects.findIndex((obj) => Math.hypot(e.clientX - obj.x, e.clientY - obj.y) <= obj.radius * 1.4);
        if (hitIdx >= 0) {
          state.auraObjects.splice(hitIdx, 1);
          return;
        }
      }

      if (state.activeTool !== "laser-caliper") return;
      isMeasuringDrag = true;
      measureStart = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener("pointermove", (e) => {
      // Xử lý kéo nắn điểm neo kích thước 3D trên bàn
      if (state.cadAssembly.draggingGizmo) {
        const dx = e.clientX - state.cadAssembly.gizmoStartPt.x;
        const dy = e.clientY - state.cadAssembly.gizmoStartPt.y;
        const axis = state.cadAssembly.draggingGizmo;
        const deltaMm = (axis === "height" ? -dy : dx) / 3.0;
        const cur = state.cadAssembly.startDimensions;
        if (axis === "length") {
          state.cadAssembly.dimensions_mm.length = Math.max(15, Math.min(250, Math.round(cur.length + deltaMm)));
        } else if (axis === "width") {
          state.cadAssembly.dimensions_mm.width = Math.max(15, Math.min(250, Math.round(cur.width + deltaMm)));
        } else if (axis === "height") {
          state.cadAssembly.dimensions_mm.height = Math.max(10, Math.min(180, Math.round(cur.height + deltaMm)));
        }
        buildDefaultCadComponents();
        syncCadDimensionsDom();
        return;
      }

      // Xử lý xoay mô hình 3D tự do 360°
      if (state.cadAssembly.isRotatingModel) {
        const dx = e.clientX - state.cadAssembly.dragStartPt.x;
        const dy = e.clientY - state.cadAssembly.dragStartPt.y;
        state.cadAssembly.angleY = state.cadAssembly.startAngleY + dx * 0.015;
        state.cadAssembly.angleX = Math.max(0.08, Math.min(1.45, state.cadAssembly.startAngleX + dy * 0.012));
        return;
      }

      // Xử lý di chuyển khối 3D khắp mặt bàn
      if (state.cadAssembly.isDraggingModel) {
        const dx = e.clientX - state.cadAssembly.dragStartPt.x;
        const dy = e.clientY - state.cadAssembly.dragStartPt.y;
        state.cadAssembly.posX = Math.max(120, Math.min(window.innerWidth - 120, state.cadAssembly.startPos.x + dx));
        state.cadAssembly.posY = Math.max(100, Math.min(window.innerHeight - 100, state.cadAssembly.startPos.y + dy));
        return;
      }

      if (!isMeasuringDrag || !measureStart) return;
      const bx = Math.min(measureStart.x, e.clientX);
      const by = Math.min(measureStart.y, e.clientY);
      const bw = Math.max(20, Math.abs(e.clientX - measureStart.x));
      const bh = Math.max(20, Math.abs(e.clientY - measureStart.y));
      state.caliper.bbox = [bx, by, bw, bh];
      state.caliper.length_mm = Number((Math.max(bw, bh) / state.ppm).toFixed(1));
      state.caliper.width_mm = Number((Math.min(bw, bh) / state.ppm).toFixed(1));
      syncCaliperDom();
    });

    canvas.addEventListener("pointerup", () => {
      if (state.cadAssembly.draggingGizmo) {
        state.cadAssembly.draggingGizmo = null;
        return;
      }
      if (state.cadAssembly.isRotatingModel || state.cadAssembly.isDraggingModel) {
        state.cadAssembly.isRotatingModel = false;
        state.cadAssembly.isDraggingModel = false;
        return;
      }
      isMeasuringDrag = false;
      measureStart = null;
    });

    // Cuộn chuột / Zoom phóng to thu nhỏ mô hình CAD 3D trên bàn
    canvas.addEventListener("wheel", (e) => {
      if (state.show3dStl && state.cadAssembly.posX !== null) {
        const dist = Math.hypot(e.clientX - state.cadAssembly.posX, e.clientY - state.cadAssembly.posY);
        if (dist <= 180) {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 0.15 : -0.15;
          state.cadAssembly.scale = Math.max(0.8, Math.min(4.8, Number(((state.cadAssembly.scale || 2.2) + delta).toFixed(2))));
        }
      }
    }, { passive: false });
  }

  function syncCaliperDom() {
    const dimEl = document.getElementById("caliper-dimensions");
    const subEl = document.getElementById("caliper-sub");
    if (dimEl) {
      dimEl.textContent = `${state.caliper.length_mm.toFixed(1)} × ${state.caliper.width_mm.toFixed(1)} mm`;
    }
    if (subEl) {
      subEl.textContent = `PPM: ${state.ppm.toFixed(2)} px/mm • Sai số ±0.5mm`;
    }
  }

  // =========================================================================
  // 3. VÒNG LẶP VẼ ĐỒ HOẠ KHÔNG GIAN 60FPS
  // =========================================================================
  function drawLaserRulerAxis(x1, y1, x2, y2, mmValue, isHorizontal) {
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = "#00ff9d";
    ctx.fillStyle = "#00ff9d";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#00ff9d";
    ctx.shadowBlur = 12;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const distPx = Math.hypot(x2 - x1, y2 - y1);
    const totalMm = distPx / state.ppm;
    const ux = (x2 - x1) / (distPx || 1);
    const uy = (y2 - y1) / (distPx || 1);
    const nx = -uy;
    const ny = ux;

    for (let mm = 0; mm <= totalMm; mm += 5) {
      const offset = mm * state.ppm;
      const tx = x1 + ux * offset;
      const ty = y1 + uy * offset;
      const tickLen = mm % 10 === 0 ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(tx - nx * tickLen, ty - ny * tickLen);
      ctx.lineTo(tx + nx * tickLen, ty + ny * tickLen);
      ctx.stroke();
    }

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    ctx.font = "bold 13px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    if (isHorizontal) {
      ctx.fillText(`${mmValue.toFixed(1)} mm`, midX, midY - 12);
    } else {
      ctx.save();
      ctx.translate(midX - 16, midY);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`${mmValue.toFixed(1)} mm`, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function renderLaserCaliper() {
    if (!ctx || !state.showLaserCaliper) return;
    const [bx, by, bw, bh] = state.caliper.bbox;
    ctx.save();

    ctx.strokeStyle = "rgba(0, 255, 157, 0.85)";
    ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.setLineDash([]);

    const cornerLen = 14;
    ctx.strokeStyle = "#00f3ff";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "#00f3ff";
    ctx.shadowBlur = 10;
    const corners = [
      [bx, by, 1, 1],
      [bx + bw, by, -1, 1],
      [bx + bw, by + bh, -1, -1],
      [bx, by + bh, 1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + sy * cornerLen);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + sx * cornerLen, cy);
      ctx.stroke();
    }

    const horizMm = Number((bw / state.ppm).toFixed(1));
    const vertMm = Number((bh / state.ppm).toFixed(1));
    drawLaserRulerAxis(bx, by - 22, bx + bw, by - 22, horizMm, true);
    drawLaserRulerAxis(bx - 22, by, bx - 22, by + bh, vertMm, false);

    ctx.fillStyle = "rgba(0, 243, 255, 0.92)";
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      `${state.caliper.label} (${state.caliper.length_mm.toFixed(1)} × ${state.caliper.width_mm.toFixed(1)} mm)`,
      bx + bw / 2,
      by + bh + 22,
    );
    ctx.restore();
  }

  // TÍNH NĂNG 2: CHIẾU SƠ ĐỒ CHÂN LINH KIỆN ĐIỆN TỬ (INTERACTIVE PCB PINOUT OVERLAY)
  function renderPcbPinoutOverlay(now) {
    if (!ctx || !state.showPinout) return;
    const pose = state.pinout.pose;
    const cx = Number(pose.center_x) || 560;
    const cy = Number(pose.center_y) || 430;
    const bw = Number(pose.width_px) || 136;
    const bh = Number(pose.height_px) || 248;
    const angleRad = ((Number(pose.angle_deg) || 0) * Math.PI) / 180;

    ctx.save();
    // Vẽ khung bo mạch vật lý theo góc xoay
    ctx.translate(cx, cy);
    ctx.rotate(angleRad);
    ctx.strokeStyle = "#00ff9d";
    ctx.lineWidth = 2.2;
    ctx.shadowColor = "#00ff9d";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "rgba(0, 28, 36, 0.42)";
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);

    // Vẽ lưng chip trung tâm trên bo mạch
    const chipW = bw * 0.56;
    const chipH = bh * 0.36;
    ctx.strokeStyle = "#00f3ff";
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-chipW / 2, -chipH / 2, chipW, chipH);

    ctx.fillStyle = "#e8fcff";
    ctx.font = "bold 11px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(state.pinout.chip_marking || "ESP32-WROOM", 0, -4);
    ctx.fillStyle = "#00ff9d";
    ctx.font = "10px 'Segoe UI', sans-serif";
    ctx.fillText(`${state.pinout.operating_voltage || "3.3V"} • ${pose.angle_deg || 0}°`, 0, 12);
    ctx.restore();

    // Vẽ các tia laze neon chỉ thẳng góc từ chân chip thật ra mặt bàn gỗ
    ctx.save();
    const pulse = (Math.sin(now * 0.005) + 1) * 0.5;
    for (const pin of state.pinout.pins) {
      const isSelected = state.pinout.selectedPin && state.pinout.selectedPin.pin_number === pin.pin_number;
      const color = pin.color || "#00f3ff";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = isSelected ? 3.2 : 1.9;
      ctx.shadowColor = color;
      ctx.shadowBlur = isSelected ? 18 : 9;

      // Điểm hàn chân chip thật
      ctx.beginPath();
      ctx.arc(pin.pin_x, pin.pin_y, isSelected ? 5.5 : 3.6, 0, Math.PI * 2);
      ctx.fill();

      // Tia laze chiếu thẳng góc ra mặt bàn
      ctx.beginPath();
      ctx.moveTo(pin.pin_x, pin.pin_y);
      ctx.lineTo(pin.label_x, pin.label_y);
      ctx.stroke();

      // Vòng tròn điểm chạm cảm ứng tại đầu nhãn
      ctx.beginPath();
      ctx.arc(pin.label_x, pin.label_y, isSelected ? 7 + pulse * 3 : 4.5, 0, Math.PI * 2);
      ctx.stroke();

      const isLeft = pin.side === "left";
      ctx.textAlign = isLeft ? "right" : "left";
      const textX = pin.label_x + (isLeft ? -10 : 10);
      ctx.font = isSelected ? "bold 12px 'Segoe UI', sans-serif" : "bold 11px 'Segoe UI', sans-serif";
      ctx.fillStyle = color;
      ctx.fillText(`${pin.name} ${pin.category_tag || ""}`, textX, pin.label_y + 4);
    }

    // Tiêu đề bo mạch & chú giải màu sắc dưới bo mạch
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8fcff";
    ctx.font = "bold 13px 'Segoe UI', sans-serif";
    ctx.fillText(
      `🔌 AR PINOUT: ${state.pinout.board_name} (Chạm ngón tay vào chân mạch để xem Điện áp / I2C / SPI)`,
      cx,
      cy + bh / 2 + 34,
    );
    ctx.restore();
  }

  function renderXrayInspector(now) {
    if (!ctx || !state.showXray) return;
    const [bx, by, bw, bh] = state.caliper.bbox;
    const cx = bx + bw / 2;
    const cy = by + bh / 2;

    ctx.save();
    state.xrayScanPhase = (now * 0.0012) % 1;
    const scanY = by + state.xrayScanPhase * bh;
    const grad = ctx.createLinearGradient(bx, scanY - 12, bx, scanY + 12);
    grad.addColorStop(0, "rgba(0, 243, 255, 0)");
    grad.addColorStop(0.5, "rgba(0, 243, 255, 0.75)");
    grad.addColorStop(1, "rgba(0, 243, 255, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(bx, scanY - 12, bw, 24);

    for (const item of state.xrayCallouts) {
      const targetX = cx + item.dx * 0.35;
      const targetY = cy + item.dy * 0.35;
      const labelX = cx + item.dx;
      const labelY = cy + item.dy;

      ctx.strokeStyle = "#00f3ff";
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "#00f3ff";
      ctx.shadowBlur = 8;

      ctx.beginPath();
      ctx.arc(targetX, targetY, 3.5, 0, Math.PI * 2);
      ctx.moveTo(targetX, targetY);
      ctx.lineTo(labelX, labelY);
      ctx.lineTo(labelX + (item.dx >= 0 ? 110 : -110), labelY);
      ctx.stroke();

      const alignRight = item.dx < 0;
      ctx.textAlign = alignRight ? "right" : "left";
      const textX = labelX + (alignRight ? -6 : 6);
      ctx.fillStyle = "#00ff9d";
      ctx.font = "bold 12px 'Segoe UI', sans-serif";
      ctx.fillText(item.title, textX, labelY - 5);
      ctx.fillStyle = "#bfefff";
      ctx.font = "11px 'Segoe UI', sans-serif";
      ctx.fillText(item.sub, textX, labelY + 13);
    }
    ctx.restore();
  }

  function renderAuraLocator(now) {
    if (!ctx || !state.showAura) return;
    const pulse = (Math.sin(now * 0.0045) + 1) * 0.5;

    ctx.save();
    for (const obj of state.auraObjects) {
      const rOuter = obj.radius + pulse * 14;
      ctx.strokeStyle = obj.color || "#00ff9d";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = obj.color || "#00ff9d";
      ctx.shadowBlur = 18;

      ctx.beginPath();
      ctx.arc(obj.x, obj.y, rOuter, 0, Math.PI * 2);
      ctx.stroke();

      ctx.save();
      ctx.translate(obj.x, obj.y);
      ctx.rotate(now * 0.0015);
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, obj.radius * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = obj.color || "#00ff9d";
      ctx.font = "bold 13px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(obj.label, obj.x, obj.y + obj.radius + 26);
    }
    ctx.restore();
  }

  // TÍNH NĂNG 3: VÒNG TRÒN TIẾN ĐỘ IN 3D (%) PHÁT SÁNG XOAY QUANH MÔ HÌNH 3D
  function render3dPrinterProgressRing(now, centerX, centerY) {
    if (!ctx || !state.printerJob.active) return;
    const elapsedSec = Math.max(0, (now - (state.printerJob.startedAt || now)) / 1000);
    const basePct = Number(state.printerJob.progress_percent) || 15;
    const animatedPct = Math.min(100, Number((basePct + elapsedSec * 1.4).toFixed(1)));
    const progressRad = (animatedPct / 100) * Math.PI * 2;
    const ringRadius = 136;

    ctx.save();
    // Vòng quỹ đạo xoay nét đứt quanh mô hình 3D
    ctx.translate(centerX, centerY + 12);
    ctx.save();
    ctx.rotate(now * 0.0018);
    ctx.strokeStyle = "rgba(0, 255, 157, 0.38)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.arc(0, 0, ringRadius + 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Cung tròn tiến độ in (%) phát sáng
    ctx.strokeStyle = "#00ff9d";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.shadowColor = "#00ff9d";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(0, 0, ringRadius, -Math.PI / 2, -Math.PI / 2 + progressRad);
    ctx.stroke();

    // Nhãn thông số máy in Bambu Lab / OctoPrint & phần trăm tiến độ
    ctx.fillStyle = "#00ff9d";
    ctx.font = "bold 16px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      `🖨 ĐANG IN 3D: ${animatedPct.toFixed(0)}% (${state.printerJob.printer_name})`,
      0,
      -ringRadius - 24,
    );
    ctx.fillStyle = "#e8fcff";
    ctx.font = "bold 11.5px 'Segoe UI', sans-serif";
    const curLayer = Math.max(1, Math.round((animatedPct / 100) * (state.printerJob.layer_count || 114)));
    ctx.fillText(
      `Lớp ${curLayer}/${state.printerJob.layer_count} • Nozzle ${state.printerJob.nozzle_temp_c}°C • Bed ${state.printerJob.bed_temp_c}°C • Còn ~${state.printerJob.estimated_time_min} phút`,
      0,
      ringRadius + 42,
    );
    ctx.restore();
  }

  function render3dStlTurntable(now) {
    if (!ctx || !state.show3dStl) return;
    if (state.cadAssembly.posX === null) {
      state.cadAssembly.posX = Math.round(window.innerWidth * 0.74);
      state.cadAssembly.posY = Math.round(window.innerHeight * 0.54);
    }
    const centerX = state.cadAssembly.posX;
    const centerY = state.cadAssembly.posY;

    if (state.cadAssembly.autoRotate && !state.cadAssembly.isDraggingModel && !state.cadAssembly.isRotatingModel) {
      state.cadAssembly.angleY += 0.009;
    }
    const angleY = state.cadAssembly.angleY;
    const angleX = state.cadAssembly.angleX;

    ctx.save();
    // 1. Vòng bệ xoay (Turntable Base)
    ctx.strokeStyle = "rgba(0, 243, 255, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "#00f3ff";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY + 68, 118, 38, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Vòng quỹ đạo xoay tự do (Orbit Ring)
    ctx.strokeStyle = "rgba(0, 255, 157, 0.35)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.ellipse(centerX, centerY + 68, 142, 46, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const scale3d = state.cadAssembly.scale || 2.2;
    const cosY = Math.cos(angleY);
    const sinY = Math.sin(angleY);
    const cosX = Math.cos(angleX);
    const sinX = Math.sin(angleX);

    function projectPt(vx, vy, vz) {
      const x1 = vx * cosY - vy * sinY;
      const y1 = vx * sinY + vy * cosY;
      const z1 = vz;
      const y2 = y1 * cosX - z1 * sinX;
      const z2 = y1 * sinX + z1 * cosX;
      const perspective = 320 / (320 + y2 * 0.4);
      return {
        x: centerX + x1 * scale3d * perspective,
        y: centerY - z2 * scale3d * perspective,
      };
    }

    const dims = state.cadAssembly.dimensions_mm || state.stlModel?.outer_dimensions_mm || { length: 58.0, width: 34.0, height: 24.0 };
    const comps = state.cadAssembly.components && state.cadAssembly.components.length > 0
      ? state.cadAssembly.components
      : [{ id: "part-body", name: "3D Model", color: "#00f3ff", vertices: state.stlModel?.vertices || [], edges: state.stlModel?.edges || [] }];

    // Render từng chi tiết trong cụm lắp ráp CAD 3D (Thân + Nắp trượt)
    comps.forEach((comp) => {
      const compVerts = comp.vertices || [];
      const compEdges = comp.edges || [];
      const projected = compVerts.map(([vx, vy, vz]) => projectPt(vx, vy, vz));

      ctx.strokeStyle = comp.color || "#00f3ff";
      ctx.lineWidth = 2;
      ctx.shadowColor = comp.color || "#00f3ff";
      ctx.shadowBlur = 10;

      for (let i = 0; i < compEdges.length; i++) {
        const [a, b] = compEdges[i];
        const pa = projected[a];
        const pb = projected[b];
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
    });

    // Vẽ đường tia Neon đứt quãng nối giữa Nắp và Thân khi ở chế độ Tách Chi Tiết (Exploded View)
    if (state.cadAssembly.is_exploded) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(0, 255, 157, 0.65)";
      ctx.lineWidth = 1.2;
      const l2 = dims.length / 2;
      const w2 = dims.width / 2;
      const h2 = dims.height / 2;
      const corners = [[-l2, -w2], [l2, -w2], [l2, w2], [-l2, w2]];
      corners.forEach(([cx, cy]) => {
        const botPt = projectPt(cx, cy, h2 - 5);
        const topPt = projectPt(cx, cy, h2 + state.cadAssembly.explode_distance_mm);
        ctx.beginPath();
        ctx.moveTo(botPt.x, botPt.y);
        ctx.lineTo(topPt.x, topPt.y);
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }

    // 3. Render các Điểm Neo Điều Khiển Kích Thước (Spatial 3D Gizmo Handles)
    const l2 = dims.length / 2;
    const w2 = dims.width / 2;
    const h2 = dims.height / 2;
    const zApex = h2 + (state.cadAssembly.is_exploded ? state.cadAssembly.explode_distance_mm : 0);

    const hLen = projectPt(l2 + 4, 0, 0);
    const hWid = projectPt(0, w2 + 4, 0);
    const hHei = projectPt(0, 0, zApex + 6);

    state.cadAssembly.handles = [
      { axis: "length", x: hLen.x, y: hLen.y, radius: 10, label: `Dài ${Math.round(dims.length)}mm`, color: "#00f3ff" },
      { axis: "width", x: hWid.x, y: hWid.y, radius: 10, label: `Rộng ${Math.round(dims.width)}mm`, color: "#ffb800" },
      { axis: "height", x: hHei.x, y: hHei.y, radius: 10, label: `Cao ${Math.round(dims.height)}mm`, color: "#c44dff" },
    ];

    state.cadAssembly.handles.forEach((h) => {
      ctx.fillStyle = h.color;
      ctx.shadowColor = h.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 10.5px 'Segoe UI', monospace";
      ctx.fillText(h.label, h.x + 12, h.y + 4);
    });

    ctx.fillStyle = state.cadAssembly.is_exploded ? "#00ff9d" : "#e8fcff";
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      state.cadAssembly.is_exploded
        ? `💥 EXPLODED VIEW: 2 CHI TIẾT (+${Math.round(state.cadAssembly.explode_distance_mm)}mm) • ${Math.round(dims.length)}×${Math.round(dims.width)}×${Math.round(dims.height)}mm`
        : `3D CAD 360° PREVIEW: ${Math.round(dims.length)} × ${Math.round(dims.width)} × ${Math.round(dims.height)} mm`,
      centerX,
      centerY + 118,
    );
    ctx.font = "10.5px 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(180, 240, 255, 0.78)";
    ctx.fillText(
      "✋ Kéo thân để di chuyển • Vuốt vành ngoài để xoay 360° • Kéo điểm neo để đổi cỡ",
      centerX,
      centerY + 136,
    );
    ctx.restore();

    render3dPrinterProgressRing(now, centerX, centerY);
  }

  // TÍNH NĂNG 4: CHIẾU MÔ HÌNH KHUNG DÂY 3D ĐA GÓC (MULTI-VIEW 3D RECONSTRUCTION) BÊN CẠNH VẬT THỂ THẬT
  function renderPhotogrammetryTurntable(now) {
    if (!ctx || !state.showPhotogrammetry) return;
    const [bx, by, bw, bh] = state.caliper.bbox;
    const objCx = bx + bw / 2;
    const objCy = by + bh / 2;

    // 1. Vẽ vòng radar hướng dẫn chụp 8-16 góc quanh vật thể thật
    ctx.save();
    const angles = state.photogrammetry.capture_angles_deg || [];
    const radarR = Math.max(bw, bh) * 0.72 + 28;
    ctx.strokeStyle = "rgba(196, 77, 255, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(objCx, objCy, radarR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    angles.forEach((deg, idx) => {
      const rad = (deg * Math.PI) / 180;
      const vx = objCx + Math.cos(rad) * radarR;
      const vy = objCy + Math.sin(rad) * radarR;
      ctx.fillStyle = "#00ff9d";
      ctx.beginPath();
      ctx.arc(vx, vy, 4, 0, Math.PI * 2);
      ctx.fill();
      if (idx % 2 === 0) {
        ctx.font = "10px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(deg)}°`, vx + Math.cos(rad) * 14, vy + Math.sin(rad) * 14);
      }
    });

    // 2. Chiếu mô hình khung dây 3D xoay 360° ngay bên cạnh vật thể thật
    const holoX = Math.min(window.innerWidth - 280, objCx + radarR + 145);
    const holoY = objCy;
    const angleY = now * 0.0014;
    const angleX = 0.42;
    const cosY = Math.cos(angleY);
    const sinY = Math.sin(angleY);
    const cosX = Math.cos(angleX);
    const sinX = Math.sin(angleX);

    const verts = state.photogrammetry.vertices || [];
    const edges = state.photogrammetry.edges || [];
    const scale = 2.0;

    const proj = verts.map(([vx, vy, vz]) => {
      const x1 = vx * cosY - vy * sinY;
      const y1 = vx * sinY + vy * cosY;
      const y2 = y1 * cosX - vz * sinX;
      const z2 = y1 * sinX + vz * cosX;
      return {
        x: holoX + x1 * scale,
        y: holoY - z2 * scale,
      };
    });

    ctx.strokeStyle = "#c44dff";
    ctx.lineWidth = 1.4;
    ctx.shadowColor = "#c44dff";
    ctx.shadowBlur = 10;
    for (const [a, b] of edges) {
      const pa = proj[a];
      const pb = proj[b];
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    ctx.fillStyle = "#00ff9d";
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      `📸 MULTI-VIEW 3D MESH (${state.photogrammetry.views_captured} GÓC • ${state.photogrammetry.facet_count} FACETS)`,
      holoX,
      holoY + 95,
    );
    ctx.fillStyle = "#e8fcff";
    ctx.font = "11px 'Segoe UI', sans-serif";
    ctx.fillText(
      `${state.photogrammetry.stl_path} + .OBJ (Watertight)`,
      holoX,
      holoY + 112,
    );
    ctx.restore();
  }

  // TÍNH NĂNG 1: MẪU BÀN CỜ ARUCO TƯƠNG PHẢN CAO (1.5 GIÂY) & VÒNG HÀO QUANG XANH BÁO HIỆU THÀNH CÔNG
  function drawSimulatedArucoMarker(x, y, size, seedId) {
    if (!ctx) return;
    ctx.fillStyle = "#000000";
    ctx.fillRect(x, y, size, size);
    const cell = size / 6;
    for (let r = 1; r < 5; r++) {
      for (let c = 1; c < 5; c++) {
        const bit = ((r * 3 + c * 5 + seedId * 7) % 2) === 0;
        if (bit) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
        }
      }
    }
    ctx.strokeStyle = "#00ff9d";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 4, y - 4, size + 8, size + 8);
  }

  function renderAutoCalibrationOverlay(now) {
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    // Giai đoạn 1: Nháy mẫu bàn cờ ArUco + ChArUco tương phản cao trong 1.5 giây
    if (state.autoCalib.flashingPattern) {
      const elapsed = now - state.autoCalib.flashStartedAt;
      if (elapsed >= state.autoCalib.flashDurationMs) {
        state.autoCalib.flashingPattern = false;
        state.autoCalib.successHaloActive = true;
        state.autoCalib.haloStartedAt = now;
      } else {
        ctx.save();
        ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
        const marginX = Math.round(w * 0.06);
        const marginY = Math.round(h * 0.06);
        ctx.fillRect(marginX, marginY, w - marginX * 2, h - marginY * 2);

        // 4 mã ArUco ở 4 góc
        const markerSz = 110;
        const corners = [
          [Math.round(w * 0.08), Math.round(h * 0.08), 0],
          [Math.round(w * 0.92) - markerSz, Math.round(h * 0.08), 1],
          [Math.round(w * 0.92) - markerSz, Math.round(h * 0.92) - markerSz, 2],
          [Math.round(w * 0.08), Math.round(h * 0.92) - markerSz, 3],
        ];
        for (const [mx, my, id] of corners) {
          drawSimulatedArucoMarker(mx, my, markerSz, id);
        }

        // Lưới bàn cờ 8x6 ở chính giữa
        const cols = 8;
        const rows = 6;
        const cellPx = Math.round(Math.min(w, h) * 0.07);
        const bx0 = Math.round((w - cols * cellPx) / 2);
        const by0 = Math.round((h - rows * cellPx) / 2);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? "#000000" : "#ffffff";
            ctx.fillRect(bx0 + c * cellPx, by0 + r * cellPx, cellPx, cellPx);
          }
        }
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 3;
        ctx.strokeRect(bx0, by0, cols * cellPx, rows * cellPx);

        ctx.fillStyle = "#000000";
        ctx.font = "bold 18px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          "🎯 AUTO PROCAM CALIBRATION — ĐANG CHỤP & GIẢI MÃ MA TRẬN HOMOGRAPHY 3x3...",
          w / 2,
          by0 - 24,
        );
        ctx.restore();
        return;
      }
    }

    // Giai đoạn 2: Mẫu bàn cờ biến mất -> Chiếu vòng hào quang neon xanh báo hiệu "Hiệu chuẩn thành công!"
    if (state.autoCalib.successHaloActive) {
      const elapsed = now - state.autoCalib.haloStartedAt;
      if (elapsed >= state.autoCalib.haloDurationMs) {
        state.autoCalib.successHaloActive = false;
      } else {
        const progress = elapsed / state.autoCalib.haloDurationMs;
        const alpha = Math.max(0, 1 - progress * 0.85);
        const radius = 90 + progress * 180;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "#00ff9d";
        ctx.fillStyle = "#00ff9d";
        ctx.lineWidth = 5;
        ctx.shadowColor = "#00ff9d";
        ctx.shadowBlur = 32;

        ctx.beginPath();
        ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(w / 2, h / 2, radius * 0.68, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = "bold 22px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("✓ HIỆU CHUẨN THÀNH CÔNG!", w / 2, h / 2 - 8);
        ctx.font = "bold 14px 'Segoe UI', sans-serif";
        ctx.fillStyle = "#e8fcff";
        ctx.fillText(
          `Homography 3x3 Locked • ${state.ppm.toFixed(2)} PPM • Đã lưu procam_config.json`,
          w / 2,
          h / 2 + 22,
        );
        ctx.restore();
      }
    }

    if (!state.showCalibrationGrid) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 184, 0, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 8]);

    const marginX = Math.round(w * 0.08);
    const marginY = Math.round(h * 0.08);
    ctx.strokeRect(marginX, marginY, w - marginX * 2, h - marginY * 2);

    const calibCorners = [
      { x: marginX, y: marginY, label: "ArUco #0 (0.08, 0.08)" },
      { x: w - marginX, y: marginY, label: "ArUco #1 (0.92, 0.08)" },
      { x: w - marginX, y: h - marginY, label: "ArUco #2 (0.92, 0.92)" },
      { x: marginX, y: h - marginY, label: "ArUco #3 (0.08, 0.92)" },
    ];
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffb800";
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    for (const pt of calibCorners) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(pt.label, pt.x + 14, pt.y + 4);
    }
    ctx.restore();
  }

  function renderHandTrackingOverlay(now) {
    if (!ctx || !state.hand.active || now - state.hand.lastSeenAt > 2500) return;
    const { thumbTip, indexTip, center, pinchDistancePx, isTouching } = state.hand;
    if (!thumbTip || !indexTip) return;

    ctx.save();
    ctx.strokeStyle = isTouching ? "#00ff9d" : "#00f3ff";
    ctx.fillStyle = isTouching ? "#00ff9d" : "#00f3ff";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 14;

    ctx.beginPath();
    ctx.moveTo(thumbTip.x, thumbTip.y);
    ctx.lineTo(indexTip.x, indexTip.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(thumbTip.x, thumbTip.y, 7, 0, Math.PI * 2);
    ctx.arc(indexTip.x, indexTip.y, 7, 0, Math.PI * 2);
    ctx.fill();

    if (center) {
      ctx.font = "bold 11px 'Segoe UI', sans-serif";
      ctx.fillText(
        isTouching ? "TOUCH / DRAG" : `PINCH: ${Math.round(pinchDistancePx)}px`,
        center.x + 12,
        center.y - 10,
      );
    }
    ctx.restore();
  }

  function renderTouchRipples() {
    if (!ctx || !state.touchRipples || state.touchRipples.length === 0) return;
    ctx.save();
    for (let i = state.touchRipples.length - 1; i >= 0; i--) {
      const r = state.touchRipples[i];
      r.radius += 2.2;
      r.alpha -= 0.045;
      if (r.alpha <= 0 || r.radius >= r.maxRadius) {
        state.touchRipples.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = r.color || "#00ff9d";
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = Math.max(0, r.alpha);
      ctx.shadowColor = r.color || "#00ff9d";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  let rafId = 0;
  function renderLoop(now) {
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderLaserCaliper();
      renderPcbPinoutOverlay(now);
      renderXrayInspector(now);
      renderAuraLocator(now);
      render3dStlTurntable(now);
      renderPhotogrammetryTurntable(now);
      renderTouchRipples();
      renderHandTrackingOverlay(now);
      renderAutoCalibrationOverlay(now);
    }
    rafId = requestAnimationFrame(renderLoop);
  }
  rafId = requestAnimationFrame(renderLoop);

  // =========================================================================
  // 4. THANH DOCK CÔNG CỤ KHÔNG GIAN & NÚT BẮT ĐẦU IN 3D
  // =========================================================================
  function startSimulatedOrLive3dPrint(jobData = {}) {
    state.show3dStl = true;
    state.printerJob = {
      ...state.printerJob,
      ...jobData,
      active: true,
      state: "printing",
      progress_percent: typeof jobData.progress_percent === "number" ? jobData.progress_percent : 15,
      startedAt: performance.now(),
    };
    const dockPrintBtn = document.getElementById("btn-send-3d-printer");
    if (dockPrintBtn) dockPrintBtn.classList.add("active");
    const ctaBtn = document.getElementById("btn-floating-start-print");
    if (ctaBtn) {
      ctaBtn.textContent = `🖨 ĐANG IN (${state.printerJob.printer_name})...`;
    }
  }

  const floatingPrintBtn = document.getElementById("btn-floating-start-print");
  if (floatingPrintBtn) {
    floatingPrintBtn.addEventListener("click", () => {
      startSimulatedOrLive3dPrint();
    });
  }

  document.querySelectorAll(".dock-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tool = btn.getAttribute("data-tool");
      if (tool === "close-desk") {
        window.close();
        return;
      }
      if (tool === "drop-window") {
        dropWindowToDesk({
          title: `Cửa sổ Không gian #${state.projectedWindows.length + 1}`,
          app: "Infinite Desk Extension",
          x: 80 + (state.projectedWindows.length * 36) % 300,
          y: 140 + (state.projectedWindows.length * 28) % 180,
          width: 360,
          height: 220,
        });
        return;
      }
      if (tool === "laser-caliper") {
        state.activeTool = "laser-caliper";
        state.showLaserCaliper = !state.showLaserCaliper;
        btn.classList.toggle("active", state.showLaserCaliper);
      } else if (tool === "pcb-pinout") {
        state.showPinout = !state.showPinout;
        btn.classList.toggle("active", state.showPinout);
        if (!state.showPinout && pinoutPopover) {
          pinoutPopover.classList.add("hidden");
        }
      } else if (tool === "xray-scan") {
        state.showXray = !state.showXray;
        btn.classList.toggle("active", state.showXray);
      } else if (tool === "aura-locator") {
        state.showAura = !state.showAura;
        btn.classList.toggle("active", state.showAura);
      } else if (tool === "stl-generator") {
        state.show3dStl = !state.show3dStl;
        btn.classList.toggle("active", state.show3dStl);
      } else if (tool === "scan-3d-mesh") {
        state.showPhotogrammetry = !state.showPhotogrammetry;
        btn.classList.toggle("active", state.showPhotogrammetry);
      } else if (tool === "open-cad-file") {
        state.show3dStl = true;
        const stlBtn = document.getElementById("btn-stl-generator");
        if (stlBtn) stlBtn.classList.add("active");
        window.spatialDeskHud.openCadFilePicker();
      } else if (tool === "explode-assembly") {
        state.cadAssembly.is_exploded = !state.cadAssembly.is_exploded;
        btn.classList.toggle("active", state.cadAssembly.is_exploded);
        buildDefaultCadComponents();
        const subEl = document.getElementById("cad-editor-sub");
        if (subEl) {
          subEl.textContent = state.cadAssembly.is_exploded
            ? "💥 Đã tách nắp hộp & thân hộp rời rạc (Exploded View)"
            : "Đã lắp ráp nắp vào thân hộp hoàn chỉnh";
        }
      } else if (tool === "send-3d-printer") {
        startSimulatedOrLive3dPrint();
      } else if (tool === "procam-calib") {
        window.spatialDeskHud.triggerAutoCalibration();
      }
    });
  });

  // Nút chỉnh sửa kích thước thủ công trên bàn
  document.querySelectorAll(".dim-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const axis = btn.getAttribute("data-axis");
      const delta = parseFloat(btn.getAttribute("data-delta") || "0");
      if (axis && delta && state.cadAssembly.dimensions_mm) {
        state.cadAssembly.dimensions_mm[axis] = Math.max(10, Math.min(300, Math.round(state.cadAssembly.dimensions_mm[axis] + delta)));
        syncCadDimensionsDom();
        buildDefaultCadComponents();
      }
    });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      window.close();
    }
  });

  window.addEventListener("beforeunload", () => {
    if (rafId) cancelAnimationFrame(rafId);
    clearInterval(clockTimer);
  });

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // =========================================================================
  // 5. BRIDGE API CHO MAIN PROCESS (desk-window.mjs) GỌI TRỰC TIẾP
  // =========================================================================
  window.spatialDeskHud = {
    getState: () => state,
    dropWindowToDesk,
    updateCadAssemblyModel(data = {}) {
      state.show3dStl = true;
      if (data.file_name) state.cadAssembly.file_name = data.file_name;
      if (data.current_dimensions_mm) {
        state.cadAssembly.dimensions_mm = {
          length: Number(data.current_dimensions_mm.length) || 58.0,
          width: Number(data.current_dimensions_mm.width) || 34.0,
          height: Number(data.current_dimensions_mm.height) || 24.0,
        };
      }
      if (typeof data.is_exploded === "boolean") state.cadAssembly.is_exploded = data.is_exploded;
      if (typeof data.explode_distance_mm === "number") state.cadAssembly.explode_distance_mm = data.explode_distance_mm;
      if (Array.isArray(data.components) && data.components.length > 0) {
        state.cadAssembly.components = data.components;
      } else {
        buildDefaultCadComponents();
      }
      syncCadDimensionsDom();
      const stlBtn = document.getElementById("btn-stl-generator");
      if (stlBtn) stlBtn.classList.add("active");
      const explBtn = document.getElementById("btn-explode-assembly");
      if (explBtn) explBtn.classList.toggle("active", state.cadAssembly.is_exploded);
    },
    openCadFilePicker() {
      // Gọi bridge API mở dialog từ electron nếu có
      if (window.electron?.ipcRenderer) {
        window.electron.ipcRenderer.send("iris:desk-open-cad-dialog");
      }
    },
    triggerAutoCalibration(calibData = {}) {
      if (typeof calibData.ppm === "number" && calibData.ppm > 0) {
        state.ppm = calibData.ppm;
        syncModeBadge();
        syncCaliperDom();
      }
      state.autoCalib.flashingPattern = true;
      state.autoCalib.flashStartedAt = performance.now();
      state.autoCalib.flashDurationMs = Number(calibData.flash_duration_ms) || 1500;
      state.autoCalib.successHaloActive = false;
      const btn = document.getElementById("btn-procam-calib");
      if (btn) {
        btn.classList.add("active");
        setTimeout(() => btn.classList.remove("active"), state.autoCalib.flashDurationMs + 1500);
      }
    },
    updatePinoutOverlay(data = {}) {
      state.showPinout = true;
      if (data.board_id) state.pinout.board_id = data.board_id;
      if (data.board_name) state.pinout.board_name = data.board_name;
      if (data.chip_marking) state.pinout.chip_marking = data.chip_marking;
      if (data.operating_voltage) state.pinout.operating_voltage = data.operating_voltage;
      if (data.pose && typeof data.pose === "object") {
        state.pinout.pose = { ...state.pinout.pose, ...data.pose };
      }
      if (Array.isArray(data.pins) && data.pins.length > 0) {
        state.pinout.pins = data.pins;
      } else {
        rebuildPinoutRaysFromPose();
      }
      const boardNameEl = document.getElementById("pinout-board-name");
      const boardSubEl = document.getElementById("pinout-board-sub");
      if (boardNameEl) boardNameEl.textContent = state.pinout.board_name;
      if (boardSubEl) {
        boardSubEl.textContent = `${state.pinout.pins.length} chân • Góc ${state.pinout.pose.angle_deg || 0}° • Chạm để tra cứu`;
      }
      const btn = document.getElementById("btn-pcb-pinout");
      if (btn) btn.classList.add("active");
    },
    update3dPrintJob(job = {}) {
      startSimulatedOrLive3dPrint(job);
    },
    updatePhotogrammetryScan(scan = {}) {
      state.showPhotogrammetry = true;
      if (scan.label) state.photogrammetry.label = scan.label;
      if (scan.stl_path) state.photogrammetry.stl_path = scan.stl_path;
      if (scan.obj_path) state.photogrammetry.obj_path = scan.obj_path;
      if (typeof scan.views_captured === "number") state.photogrammetry.views_captured = scan.views_captured;
      if (Array.isArray(scan.capture_angles_deg)) state.photogrammetry.capture_angles_deg = scan.capture_angles_deg;
      if (typeof scan.vertex_count === "number") state.photogrammetry.vertex_count = scan.vertex_count;
      if (typeof scan.facet_count === "number") state.photogrammetry.facet_count = scan.facet_count;
      if (scan.outer_dimensions_mm) state.photogrammetry.outer_dimensions_mm = scan.outer_dimensions_mm;
      if (scan.preview_mesh?.vertices) state.photogrammetry.vertices = scan.preview_mesh.vertices;
      if (scan.preview_mesh?.edges) state.photogrammetry.edges = scan.preview_mesh.edges;
      const btn = document.getElementById("btn-scan-3d-mesh");
      if (btn) btn.classList.add("active");
    },
    updateMeasurement(data = {}) {
      if (typeof data.length_mm === "number") state.caliper.length_mm = data.length_mm;
      if (typeof data.width_mm === "number") state.caliper.width_mm = data.width_mm;
      if (typeof data.height_mm === "number") state.caliper.height_mm = data.height_mm;
      if (typeof data.ppm === "number" && data.ppm > 0) state.ppm = data.ppm;
      if (data.label) state.caliper.label = data.label;
      if (Array.isArray(data.bounding_box_px) && data.bounding_box_px.length === 4) {
        state.caliper.bbox = data.bounding_box_px;
      }
      state.showLaserCaliper = true;
      syncCaliperDom();
    },
    updateStlModel(model = {}) {
      state.show3dStl = true;
      if (model.stl_path) state.stlModel.stl_path = model.stl_path;
      if (model.outer_dimensions_mm) state.stlModel.outer_dimensions_mm = model.outer_dimensions_mm;
      if (model.preview_mesh?.vertices) state.stlModel.vertices = model.preview_mesh.vertices;
      if (model.preview_mesh?.edges) state.stlModel.edges = model.preview_mesh.edges;

      const nameEl = document.getElementById("stl-model-name");
      const pathEl = document.getElementById("stl-output-path");
      if (nameEl && model.outer_dimensions_mm) {
        const d = model.outer_dimensions_mm;
        nameEl.textContent = `${model.model_type || "sliding_box"} (${d.length}×${d.width}×${d.height}mm)`;
      }
      if (pathEl && model.stl_path) {
        pathEl.textContent = model.stl_path;
      }
    },
    triggerAuraLocate(targetLabel, x, y) {
      state.showAura = true;
      if (targetLabel) {
        state.auraObjects = [
          {
            id: `aura-${Date.now()}`,
            label: `[${targetLabel}]`,
            x: typeof x === "number" ? x : Math.round(window.innerWidth * 0.42),
            y: typeof y === "number" ? y : Math.round(window.innerHeight * 0.52),
            radius: 58,
            color: "#00ff9d",
          },
        ];
      }
    },
    triggerXrayScan(enabled = true, callouts = null) {
      state.showXray = Boolean(enabled);
      if (Array.isArray(callouts) && callouts.length > 0) {
        state.xrayCallouts = callouts;
      }
    },
    updateMirrorTranscript(speaker, text) {
      const el = document.getElementById("hud-mirror-transcript");
      if (el && text) {
        el.textContent = `${speaker === "you" ? "Bạn" : "Iris"}: "${text}"`;
      }
    },
    onHandGesture(gesturePayload) {
      const statusEl = document.getElementById("hand-gesture-status");
      const pinchEl = document.getElementById("hand-pinch-readout");
      if (!gesturePayload) return;

      if (gesturePayload.thumbTip && gesturePayload.indexTip) {
        state.hand = {
          ...state.hand,
          ...gesturePayload,
          active: true,
          lastSeenAt: performance.now(),
        };
        if (statusEl) {
          statusEl.textContent = gesturePayload.isTouching ? "Chạm nhấn bàn (Touch Press)" : "Pinch-to-Zoom hoạt động";
        }
        if (pinchEl) {
          pinchEl.textContent = `Khoảng cách: ${gesturePayload.pinchDistancePx}px • Scale: ${Math.round((gesturePayload.scale || 1) * 100)}%`;
        }

        const touchPt = gesturePayload.indexTip || gesturePayload.center;
        if (gesturePayload.isTouching && !state.wasTouching && touchPt) {
          triggerDeskClick(touchPt.x, touchPt.y);
        }
        state.wasTouching = Boolean(gesturePayload.isTouching);

        const topWin = state.projectedWindows[state.projectedWindows.length - 1];
        if (topWin) {
          if (gesturePayload.isTouching && gesturePayload.center) {
            topWin.x = Math.max(20, Math.min(window.innerWidth - topWin.width - 20, gesturePayload.center.x - topWin.width / 2));
            topWin.y = Math.max(50, Math.min(window.innerHeight - 120, gesturePayload.center.y - 24));
            const el = document.getElementById(topWin.id);
            if (el) {
              el.style.left = `${topWin.x}px`;
              el.style.top = `${topWin.y}px`;
            }
          } else if (gesturePayload.isPinchZoomActive && typeof gesturePayload.scale === "number") {
            updateWindowScale(topWin.id, gesturePayload.scale);
          }
        }
        return;
      }

      const topWin = state.projectedWindows[state.projectedWindows.length - 1];
      if (typeof gesturePayload === "string") {
        if (statusEl) statusEl.textContent = `Cử chỉ: ${gesturePayload}`;
        if (topWin && (gesturePayload === "zoom_in" || gesturePayload === "two_hand_zoom_in")) {
          updateWindowScale(topWin.id, (topWin.scale || 1) + 0.15);
        } else if (topWin && (gesturePayload === "zoom_out" || gesturePayload === "two_hand_zoom_out")) {
          updateWindowScale(topWin.id, (topWin.scale || 1) - 0.15);
        }
      } else if (gesturePayload.type === "air_mouse" || gesturePayload.type === "grab") {
        const px = Math.round((gesturePayload.nx || 0.5) * window.innerWidth);
        const py = Math.round((gesturePayload.ny || 0.5) * window.innerHeight);
        const isClickAction = gesturePayload.action === "click" || gesturePayload.action === "pinch_click";
        const isDown = gesturePayload.type === "grab" || gesturePayload.action === "down" || isClickAction;

        if (isClickAction || (isDown && !state.wasTouching)) {
          triggerDeskClick(px, py);
        }
        state.wasTouching = isDown;

        state.hand = {
          active: true,
          thumbTip: { x: px - 14, y: py + 10 },
          indexTip: { x: px, y: py },
          center: { x: px, y: py },
          pinchDistancePx: gesturePayload.type === "grab" ? 12 : 42,
          isTouching: isDown,
          isPinchZoomActive: false,
          scale: topWin?.scale || 1.0,
          lastSeenAt: performance.now(),
        };
        if (topWin && state.hand.isTouching) {
          topWin.x = Math.max(20, Math.min(window.innerWidth - topWin.width - 20, px - topWin.width / 2));
          topWin.y = Math.max(50, Math.min(window.innerHeight - 120, py - 24));
          const el = document.getElementById(topWin.id);
          if (el) {
            el.style.left = `${topWin.x}px`;
            el.style.top = `${topWin.y}px`;
          }
        }
      }
    },
  };
})();

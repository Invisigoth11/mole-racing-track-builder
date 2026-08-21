(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Editor scale: 10 SVG units = 1 cm.
  const CM = 10;
  const LONG_LENGTH = 15 * CM;
  const SHORT_LENGTH = 7.5 * CM;
  const FOOT_LENGTH = 1.9 * CM;
  const LONG_FOOT_OFFSET = 2 * CM;
  const BARRIER_THICKNESS = 3; // Matches the visible barrier stroke width.
  const FUEL_TOKEN_SIZE = 20;
  const ARROW_LENGTH = 70;
  const ARROW_WIDTH = 32;
  const COLLISION_EPSILON = 0.08;

  const svg = document.getElementById("canvas");
  const viewport = document.getElementById("viewport");
  const decorationsLayer = document.getElementById("trackDecorations");
  const barrierGlowsLayer = document.getElementById("barrierGlows");
  const barriersLayer = document.getElementById("barriers");
  const overlayLayer = document.getElementById("selectionOverlay");

  const trackNameInput = document.getElementById("trackName");
  const newTrackButton = document.getElementById("newTrack");
  const saveTrackButton = document.getElementById("saveTrack");
  const loadTrackButton = document.getElementById("loadTrack");
  const exportSvgButton = document.getElementById("exportSvg");
  const exportPdfButton = document.getElementById("exportPdf");
  const trackFileInput = document.getElementById("trackFileInput");

  const addLongButton = document.getElementById("addLong");
  const addShortButton = document.getElementById("addShort");
  const addRedButton = document.getElementById("addRed");
  const addFuelButton = document.getElementById("addFuel");
  const addArrowButton = document.getElementById("addArrow");
  const duplicateButton = document.getElementById("duplicate");
  const deleteButton = document.getElementById("delete");
  const toggleMagnetsButton = document.getElementById("toggleMagnets");
  const angleInput = document.getElementById("angleInput");
  const resetViewButton = document.getElementById("resetView");

  const selectionInfo = document.getElementById("selectionInfo");
  const zoomInfo = document.getElementById("zoomInfo");
  const longBarrierCount = document.getElementById("longBarrierCount");
  const shortBarrierCount = document.getElementById("shortBarrierCount");
  const startBarrierCount = document.getElementById("startBarrierCount");
  const fuelTokenCount = document.getElementById("fuelTokenCount");

  const TRACK_FORMAT = "mole-racing-track";
  const TRACK_VERSION = 1;
  const AUTOSAVE_KEY = "mole-racing-track-autosave";

  const state = {
    trackName: "Untitled Track",
    isDirty: false,
    barriers: [],
    selectedId: null,
    selectedIds: [],
    view: { x: 0, y: 0, scale: 1 },
    drag: null,
    pan: null,
    rotate: null,
    spaceDown: false,
    nextId: 1,
    magnetsEnabled: true,
    magnetPreview: null,
    clipboard: [],
    pasteCount: 0,
    undoStack: [],
    redoStack: [],
    interactionHistoryCaptured: false,
  };

  function createHistorySnapshot() {
    return {
      trackName: state.trackName,
      barriers: state.barriers.map((barrier) => ({ ...barrier })),
      selectedId: state.selectedId,
      selectedIds: [...state.selectedIds],
      nextId: state.nextId,
    };
  }

  function snapshotSignature(snapshot) {
    return JSON.stringify(snapshot);
  }

  function pushUndoState() {
    const snapshot = createHistorySnapshot();
    const previous = state.undoStack.at(-1);

    if (!previous || snapshotSignature(previous) !== snapshotSignature(snapshot)) {
      state.undoStack.push(snapshot);
      if (state.undoStack.length > 100) state.undoStack.shift();
    }

    state.redoStack = [];
  }

  function restoreHistorySnapshot(snapshot) {
    state.trackName = snapshot.trackName;
    state.barriers = snapshot.barriers.map((barrier) => ({ ...barrier }));
    state.selectedId = snapshot.selectedId;
    state.selectedIds = [...snapshot.selectedIds];
    state.nextId = snapshot.nextId;
    state.drag = null;
    state.marquee = null;
    state.pan = null;
    state.rotate = null;
    state.magnetPreview = null;
    state.interactionHistoryCaptured = false;
    trackNameInput.value = state.trackName;
    markTrackChanged();
    render();
  }

  function undo() {
    const snapshot = state.undoStack.pop();
    if (!snapshot) return;

    state.redoStack.push(createHistorySnapshot());
    restoreHistorySnapshot(snapshot);
  }

  function redo() {
    const snapshot = state.redoStack.pop();
    if (!snapshot) return;

    state.undoStack.push(createHistorySnapshot());
    restoreHistorySnapshot(snapshot);
  }

  function copySelected() {
    const selectedBarriers = getSelectedBarriers();
    if (selectedBarriers.length === 0) return;

    state.clipboard = selectedBarriers.map((barrier) => ({
      kind: barrier.kind,
      x: barrier.x,
      y: barrier.y,
      rotation: barrier.rotation,
    }));
    state.pasteCount = 0;
  }

  function pasteClipboard() {
    if (state.clipboard.length === 0) return;

    const existingRedCount = state.barriers.filter(
      (barrier) => barrier.kind === "red"
    ).length;
    const clipboardRedCount = state.clipboard.filter(
      (barrier) => barrier.kind === "red"
    ).length;

    if (existingRedCount + clipboardRedCount > 2) {
      alert("There are only two Start / Finish barriers in the physical game.");
      return;
    }

    pushUndoState();
    state.pasteCount += 1;
    const offset = 20 * state.pasteCount;

    const pasted = state.clipboard.map((barrier) => ({
      ...barrier,
      id: state.nextId++,
      x: barrier.x + offset,
      y: barrier.y + offset,
    }));

    state.barriers.push(...pasted);
    state.selectedIds = pasted.map((barrier) => barrier.id);
    state.selectedId = state.selectedIds.at(-1) ?? null;
    state.magnetPreview = null;
    markTrackChanged();
    render();
  }

  function selectAllBarriers() {
    state.selectedIds = state.barriers.map((barrier) => barrier.id);
    state.selectedId = state.selectedIds.at(-1) ?? null;
    state.magnetPreview = null;
    renderSelection();
  }

  function clearSelection() {
    selectOnly(null);
    state.magnetPreview = null;
    renderSelection();
  }

  function moveSelectedBy(deltaX, deltaY) {
    const selectedBarriers = getSelectedBarriers();
    if (selectedBarriers.length === 0) return;

    pushUndoState();
    selectedBarriers.forEach((barrier) => {
      barrier.x += deltaX;
      barrier.y += deltaY;
    });

    state.magnetPreview = null;
    markTrackChanged();
    render();
  }

  function createSvgElement(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }

  function screenToWorld(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.view.x) / state.view.scale,
      y: (clientY - rect.top - state.view.y) / state.view.scale,
    };
  }

  function applyView() {
    viewport.setAttribute(
      "transform",
      `translate(${state.view.x} ${state.view.y}) scale(${state.view.scale})`
    );
    zoomInfo.textContent = `${Math.round(state.view.scale * 100)}%`;
  }

  function barrierName(barrier) {
    if (barrier.kind === "red") return "Start / Finish";
    if (barrier.kind === "fuel") return "Fuel Token";
    if (barrier.kind === "arrow") return "Direction Arrow";
    return barrier.kind === "long" ? "Long Barrier" : "Short Barrier";
  }

  function sanitizeFileName(name) {
    const cleaned = String(name || "Untitled Track")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/[.\s]+$/g, "");

    return cleaned || "Untitled Track";
  }

  function createTrackData() {
    return {
      format: TRACK_FORMAT,
      version: TRACK_VERSION,
      name: state.trackName || "Untitled Track",
      savedAt: new Date().toISOString(),
      barriers: state.barriers.map((barrier) => ({
        id: barrier.id,
        kind: barrier.kind,
        x: barrier.x,
        y: barrier.y,
        rotation: barrier.rotation,
      })),
      view: {
        x: state.view.x,
        y: state.view.y,
        scale: state.view.scale,
      },
      settings: {
        placementAssist: state.magnetsEnabled,
      },
    };
  }

  function validateTrackData(data) {
    if (!data || typeof data !== "object") {
      throw new Error("The selected file does not contain a track.");
    }

    if (data.format !== TRACK_FORMAT) {
      throw new Error("This is not a Mole Racing track file.");
    }

    if (data.version !== TRACK_VERSION) {
      throw new Error(`Track version ${data.version} is not supported.`);
    }

    if (!Array.isArray(data.barriers)) {
      throw new Error("The track has no valid barrier list.");
    }

    const validKinds = new Set(["long", "short", "red", "fuel", "arrow"]);
    let startFinishCount = 0;

    data.barriers.forEach((barrier, index) => {
      if (!barrier || !validKinds.has(barrier.kind)) {
        throw new Error(`Barrier ${index + 1} has an invalid type.`);
      }

      ["x", "y", "rotation"].forEach((property) => {
        if (!Number.isFinite(Number(barrier[property]))) {
          throw new Error(`Barrier ${index + 1} has an invalid ${property} value.`);
        }
      });

      if (barrier.kind === "red") startFinishCount += 1;
    });

    if (startFinishCount > 2) {
      throw new Error("A track cannot contain more than two Start / Finish barriers.");
    }

    return data;
  }

  function autosaveTrack() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(createTrackData()));
    } catch (error) {
      console.warn("Autosave failed:", error);
    }
  }

  function markTrackChanged() {
    state.isDirty = true;
    autosaveTrack();
  }

  function restoreTrack(data, { dirty = false } = {}) {
    validateTrackData(data);

    state.trackName =
      typeof data.name === "string" && data.name.trim()
        ? data.name.trim().slice(0, 80)
        : "Untitled Track";

    state.barriers = data.barriers.map((barrier, index) => ({
      id: Number.isInteger(Number(barrier.id))
        ? Number(barrier.id)
        : index + 1,
      kind: barrier.kind,
      x: Number(barrier.x),
      y: Number(barrier.y),
      rotation: ((Number(barrier.rotation) % 360) + 360) % 360,
    }));

    const highestId = state.barriers.reduce(
      (highest, barrier) => Math.max(highest, barrier.id),
      0
    );
    state.nextId = highestId + 1;
    state.selectedId = null;
    state.selectedIds = [];
    state.drag = null;
    state.rotate = null;
    state.pan = null;
    state.magnetPreview = null;

    if (
      data.view &&
      Number.isFinite(Number(data.view.x)) &&
      Number.isFinite(Number(data.view.y)) &&
      Number.isFinite(Number(data.view.scale))
    ) {
      state.view = {
        x: Number(data.view.x),
        y: Number(data.view.y),
        scale: Math.min(40, Math.max(0.2, Number(data.view.scale))),
      };
    }

    state.magnetsEnabled =
      data.settings?.placementAssist !== false;
    toggleMagnetsButton.textContent =
      `Placement Assist: ${state.magnetsEnabled ? "On" : "Off"}`;
    toggleMagnetsButton.classList.toggle("active", state.magnetsEnabled);

    state.isDirty = dirty;
    state.undoStack = [];
    state.redoStack = [];
    state.clipboard = [];
    state.pasteCount = 0;
    trackNameInput.value = state.trackName;
    applyView();
    render();
    autosaveTrack();
  }

  function confirmDiscardCurrentTrack() {
    if (!state.isDirty) return true;

    return window.confirm(
      "Discard the current track?\n\nUnsaved changes will be lost."
    );
  }

  function newTrack() {
    if (!confirmDiscardCurrentTrack()) return;

    const rect = svg.getBoundingClientRect();
    state.trackName = "Untitled Track";
    state.barriers = [];
    state.nextId = 1;
    state.selectedId = null;
    state.selectedIds = [];
    state.magnetPreview = null;
    state.view = {
      x: rect.width / 2,
      y: rect.height / 2,
      scale: 1,
    };
    state.isDirty = false;
    state.undoStack = [];
    state.redoStack = [];
    state.clipboard = [];
    state.pasteCount = 0;
    trackNameInput.value = state.trackName;
    applyView();
    render();
    autosaveTrack();
  }

  function saveTrack() {
    state.trackName = trackNameInput.value.trim() || "Untitled Track";
    trackNameInput.value = state.trackName;

    const data = createTrackData();
    const blob = new Blob(
      [JSON.stringify(data, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeFileName(state.trackName)}.moleracing`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    state.isDirty = false;
    autosaveTrack();
  }

  async function loadTrackFile(file) {
    if (!file) return;

    if (!confirmDiscardCurrentTrack()) {
      trackFileInput.value = "";
      return;
    }

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      restoreTrack(data, { dirty: false });
    } catch (error) {
      window.alert(`Could not load track.\n\n${error.message}`);
    } finally {
      trackFileInput.value = "";
    }
  }

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function formatSvgNumber(value) {
    const rounded = Math.round(Number(value) * 1000) / 1000;
    return Object.is(rounded, -0) ? "0" : String(rounded);
  }

  function exportBarrierType(barrier) {
    if (barrier.kind === "red") return "start-finish";
    if (barrier.kind === "fuel") return "fuel-token";
    if (barrier.kind === "arrow") return "direction-arrow";
    return barrier.kind === "short" ? "short-barrier" : "long-barrier";
  }

  function exportBarrierLabel(barrier, number) {
    if (barrier.kind === "red") return `Start Finish ${number}`;
    if (barrier.kind === "fuel") return `Fuel Token ${number}`;
    if (barrier.kind === "arrow") return `Direction Arrow ${number}`;
    if (barrier.kind === "short") return `Short Barrier ${number}`;
    return `Long Barrier ${number}`;
  }

  function rotateExportPoint(x, y, angleDegrees) {
    const angle = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    return {
      x: x * cos - y * sin,
      y: x * sin + y * cos,
    };
  }

  function transformExportPoint(barrier, x, y, offsetX = 0, offsetY = 0) {
    const rotated = rotateExportPoint(x, y, barrier.rotation);
    return {
      x: rotated.x + barrier.x + offsetX,
      y: rotated.y + barrier.y + offsetY,
    };
  }

  function exportRectanglePath(
    barrier,
    x,
    y,
    width,
    height,
    offsetX = 0,
    offsetY = 0
  ) {
    const points = [
      transformExportPoint(barrier, x, y, offsetX, offsetY),
      transformExportPoint(barrier, x + width, y, offsetX, offsetY),
      transformExportPoint(barrier, x + width, y + height, offsetX, offsetY),
      transformExportPoint(barrier, x, y + height, offsetX, offsetY),
    ];

    return [
      `M ${formatSvgNumber(points[0].x)} ${formatSvgNumber(points[0].y)}`,
      `L ${formatSvgNumber(points[1].x)} ${formatSvgNumber(points[1].y)}`,
      `L ${formatSvgNumber(points[2].x)} ${formatSvgNumber(points[2].y)}`,
      `L ${formatSvgNumber(points[3].x)} ${formatSvgNumber(points[3].y)}`,
      "Z",
    ].join(" ");
  }

  function createExportBarrierGroup(
    barrier,
    number,
    offsetX = 0,
    offsetY = 0
  ) {
    if (barrier.kind === "arrow") {
      const paddedNumber = String(number).padStart(3, "0");
      const groupId = `direction-arrow-${paddedNumber}`;
      const points = arrowLocalPoints().map((point) =>
        transformExportPoint(barrier, point.x, point.y, offsetX, offsetY)
      );
      const path = points.map((point, index) =>
        `${index === 0 ? "M" : "L"} ${formatSvgNumber(point.x)} ${formatSvgNumber(point.y)}`
      ).join(" ");
      return [
        `    <g id="${groupId}" data-barrier-id="${barrier.id}">`,
        `      <path d="${path} Z" fill="#6F4823" opacity="0.2"/>`,
        `    </g>`,
      ].join("\n");
    }
    if (barrier.kind === "fuel") {
      const paddedNumber = String(number).padStart(3, "0");
      const groupId = `fuel-token-${paddedNumber}`;
      const half = FUEL_TOKEN_SIZE / 2;
      const x = barrier.x + offsetX;
      const y = barrier.y + offsetY;
      return [
        `    <g id="${groupId}" data-barrier-id="${barrier.id}" transform="translate(${formatSvgNumber(x)} ${formatSvgNumber(y)})">`,
        `      <rect x="${formatSvgNumber(-half)}" y="${formatSvgNumber(-half)}" width="${FUEL_TOKEN_SIZE}" height="${FUEL_TOKEN_SIZE}" rx="5" fill="#B7DF62" stroke="#6B8736" stroke-width="1.5"/>`,
        `      <path d="M -5 -5 L 5 5 M 5 -5 L -5 5" fill="none" stroke="#6B8736" stroke-width="1.5" stroke-linecap="round"/>`,
        `    </g>`,
      ].join("\n");
    }

    const length = barrierLength(barrier);
    const halfLength = length / 2;
    const bodyX = -halfLength;
    const bodyY = -BARRIER_THICKNESS / 2;
    const footCenters =
      barrier.kind === "short"
        ? [0]
        : [-halfLength + LONG_FOOT_OFFSET, halfLength - LONG_FOOT_OFFSET];

    const type = exportBarrierType(barrier);
    const paddedNumber = String(number).padStart(3, "0");
    const groupId = `${type}-${paddedNumber}`;
    const label = exportBarrierLabel(barrier, paddedNumber);
    const fill = barrier.kind === "red" ? "#37B56A" : "#000000";

    const outlinePaths = [
      exportRectanglePath(
        barrier,
        bodyX,
        bodyY,
        length,
        BARRIER_THICKNESS,
        offsetX,
        offsetY
      ),
    ];

    footCenters.forEach((footX) => {
      outlinePaths.push(
        exportRectanglePath(
          barrier,
          footX - BARRIER_THICKNESS / 2,
          -FOOT_LENGTH / 2,
          BARRIER_THICKNESS,
          FOOT_LENGTH,
          offsetX,
          offsetY
        )
      );
    });

    return [
      `    <g id="${groupId}" data-barrier-id="${barrier.id}">`,
      `      <path id="${groupId}-outline" d="${outlinePaths.join(" ")}" fill="${fill}" fill-rule="nonzero"/>`,
      `    </g>`,
    ].join("\n");
  }

  function calculateTrackBounds() {
    if (!state.barriers.length) return null;
    const points = state.barriers.flatMap((barrier) => barrierPolygons(barrier).flat());
    return {
      minX: Math.min(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxX: Math.max(...points.map((point) => point.x)),
      maxY: Math.max(...points.map((point) => point.y)),
    };
  }

  function createExportSvg() {
    const bounds = calculateTrackBounds();
    if (!bounds) {
      throw new Error("The track is empty.");
    }

    // 10 SVG units equal 1 cm. A 10-unit margin therefore equals 10 mm.
    const margin = CM;
    const sourceMinX = bounds.minX - margin;
    const sourceMinY = bounds.minY - margin;
    const width = bounds.maxX - bounds.minX + margin * 2;
    const height = bounds.maxY - bounds.minY + margin * 2;
    const widthCm = width / CM;
    const heightCm = height / CM;
    const offsetX = -sourceMinX;
    const offsetY = -sourceMinY;

    const counters = {
      long: 0,
      short: 0,
      red: 0,
      fuel: 0,
      arrow: 0,
    };

    const exportObjects = [
      ...state.barriers.filter((barrier) => barrier.kind === "arrow"),
      ...state.barriers.filter((barrier) => barrier.kind !== "arrow"),
    ];
    const barrierGroups = exportObjects.map((barrier) => {
      counters[barrier.kind] += 1;
      return createExportBarrierGroup(
        barrier,
        counters[barrier.kind],
        offsetX,
        offsetY
      );
    });

    const title = state.trackName.trim() || "Untitled Track";

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg xmlns="http://www.w3.org/2000/svg"`,
      `     version="1.1"`,
      `     width="${formatSvgNumber(widthCm)}cm"`,
      `     height="${formatSvgNumber(heightCm)}cm"`,
      `     viewBox="0 0 ${formatSvgNumber(width)} ${formatSvgNumber(height)}">`,
      `  <title>${escapeXml(title)}</title>`,
      `  <desc>Mole Racing track. Full scale: 10 SVG units equal 1 cm.</desc>`,
      `  <g id="track">`,
      barrierGroups.join("\n"),
      `  </g>`,
      `</svg>`,
      ``,
    ].join("\n");
  }

  function exportSvg() {
    try {
      state.trackName = trackNameInput.value.trim() || "Untitled Track";
      trackNameInput.value = state.trackName;

      const svgContent = createExportSvg();
      const blob = new Blob([svgContent], {
        type: "image/svg+xml;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${sanitizeFileName(state.trackName)}.svg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(`Could not export SVG.\n\n${error.message}`);
    }
  }

  function formatPdfNumber(value) {
    const rounded = Math.round(Number(value) * 1000) / 1000;
    return Object.is(rounded, -0) ? "0" : String(rounded);
  }

  function createPdfBytes() {
    const bounds = calculateTrackBounds();
    if (!bounds) {
      throw new Error("The track is empty.");
    }

    // Editor coordinates are millimetres. PDF coordinates are points.
    const margin = CM;
    const sourceMinX = bounds.minX - margin;
    const sourceMinY = bounds.minY - margin;
    const widthMm = bounds.maxX - bounds.minX + margin * 2;
    const heightMm = bounds.maxY - bounds.minY + margin * 2;
    const pointsPerMm = 72 / 25.4;
    const pageWidth = widthMm * pointsPerMm;
    const pageHeight = heightMm * pointsPerMm;

    if (pageWidth > 14400 || pageHeight > 14400) {
      throw new Error("The full-scale track is too large for a standard PDF page.");
    }

    const pdfPoint = (point) => ({
      x: (point.x - sourceMinX) * pointsPerMm,
      y: pageHeight - (point.y - sourceMinY) * pointsPerMm,
    });
    const pdfBarrierSegments = (barrier) => {
      const segments = [];
      const length = barrierLength(barrier);
      const halfLength = length / 2;
      const bodyStart = pdfPoint(transformExportPoint(barrier, -halfLength, 0));
      const bodyEnd = pdfPoint(transformExportPoint(barrier, halfLength, 0));
      segments.push(
        `${formatPdfNumber(bodyStart.x)} ${formatPdfNumber(bodyStart.y)} m ` +
        `${formatPdfNumber(bodyEnd.x)} ${formatPdfNumber(bodyEnd.y)} l S`
      );
      const footCenters = barrier.kind === "short"
        ? [0]
        : [-halfLength + LONG_FOOT_OFFSET, halfLength - LONG_FOOT_OFFSET];
      footCenters.forEach((footX) => {
        const footStart = pdfPoint(
          transformExportPoint(barrier, footX, -FOOT_LENGTH / 2)
        );
        const footEnd = pdfPoint(
          transformExportPoint(barrier, footX, FOOT_LENGTH / 2)
        );
        segments.push(
          `${formatPdfNumber(footStart.x)} ${formatPdfNumber(footStart.y)} m ` +
          `${formatPdfNumber(footEnd.x)} ${formatPdfNumber(footEnd.y)} l S`
        );
      });
      return segments;
    };
    const pdfFuelTokenPath = (barrier) => {
      const half = FUEL_TOKEN_SIZE / 2;
      const radius = 5;
      const curve = radius * 0.5522847498;
      const point = (x, y) => pdfPoint(transformExportPoint(barrier, x, y));
      const path = [];
      const move = point(-half + radius, -half);
      const topEnd = point(half - radius, -half);
      path.push(
        `${formatPdfNumber(move.x)} ${formatPdfNumber(move.y)} m`,
        `${formatPdfNumber(topEnd.x)} ${formatPdfNumber(topEnd.y)} l`
      );
      const sections = [
        {
          controls: [[half - radius + curve, -half], [half, -half + radius - curve], [half, -half + radius]],
          lineEnd: [half, half - radius],
        },
        {
          controls: [[half, half - radius + curve], [half - radius + curve, half], [half - radius, half]],
          lineEnd: [-half + radius, half],
        },
        {
          controls: [[-half + radius - curve, half], [-half, half - radius + curve], [-half, half - radius]],
          lineEnd: [-half, -half + radius],
        },
        {
          controls: [[-half, -half + radius - curve], [-half + radius - curve, -half], [-half + radius, -half]],
          lineEnd: null,
        },
      ];
      sections.forEach(({ controls: [control1, control2, end], lineEnd }) => {
        const c1 = point(...control1);
        const c2 = point(...control2);
        const target = point(...end);
        path.push(
          `${formatPdfNumber(c1.x)} ${formatPdfNumber(c1.y)} ` +
          `${formatPdfNumber(c2.x)} ${formatPdfNumber(c2.y)} ` +
          `${formatPdfNumber(target.x)} ${formatPdfNumber(target.y)} c`
        );
        if (lineEnd) {
          const lineTarget = point(...lineEnd);
          path.push(
            `${formatPdfNumber(lineTarget.x)} ${formatPdfNumber(lineTarget.y)} l`
          );
        }
      });
      path.push("h f");
      return path;
    };
    const commands = [
      "q",
      "0.937 0.714 0.302 rg",
      `0 0 ${formatPdfNumber(pageWidth)} ${formatPdfNumber(pageHeight)} re f`,
    ];

    // Deterministic, low-opacity sand speckles inspired by the rulebook.
    let textureSeed = (
      Math.round(widthMm * 10) * 73856093 ^
      Math.round(heightMm * 10) * 19349663
    ) >>> 0;
    const textureRandom = () => {
      textureSeed = (textureSeed * 1664525 + 1013904223) >>> 0;
      return textureSeed / 4294967296;
    };
    const pdfCircle = (x, y, radius) => {
      const k = radius * 0.5522847498;
      return [
        `${formatPdfNumber(x + radius)} ${formatPdfNumber(y)} m`,
        `${formatPdfNumber(x + radius)} ${formatPdfNumber(y + k)} ` +
          `${formatPdfNumber(x + k)} ${formatPdfNumber(y + radius)} ` +
          `${formatPdfNumber(x)} ${formatPdfNumber(y + radius)} c`,
        `${formatPdfNumber(x - k)} ${formatPdfNumber(y + radius)} ` +
          `${formatPdfNumber(x - radius)} ${formatPdfNumber(y + k)} ` +
          `${formatPdfNumber(x - radius)} ${formatPdfNumber(y)} c`,
        `${formatPdfNumber(x - radius)} ${formatPdfNumber(y - k)} ` +
          `${formatPdfNumber(x - k)} ${formatPdfNumber(y - radius)} ` +
          `${formatPdfNumber(x)} ${formatPdfNumber(y - radius)} c`,
        `${formatPdfNumber(x + k)} ${formatPdfNumber(y - radius)} ` +
          `${formatPdfNumber(x + radius)} ${formatPdfNumber(y - k)} ` +
          `${formatPdfNumber(x + radius)} ${formatPdfNumber(y)} c f`,
      ];
    };
    const speckleCount = Math.min(
      180,
      Math.max(45, Math.round((widthMm * heightMm) / 700))
    );
    commands.push("q", "/GS1 gs", "0.624 0.416 0.204 rg");
    for (let index = 0; index < speckleCount; index += 1) {
      const radiusMm = index % 7 === 0
        ? 3 + textureRandom() * 7
        : 0.35 + textureRandom() * 1.5;
      commands.push(
        ...pdfCircle(
          textureRandom() * pageWidth,
          textureRandom() * pageHeight,
          radiusMm * pointsPerMm
        )
      );
    }
    commands.push("Q");

    // Keep every highlight below every barrier, matching the editor layer order.
    const glowSegments = [];
    state.barriers.forEach((barrier) => {
      if (barrier.kind === "fuel" || barrier.kind === "arrow") return;
      glowSegments.push(...pdfBarrierSegments(barrier));
    });
    commands.push("q", "/GS2 gs", "1 0.88 0.58 RG", "1 J");
    const glowLayers = 18;
    for (let layer = 0; layer < glowLayers; layer += 1) {
      const widthMm = 15 - (layer / (glowLayers - 1)) * 10;
      commands.push(
        `${formatPdfNumber(widthMm * pointsPerMm)} w`,
        ...glowSegments
      );
    }
    commands.push("Q");

    // Mask texture and highlights below arrows, then add their translucent fill.
    const pdfArrows = state.barriers.filter((barrier) => barrier.kind === "arrow");
    const drawPdfArrows = () => {
      pdfArrows.forEach((arrow) => {
        const points = barrierPolygons(arrow)[0].map(pdfPoint);
        commands.push(
          `${formatPdfNumber(points[0].x)} ${formatPdfNumber(points[0].y)} m`
        );
        points.slice(1).forEach((point) => {
          commands.push(`${formatPdfNumber(point.x)} ${formatPdfNumber(point.y)} l`);
        });
        commands.push("h f");
      });
    };
    commands.push("0.937 0.714 0.302 rg");
    drawPdfArrows();
    commands.push("q", "/GS3 gs", "0.435 0.282 0.137 rg");
    drawPdfArrows();
    commands.push("Q");

    state.barriers.forEach((barrier) => {
      const isStart = barrier.kind === "red";
      const isFuel = barrier.kind === "fuel";
      if (barrier.kind === "arrow") return;
      if (!isFuel) {
        commands.push(
          isStart ? "0.471 0.741 0.404 rg" : "0.396 0.275 0.2 rg"
        );
        barrierPolygons(barrier).forEach((polygon) => {
          const points = polygon.map(pdfPoint);
          commands.push(
            `${formatPdfNumber(points[0].x)} ${formatPdfNumber(points[0].y)} m`
          );
          points.slice(1).forEach((point) => {
            commands.push(
              `${formatPdfNumber(point.x)} ${formatPdfNumber(point.y)} l`
            );
          });
          commands.push("h f");
        });
        return;
      }
      commands.push(
        "0.471 0.741 0.404 rg"
      );

      commands.push(...pdfFuelTokenPath(barrier));

      if (isFuel) {
        const crossA1 = pdfPoint(transformExportPoint(barrier, -5, -5));
        const crossA2 = pdfPoint(transformExportPoint(barrier, 5, 5));
        const crossB1 = pdfPoint(transformExportPoint(barrier, 5, -5));
        const crossB2 = pdfPoint(transformExportPoint(barrier, -5, 5));
        commands.push(
          "0.31 0.51 0.278 RG",
          `${formatPdfNumber(1.5 * pointsPerMm)} w`,
          "1 J",
          `${formatPdfNumber(crossA1.x)} ${formatPdfNumber(crossA1.y)} m`,
          `${formatPdfNumber(crossA2.x)} ${formatPdfNumber(crossA2.y)} l S`,
          `${formatPdfNumber(crossB1.x)} ${formatPdfNumber(crossB1.y)} m`,
          `${formatPdfNumber(crossB2.x)} ${formatPdfNumber(crossB2.y)} l S`
        );
      }
    });
    commands.push("Q");

    const encoder = new TextEncoder();
    const content = `${commands.join("\n")}\n`;
    const contentLength = encoder.encode(content).length;
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatPdfNumber(pageWidth)} ${formatPdfNumber(pageHeight)}] /Resources << /ExtGState << /GS1 5 0 R /GS2 6 0 R /GS3 7 0 R >> >> /Contents 4 0 R >>`,
      `<< /Length ${contentLength} >>\nstream\n${content}endstream`,
      "<< /Type /ExtGState /ca 0.1 /CA 0.1 >>",
      "<< /Type /ExtGState /ca 0.022 /CA 0.022 >>",
      "<< /Type /ExtGState /ca 0.14 /CA 0.14 >>",
    ];

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(encoder.encode(pdf).length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = encoder.encode(pdf).length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

    return encoder.encode(pdf);
  }

  function exportPdf() {
    try {
      state.trackName = trackNameInput.value.trim() || "Untitled Track";
      trackNameInput.value = state.trackName;

      const blob = new Blob([createPdfBytes()], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${sanitizeFileName(state.trackName)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(`Could not export PDF.\n\n${error.message}`);
    }
  }

  function addBarrier(kind) {
    if (kind === "red" && state.barriers.filter((b) => b.kind === "red").length >= 2) {
      alert("There are only two Start / Finish barriers in the physical game.");
      return;
    }

    pushUndoState();

    const rect = svg.getBoundingClientRect();
    const center = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);

    const barrier = {
      id: state.nextId++,
      kind,
      x: center.x,
      y: center.y,
      rotation: 0,
    };

    state.barriers.push(barrier);
    selectOnly(barrier.id);
    markTrackChanged();
    render();
  }

  function getSelected() {
    return state.barriers.find((b) => b.id === state.selectedId) || null;
  }

  function getSelectedBarriers() {
    const selected = new Set(state.selectedIds);
    return state.barriers.filter((barrier) => selected.has(barrier.id));
  }

  function isBarrierSelected(id) {
    return state.selectedIds.includes(id);
  }

  function selectOnly(id) {
    state.selectedId = id;
    state.selectedIds = id == null ? [] : [id];
  }

  function toggleSelection(id) {
    if (isBarrierSelected(id)) {
      state.selectedIds = state.selectedIds.filter((selectedId) => selectedId !== id);
      if (state.selectedId === id) {
        state.selectedId = state.selectedIds.at(-1) ?? null;
      }
      return false;
    }

    state.selectedIds.push(id);
    state.selectedId = id;
    return true;
  }

  function normalizeRect(x1, y1, x2, y2) {
    return {
      minX: Math.min(x1, x2),
      minY: Math.min(y1, y2),
      maxX: Math.max(x1, x2),
      maxY: Math.max(y1, y2),
    };
  }

  function pointInRect(point, rect) {
    return (
      point.x >= rect.minX &&
      point.x <= rect.maxX &&
      point.y >= rect.minY &&
      point.y <= rect.maxY
    );
  }

  function pointInPolygon(point, polygon) {
    let inside = false;

    for (
      let i = 0, j = polygon.length - 1;
      i < polygon.length;
      j = i, i += 1
    ) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      const intersects =
        yi > point.y !== yj > point.y &&
        point.x <
          ((xj - xi) * (point.y - yi)) / ((yj - yi) || 0.000001) + xi;

      if (intersects) inside = !inside;
    }

    return inside;
  }

  function orientation(a, b, c) {
    const value =
      (b.y - a.y) * (c.x - b.x) -
      (b.x - a.x) * (c.y - b.y);

    if (Math.abs(value) < 0.000001) return 0;
    return value > 0 ? 1 : 2;
  }

  function onSegment(a, b, c) {
    return (
      b.x <= Math.max(a.x, c.x) + 0.000001 &&
      b.x + 0.000001 >= Math.min(a.x, c.x) &&
      b.y <= Math.max(a.y, c.y) + 0.000001 &&
      b.y + 0.000001 >= Math.min(a.y, c.y)
    );
  }

  function segmentsIntersect(a1, a2, b1, b2) {
    const o1 = orientation(a1, a2, b1);
    const o2 = orientation(a1, a2, b2);
    const o3 = orientation(b1, b2, a1);
    const o4 = orientation(b1, b2, a2);

    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(a1, b1, a2)) return true;
    if (o2 === 0 && onSegment(a1, b2, a2)) return true;
    if (o3 === 0 && onSegment(b1, a1, b2)) return true;
    if (o4 === 0 && onSegment(b1, a2, b2)) return true;
    return false;
  }

  function polygonTouchesRect(polygon, rect) {
    if (polygon.some((point) => pointInRect(point, rect))) {
      return true;
    }

    const rectPoints = [
      { x: rect.minX, y: rect.minY },
      { x: rect.maxX, y: rect.minY },
      { x: rect.maxX, y: rect.maxY },
      { x: rect.minX, y: rect.maxY },
    ];

    if (rectPoints.some((point) => pointInPolygon(point, polygon))) {
      return true;
    }

    for (let i = 0; i < polygon.length; i += 1) {
      const polygonStart = polygon[i];
      const polygonEnd = polygon[(i + 1) % polygon.length];

      for (let j = 0; j < rectPoints.length; j += 1) {
        const rectStart = rectPoints[j];
        const rectEnd = rectPoints[(j + 1) % rectPoints.length];

        if (segmentsIntersect(polygonStart, polygonEnd, rectStart, rectEnd)) {
          return true;
        }
      }
    }

    return false;
  }

  function localRectanglePolygon(barrier, x, y, width, height) {
    const angle = (barrier.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ].map((point) => ({
      x: barrier.x + point.x * cos - point.y * sin,
      y: barrier.y + point.x * sin + point.y * cos,
    }));
  }

  function arrowLocalPoints() {
    const halfLength = ARROW_LENGTH / 2;
    const halfWidth = ARROW_WIDTH / 2;
    const shaftHalfWidth = ARROW_WIDTH * 0.18;
    const headStart = ARROW_LENGTH * 0.08;
    return [
      { x: -halfLength, y: -shaftHalfWidth },
      { x: headStart, y: -shaftHalfWidth },
      { x: headStart, y: -halfWidth },
      { x: halfLength, y: 0 },
      { x: headStart, y: halfWidth },
      { x: headStart, y: shaftHalfWidth },
      { x: -halfLength, y: shaftHalfWidth },
    ];
  }

  function localPointsPolygon(barrier, points) {
    const angle = (barrier.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return points.map((point) => ({
      x: barrier.x + point.x * cos - point.y * sin,
      y: barrier.y + point.x * sin + point.y * cos,
    }));
  }

  function barrierPolygons(barrier) {
    if (barrier.kind === "arrow") {
      return [localPointsPolygon(barrier, arrowLocalPoints())];
    }
    if (barrier.kind === "fuel") {
      return [localRectanglePolygon(
        barrier,
        -FUEL_TOKEN_SIZE / 2,
        -FUEL_TOKEN_SIZE / 2,
        FUEL_TOKEN_SIZE,
        FUEL_TOKEN_SIZE
      )];
    }

    const length = barrierLength(barrier);
    const halfLength = length / 2;

    const polygons = [
      localRectanglePolygon(
        barrier,
        -halfLength,
        -BARRIER_THICKNESS / 2,
        length,
        BARRIER_THICKNESS
      ),
    ];

    const footCenters =
      barrier.kind === "short"
        ? [0]
        : [-halfLength + LONG_FOOT_OFFSET, halfLength - LONG_FOOT_OFFSET];

    footCenters.forEach((footX) => {
      polygons.push(
        localRectanglePolygon(
          barrier,
          footX - BARRIER_THICKNESS / 2,
          -FOOT_LENGTH / 2,
          BARRIER_THICKNESS,
          FOOT_LENGTH
        )
      );
    });

    return polygons;
  }

  function barrierTouchesRect(barrier, rect) {
    return barrierPolygons(barrier).some((polygon) =>
      polygonTouchesRect(polygon, rect)
    );
  }

  function selectedBarrierBounds(barriers) {
    const points = barriers.flatMap((barrier) =>
      barrierPolygons(barrier).flat()
    );

    return {
      minX: Math.min(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxX: Math.max(...points.map((point) => point.x)),
      maxY: Math.max(...points.map((point) => point.y)),
    };
  }

  function barrierLength(barrier) {
    return barrier.kind === "short" ? SHORT_LENGTH : LONG_LENGTH;
  }

  function endpointPositions(
    barrier,
    x = barrier.x,
    y = barrier.y,
    rotation = barrier.rotation
  ) {
    const half = barrierLength(barrier) / 2;
    const radians = rotation * Math.PI / 180;
    const axisX = Math.cos(radians);
    const axisY = Math.sin(radians);
    const dx = axisX * half;
    const dy = axisY * half;

    return [
      {
        x: x - dx,
        y: y - dy,
        side: "start",
        outwardX: -axisX,
        outwardY: -axisY,
      },
      {
        x: x + dx,
        y: y + dy,
        side: "end",
        outwardX: axisX,
        outwardY: axisY,
      },
    ];
  }

  function segmentFromLocalPoints(barrier, p1, p2, x, y, rotation) {
    const radians = rotation * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    const transform = (point) => ({
      x: x + point.x * cos - point.y * sin,
      y: y + point.x * sin + point.y * cos,
    });

    return {
      a: transform(p1),
      b: transform(p2),
    };
  }

  function rectangleFromLocalCenter(
    part,
    centerX,
    centerY,
    length,
    thickness,
    barrierX,
    barrierY,
    barrierRotation,
    rectangleRotation = barrierRotation
  ) {
    // The part's center is positioned in the barrier's local coordinate system.
    const barrierRadians = barrierRotation * Math.PI / 180;
    const barrierCos = Math.cos(barrierRadians);
    const barrierSin = Math.sin(barrierRadians);

    const worldCenter = {
      x: barrierX + centerX * barrierCos - centerY * barrierSin,
      y: barrierY + centerX * barrierSin + centerY * barrierCos,
    };

    // The rectangle itself may be rotated differently, as with perpendicular feet.
    const rectangleRadians = rectangleRotation * Math.PI / 180;
    const axisX = Math.cos(rectangleRadians);
    const axisY = Math.sin(rectangleRadians);
    const normalX = -axisY;
    const normalY = axisX;

    const halfLength = length / 2;
    const halfThickness = thickness / 2;

    const corners = [
      {
        x: worldCenter.x - axisX * halfLength - normalX * halfThickness,
        y: worldCenter.y - axisY * halfLength - normalY * halfThickness,
      },
      {
        x: worldCenter.x + axisX * halfLength - normalX * halfThickness,
        y: worldCenter.y + axisY * halfLength - normalY * halfThickness,
      },
      {
        x: worldCenter.x + axisX * halfLength + normalX * halfThickness,
        y: worldCenter.y + axisY * halfLength + normalY * halfThickness,
      },
      {
        x: worldCenter.x - axisX * halfLength + normalX * halfThickness,
        y: worldCenter.y - axisY * halfLength + normalY * halfThickness,
      },
    ];

    return {
      part,
      center: worldCenter,
      axis: { x: axisX, y: axisY },
      normal: { x: normalX, y: normalY },
      halfLength,
      halfThickness,
      corners,
      // Kept for the existing red warning marker orientation.
      a: {
        x: worldCenter.x - axisX * halfLength,
        y: worldCenter.y - axisY * halfLength,
      },
      b: {
        x: worldCenter.x + axisX * halfLength,
        y: worldCenter.y + axisY * halfLength,
      },
    };
  }

  function barrierRectangles(
    barrier,
    x = barrier.x,
    y = barrier.y,
    rotation = barrier.rotation
  ) {
    const length = barrierLength(barrier);
    const halfLength = length / 2;

    const rectangles = [
      rectangleFromLocalCenter(
        "body",
        0,
        0,
        length,
        BARRIER_THICKNESS,
        x,
        y,
        rotation
      ),
    ];

    const footCenters =
      barrier.kind === "short"
        ? [0]
        : [-halfLength + LONG_FOOT_OFFSET, halfLength - LONG_FOOT_OFFSET];

    footCenters.forEach((footX, index) => {
      // A foot is perpendicular to the barrier, so rotate its local rectangle 90°.
      rectangles.push(
        rectangleFromLocalCenter(
          `foot-${index}`,
          footX,
          0,
          FOOT_LENGTH,
          BARRIER_THICKNESS,
          x,
          y,
          rotation,
          rotation + 90
        )
      );
    });

    return rectangles;
  }

  function projectCorners(corners, axis) {
    let min = Infinity;
    let max = -Infinity;

    corners.forEach((point) => {
      const projection = point.x * axis.x + point.y * axis.y;
      min = Math.min(min, projection);
      max = Math.max(max, projection);
    });

    return { min, max };
  }

  function pointInsideRectangle(point, rectangle) {
    const dx = point.x - rectangle.center.x;
    const dy = point.y - rectangle.center.y;

    const along = dx * rectangle.axis.x + dy * rectangle.axis.y;
    const across = dx * rectangle.normal.x + dy * rectangle.normal.y;

    return (
      Math.abs(along) <= rectangle.halfLength + COLLISION_EPSILON &&
      Math.abs(across) <= rectangle.halfThickness + COLLISION_EPSILON
    );
  }

  function lineSegmentIntersectionPoint(a, b, c, d) {
    const rX = b.x - a.x;
    const rY = b.y - a.y;
    const sX = d.x - c.x;
    const sY = d.y - c.y;
    const denominator = rX * sY - rY * sX;

    if (Math.abs(denominator) < 1e-9) return null;

    const qpx = c.x - a.x;
    const qpy = c.y - a.y;
    const t = (qpx * sY - qpy * sX) / denominator;
    const u = (qpx * rY - qpy * rX) / denominator;

    if (t < 0 || t > 1 || u < 0 || u > 1) return null;

    return {
      x: a.x + t * rX,
      y: a.y + t * rY,
    };
  }

  function rectangleContactCenter(first, second) {
    const points = [];

    first.corners.forEach((point) => {
      if (pointInsideRectangle(point, second)) points.push(point);
    });

    second.corners.forEach((point) => {
      if (pointInsideRectangle(point, first)) points.push(point);
    });

    for (let i = 0; i < 4; i += 1) {
      const firstA = first.corners[i];
      const firstB = first.corners[(i + 1) % 4];

      for (let j = 0; j < 4; j += 1) {
        const secondA = second.corners[j];
        const secondB = second.corners[(j + 1) % 4];
        const intersection = lineSegmentIntersectionPoint(
          firstA,
          firstB,
          secondA,
          secondB
        );

        if (intersection) points.push(intersection);
      }
    }

    if (!points.length) {
      return {
        x: (first.center.x + second.center.x) / 2,
        y: (first.center.y + second.center.y) / 2,
      };
    }

    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }

  function rectangleOverlap(first, second) {
    const axes = [
      first.axis,
      first.normal,
      second.axis,
      second.normal,
    ];

    let smallestPenetration = Infinity;

    for (const axis of axes) {
      const firstProjection = projectCorners(first.corners, axis);
      const secondProjection = projectCorners(second.corners, axis);

      const penetration =
        Math.min(firstProjection.max, secondProjection.max) -
        Math.max(firstProjection.min, secondProjection.min);

      // Touching is allowed. Only genuine area overlap triggers red.
      if (penetration <= COLLISION_EPSILON) return null;

      smallestPenetration = Math.min(smallestPenetration, penetration);
    }

    return {
      penetration: smallestPenetration,
      contact: rectangleContactCenter(first, second),
    };
  }

  function overlapInfo(
    barrier,
    x = barrier.x,
    y = barrier.y,
    rotation = barrier.rotation
  ) {
    if (barrier.kind === "fuel" || barrier.kind === "arrow") return null;
    const movingRectangles = barrierRectangles(barrier, x, y, rotation);
    let strongestOverlap = null;

    state.barriers.forEach((other) => {
      if (other.id === barrier.id || other.kind === "fuel" || other.kind === "arrow") return;

      const otherRectangles = barrierRectangles(other);

      movingRectangles.forEach((movingRectangle) => {
        otherRectangles.forEach((otherRectangle) => {
          const overlap = rectangleOverlap(movingRectangle, otherRectangle);
          if (!overlap) return;

          if (
            !strongestOverlap ||
            overlap.penetration > strongestOverlap.penetration
          ) {
            strongestOverlap = {
              other,
              first: overlap.contact,
              second: overlap.contact,
              distance: 0,
              penetration: overlap.penetration,
              movingSegment: movingRectangle,
              otherSegment: otherRectangle,
            };
          }
        });
      });
    });

    return strongestOverlap;
  }

  function positionOverlaps(barrier, x, y, rotation = barrier.rotation) {
    return Boolean(overlapInfo(barrier, x, y, rotation));
  }

  function clampMagneticMoveToFirstContact(barrier, startX, startY, targetX, targetY) {
    if (!positionOverlaps(barrier, targetX, targetY)) {
      return { x: targetX, y: targetY };
    }

    let low = 0;
    let high = 1;

    for (let iteration = 0; iteration < 16; iteration += 1) {
      const middle = (low + high) / 2;
      const x = startX + (targetX - startX) * middle;
      const y = startY + (targetY - startY) * middle;

      if (positionOverlaps(barrier, x, y)) {
        high = middle;
      } else {
        low = middle;
      }
    }

    return {
      x: startX + (targetX - startX) * low,
      y: startY + (targetY - startY) * low,
    };
  }

  function evaluatePlacementFeedback(
    movingBarrier,
    x = movingBarrier.x,
    y = movingBarrier.y,
    rotation = movingBarrier.rotation
  ) {
    if (
      !state.magnetsEnabled ||
      movingBarrier.kind === "fuel" ||
      movingBarrier.kind === "arrow"
    ) return null;

    const overlap = overlapInfo(movingBarrier, x, y, rotation);

    if (overlap) {
      return {
        type: "overlap",
        from: overlap.first,
        to: overlap.second,
        movingSegment: overlap.movingSegment,
      };
    }

    const movingEndpoints = endpointPositions(
      movingBarrier,
      x,
      y,
      rotation
    );
    let nearest = null;

    state.barriers.forEach((other) => {
      if (
        other.id === movingBarrier.id ||
        other.kind === "fuel" ||
        other.kind === "arrow"
      ) return;

      const otherEndpoints = endpointPositions(other);

      movingEndpoints.forEach((movingPoint) => {
        otherEndpoints.forEach((targetPoint) => {
          const dx = targetPoint.x - movingPoint.x;
          const dy = targetPoint.y - movingPoint.y;
          const distance = Math.hypot(dx, dy);

          if (distance < 0.001) return;

          const ux = dx / distance;
          const uy = dy / distance;

          const movingFacesTarget =
            ux * movingPoint.outwardX + uy * movingPoint.outwardY > 0.05;
          const targetFacesMoving =
            -ux * targetPoint.outwardX - uy * targetPoint.outwardY > 0.05;

          if (!movingFacesTarget || !targetFacesMoving) return;

          if (!nearest || distance < nearest.distance) {
            nearest = {
              movingPoint,
              targetPoint,
              dx,
              dy,
              distance,
            };
          }
        });
      });
    });

    if (!nearest) return null;

    const touchDistance = 0;
    const acceptedGap = 2;
    const attractionLimit = touchDistance + acceptedGap;

    if (nearest.distance > attractionLimit) return null;

    return {
      type: "good",
      from: nearest.movingPoint,
      movingSide: nearest.movingPoint.side,
      to: nearest.targetPoint,
      nearest,
      touchDistance,
      acceptedGap,
    };
  }

  function applyEndMagnetism(movingBarrier, proposedX, proposedY) {
    state.magnetPreview = evaluatePlacementFeedback(
      movingBarrier,
      proposedX,
      proposedY
    );

    if (
      !state.magnetPreview ||
      state.magnetPreview.type !== "good"
    ) {
      return { x: proposedX, y: proposedY };
    }

    const {
      nearest,
      touchDistance,
      acceptedGap,
    } = state.magnetPreview;

    const remainingGap = nearest.distance - touchDistance;
    if (remainingGap <= 0) {
      return { x: proposedX, y: proposedY };
    }

    const closeness = 1 - remainingGap / acceptedGap;
    const pull = Math.pow(Math.max(0, closeness), 2) * 0.78;
    const moveAmount = remainingGap * pull;
    const ux = nearest.dx / nearest.distance;
    const uy = nearest.dy / nearest.distance;

    const targetPosition = {
      x: proposedX + ux * moveAmount,
      y: proposedY + uy * moveAmount,
    };

    const adjusted = clampMagneticMoveToFirstContact(
      movingBarrier,
      proposedX,
      proposedY,
      targetPosition.x,
      targetPosition.y
    );

    const adjustedEndpoints = endpointPositions(
      movingBarrier,
      adjusted.x,
      adjusted.y
    );

    state.magnetPreview.from =
      nearest.movingPoint.side === "start"
        ? adjustedEndpoints[0]
        : adjustedEndpoints[1];

    return adjusted;
  }

  function createBarrierGlowGroup(barrier) {
    if (barrier.kind === "fuel" || barrier.kind === "arrow") return null;

    const group = createSvgElement("g", {
      transform: `translate(${barrier.x} ${barrier.y}) rotate(${barrier.rotation})`,
      "pointer-events": "none",
    });
    const length = barrierLength(barrier);
    const x1 = -length / 2;
    const x2 = length / 2;
    const footCenters = barrier.kind === "short"
      ? [0]
      : [x1 + LONG_FOOT_OFFSET, x2 - LONG_FOOT_OFFSET];

    group.appendChild(createSvgElement("line", {
      x1, y1: 0, x2, y2: 0, class: "barrier-glow",
    }));
    footCenters.forEach((footX) => {
      group.appendChild(createSvgElement("line", {
        x1: footX, y1: -FOOT_LENGTH / 2,
        x2: footX, y2: FOOT_LENGTH / 2,
        class: "barrier-glow",
      }));
    });

    return group;
  }

  function createBarrierGroup(barrier) {
    const group = createSvgElement("g", {
      "data-id": barrier.id,
      transform: `translate(${barrier.x} ${barrier.y}) rotate(${barrier.rotation})`,
    });

    if (barrier.kind === "arrow") {
      const points = arrowLocalPoints()
        .map((point) => `${point.x},${point.y}`)
        .join(" ");
      group.appendChild(createSvgElement("polygon", {
        points,
        class: "direction-arrow",
      }));
    } else if (barrier.kind === "fuel") {
      const half = FUEL_TOKEN_SIZE / 2;
      group.appendChild(createSvgElement("rect", {
        x: -half, y: -half, width: FUEL_TOKEN_SIZE, height: FUEL_TOKEN_SIZE,
        rx: 5, class: "fuel-token-body", "pointer-events": "none",
      }));
      group.appendChild(createSvgElement("path", {
        d: "M -5 -5 L 5 5 M 5 -5 L -5 5", class: "fuel-token-detail",
      }));
      group.appendChild(createSvgElement("rect", {
        x: -half, y: -half, width: FUEL_TOKEN_SIZE, height: FUEL_TOKEN_SIZE,
        rx: 5, class: "fuel-token-hitbox",
      }));
    } else if (barrier.kind !== "fuel") {
      const length = barrierLength(barrier);
      const x1 = -length / 2;
      const x2 = length / 2;
      const colorClass = barrier.kind === "red" ? " red" : "";
      const footCenters = barrier.kind === "short"
        ? [0]
        : [x1 + LONG_FOOT_OFFSET, x2 - LONG_FOOT_OFFSET];

      group.appendChild(createSvgElement("line", {
        x1, y1: 0, x2, y2: 0, class: `barrier-line${colorClass}`,
        "pointer-events": "none",
      }));

      footCenters.forEach((footX) => {
        group.appendChild(createSvgElement("line", {
          x1: footX, y1: -FOOT_LENGTH / 2,
          x2: footX, y2: FOOT_LENGTH / 2,
          class: `barrier-foot${colorClass}`, "pointer-events": "none",
        }));
      });
      group.appendChild(createSvgElement("line", {
        x1, y1: 0, x2, y2: 0, class: "barrier-hitbox",
      }));
    }

    group.addEventListener("pointerdown", (event) => {
      if (state.spaceDown || event.button === 1) return;

      event.stopPropagation();

      if (event.shiftKey) {
        const wasAdded = toggleSelection(barrier.id);
        if (!wasAdded) {
          state.drag = null;
          render();
          return;
        }
      } else if (!isBarrierSelected(barrier.id)) {
        selectOnly(barrier.id);
      } else {
        state.selectedId = barrier.id;
      }

      const world = screenToWorld(event.clientX, event.clientY);
      const selectedBarriers = getSelectedBarriers();

      pushUndoState();
      state.interactionHistoryCaptured = true;

      state.drag = {
        anchorId: barrier.id,
        startWorldX: world.x,
        startWorldY: world.y,
        positions: selectedBarriers.map((selectedBarrier) => ({
          id: selectedBarrier.id,
          x: selectedBarrier.x,
          y: selectedBarrier.y,
        })),
      };

      svg.setPointerCapture(event.pointerId);
      render();
    });

    return group;
  }

  function renderSelection() {
    overlayLayer.innerHTML = "";

    if (state.magnetPreview) {
      const preview = state.magnetPreview;
      const centerX = (preview.from.x + preview.to.x) / 2;
      const centerY = (preview.from.y + preview.to.y) / 2;

      if (preview.type === "good") {
        const distance = Math.hypot(
          preview.to.x - preview.from.x,
          preview.to.y - preview.from.y
        );

        // A small circle grows continuously as the two compatible ends approach.
        // Radius is defined in screen pixels, so it feels consistent at every zoom.
        const closeness = Math.max(
          0,
          Math.min(1, 1 - distance / preview.acceptedGap)
        );
        const radiusPixels = 6 + closeness * 18;

        const guide = createSvgElement("circle", {
          cx: centerX,
          cy: centerY,
          r: radiusPixels / state.view.scale,
          class: "placement-circle placement-circle-good",
        });
        overlayLayer.appendChild(guide);
      } else if (preview.type === "overlap") {
        const warning = createSvgElement("circle", {
          cx: centerX,
          cy: centerY,
          r: 24 / state.view.scale,
          class: "placement-circle placement-circle-overlap",
        });
        overlayLayer.appendChild(warning);
      }
    }

    if (state.marquee) {
      const rect = normalizeRect(
        state.marquee.startX,
        state.marquee.startY,
        state.marquee.currentX,
        state.marquee.currentY
      );

      overlayLayer.appendChild(
        createSvgElement("rect", {
          x: rect.minX,
          y: rect.minY,
          width: rect.maxX - rect.minX,
          height: rect.maxY - rect.minY,
          class: "marquee-selection",
        })
      );
    }

    const barrier = getSelected();
    const selectedBarriers = getSelectedBarriers();

    duplicateButton.disabled = !barrier;
    deleteButton.disabled = selectedBarriers.length === 0;
    angleInput.disabled =
      !barrier ||
      (selectedBarriers.length === 1 && barrier.kind === "fuel");

    const redCount = state.barriers.filter((b) => b.kind === "red").length;
    addRedButton.disabled = redCount >= 2;

    if (!barrier || selectedBarriers.length === 0) {
      selectionInfo.textContent = "Nothing selected";
      angleInput.value = "";
      return;
    }

    selectionInfo.textContent =
      selectedBarriers.length === 1
        ? barrier.kind === "fuel"
          ? barrierName(barrier)
          : `${barrierName(barrier)} · ${Math.round(barrier.rotation)}°`
        : `${selectedBarriers.length} objects selected · ${Math.round(barrier.rotation * 10) / 10}°`;

    if (document.activeElement !== angleInput) {
      angleInput.value = String(Math.round(barrier.rotation * 10) / 10);
    }

    selectedBarriers.forEach((selectedBarrier) => {
      const padding = 15;
      const width = selectedBarrier.kind === "fuel"
        ? FUEL_TOKEN_SIZE
        : selectedBarrier.kind === "arrow"
          ? ARROW_LENGTH
          : barrierLength(selectedBarrier);
      const height = selectedBarrier.kind === "fuel"
        ? FUEL_TOKEN_SIZE
        : selectedBarrier.kind === "arrow"
          ? ARROW_WIDTH
          : FOOT_LENGTH;
      const box = createSvgElement("rect", {
        x: -width / 2 - padding,
        y: -height / 2 - padding,
        width: width + padding * 2,
        height: height + padding * 2,
        rx: 5,
        class: "selection-box",
      });

      const selectionGroup = createSvgElement("g", {
        transform:
          `translate(${selectedBarrier.x} ${selectedBarrier.y}) ` +
          `rotate(${selectedBarrier.rotation})`,
      });
      selectionGroup.appendChild(box);
      overlayLayer.appendChild(selectionGroup);
    });

    if (selectedBarriers.length > 1) {
      const bounds = selectedBarrierBounds(selectedBarriers);
      const padding = 18;
      const minX = bounds.minX - padding;
      const minY = bounds.minY - padding;
      const maxX = bounds.maxX + padding;
      const maxY = bounds.maxY + padding;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const handleY = minY - 45;

      overlayLayer.appendChild(
        createSvgElement("rect", {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          rx: 5,
          class: "selection-box group-selection-box",
        })
      );

      overlayLayer.appendChild(
        createSvgElement("line", {
          x1: centerX,
          y1: minY,
          x2: centerX,
          y2: handleY,
          class: "rotation-line",
        })
      );

      const handle = createSvgElement("circle", {
        cx: centerX,
        cy: handleY,
        r: 9,
        class: "rotation-handle",
      });

      handle.addEventListener("pointerdown", (event) => {
        event.stopPropagation();

        const centerScreen = worldToScreen(centerX, centerY);
        const startPointerAngle = Math.atan2(
          event.clientY - centerScreen.y,
          event.clientX - centerScreen.x
        );

        pushUndoState();
        state.interactionHistoryCaptured = true;

        state.rotate = {
          type: "group",
          centerX,
          centerY,
          centerScreenX: centerScreen.x,
          centerScreenY: centerScreen.y,
          startPointerAngle,
          barriers: selectedBarriers.map((selectedBarrier) => ({
            id: selectedBarrier.id,
            x: selectedBarrier.x,
            y: selectedBarrier.y,
            rotation: selectedBarrier.rotation,
          })),
        };

        svg.setPointerCapture(event.pointerId);
      });

      overlayLayer.appendChild(handle);
    } else {
      const padding = 15;
      const objectHalfHeight = barrier.kind === "arrow"
        ? ARROW_WIDTH / 2
        : FOOT_LENGTH / 2;
      const handleDistance = objectHalfHeight + 45;
      const handleLine = createSvgElement("line", {
        x1: 0,
        y1: -objectHalfHeight - padding,
        x2: 0,
        y2: -handleDistance,
        class: "rotation-line",
      });

      const handle = createSvgElement("circle", {
        cx: 0,
        cy: -handleDistance,
        r: 9,
        class: "rotation-handle",
      });

      const group = createSvgElement("g", {
        transform: `translate(${barrier.x} ${barrier.y}) rotate(${barrier.rotation})`,
      });

      group.append(handleLine, handle);

      handle.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        const centerScreen = worldToScreen(barrier.x, barrier.y);
        pushUndoState();
        state.interactionHistoryCaptured = true;

        state.rotate = {
          type: "single",
          id: barrier.id,
          centerX: centerScreen.x,
          centerY: centerScreen.y,
        };
        svg.setPointerCapture(event.pointerId);
      });

      overlayLayer.appendChild(group);
    }
  }

  function worldToScreen(x, y) {
    const rect = svg.getBoundingClientRect();
    return {
      x: rect.left + state.view.x + x * state.view.scale,
      y: rect.top + state.view.y + y * state.view.scale,
    };
  }

  function renderBarrierCounter() {
    const counts = state.barriers.reduce(
      (result, barrier) => {
        if (barrier.kind === "long") result.long += 1;
        if (barrier.kind === "short") result.short += 1;
        if (barrier.kind === "red") result.start += 1;
        if (barrier.kind === "fuel") result.fuel += 1;
        return result;
      },
      { long: 0, short: 0, start: 0, fuel: 0 }
    );

    longBarrierCount.textContent = String(counts.long);
    shortBarrierCount.textContent = String(counts.short);
    startBarrierCount.textContent = String(counts.start);
    fuelTokenCount.textContent = String(counts.fuel);
  }

  function render() {
    renderBarrierCounter();
    decorationsLayer.innerHTML = "";
    barrierGlowsLayer.innerHTML = "";
    barriersLayer.innerHTML = "";
    state.barriers.forEach((barrier) => {
      const glow = createBarrierGlowGroup(barrier);
      if (glow) barrierGlowsLayer.appendChild(glow);
      const group = createBarrierGroup(barrier);
      if (barrier.kind === "arrow") {
        decorationsLayer.appendChild(group);
      } else {
        barriersLayer.appendChild(group);
      }
    });
    renderSelection();
  }

  function deleteSelected() {
    if (state.selectedIds.length === 0) return;
    pushUndoState();
    const selected = new Set(state.selectedIds);
    state.barriers = state.barriers.filter((barrier) => !selected.has(barrier.id));
    selectOnly(null);
    markTrackChanged();
    render();
  }

  function duplicateSelected() {
    const selectedBarriers = getSelectedBarriers();
    if (selectedBarriers.length === 0) return;

    const existingRedCount = state.barriers.filter(
      (barrier) => barrier.kind === "red"
    ).length;
    const selectedRedCount = selectedBarriers.filter(
      (barrier) => barrier.kind === "red"
    ).length;

    if (existingRedCount + selectedRedCount > 2) {
      alert("There are only two Start / Finish barriers in the physical game.");
      return;
    }

    pushUndoState();

    const copies = selectedBarriers.map((barrier) => ({
      ...barrier,
      id: state.nextId++,
      x: barrier.x + 30,
      y: barrier.y + 30,
    }));

    state.barriers.push(...copies);
    state.selectedIds = copies.map((barrier) => barrier.id);
    state.selectedId = state.selectedIds.at(-1) ?? null;
    state.magnetPreview = null;
    markTrackChanged();
    render();
  }

  function rotateSelected(delta) {
    const selectedBarriers = getSelectedBarriers();
    const activeBarrier = getSelected();
    if (!activeBarrier || selectedBarriers.length === 0) return;
    if (selectedBarriers.length === 1 && activeBarrier.kind === "fuel") return;

    pushUndoState();

    if (selectedBarriers.length === 1) {
      activeBarrier.rotation =
        (activeBarrier.rotation + delta + 360) % 360;
      state.magnetPreview = evaluatePlacementFeedback(activeBarrier);
      markTrackChanged();
      render();
      return;
    }

    pushUndoState();

    const bounds = selectedBarrierBounds(selectedBarriers);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const radians = delta * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    selectedBarriers.forEach((barrier) => {
      const relativeX = barrier.x - centerX;
      const relativeY = barrier.y - centerY;

      barrier.x = centerX + relativeX * cos - relativeY * sin;
      barrier.y = centerY + relativeX * sin + relativeY * cos;
      barrier.rotation = (barrier.rotation + delta + 360) % 360;
    });

    state.magnetPreview = null;
    markTrackChanged();
    render();
  }

  function applyAngleInput() {
    const activeBarrier = getSelected();
    const selectedBarriers = getSelectedBarriers();
    if (!activeBarrier || selectedBarriers.length === 0) return;
    if (selectedBarriers.length === 1 && activeBarrier.kind === "fuel") return;

    const normalizedInput = angleInput.value.trim().replace(",", ".");
    if (normalizedInput === "") return;

    const angle = Number(normalizedInput);
    if (!Number.isFinite(angle)) {
      angleInput.value = String(
        Math.round(activeBarrier.rotation * 10) / 10
      );
      return;
    }

    const targetAngle = ((angle % 360) + 360) % 360;

    if (selectedBarriers.length === 1) {
      pushUndoState();
      activeBarrier.rotation = targetAngle;
      state.magnetPreview = evaluatePlacementFeedback(activeBarrier);
      markTrackChanged();
      render();
      return;
    }

    const bounds = selectedBarrierBounds(selectedBarriers);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    let deltaDegrees = targetAngle - activeBarrier.rotation;
    if (deltaDegrees > 180) deltaDegrees -= 360;
    if (deltaDegrees < -180) deltaDegrees += 360;

    const deltaRadians = deltaDegrees * Math.PI / 180;
    const cos = Math.cos(deltaRadians);
    const sin = Math.sin(deltaRadians);

    selectedBarriers.forEach((barrier) => {
      const relativeX = barrier.x - centerX;
      const relativeY = barrier.y - centerY;

      barrier.x =
        centerX +
        relativeX * cos -
        relativeY * sin;
      barrier.y =
        centerY +
        relativeX * sin +
        relativeY * cos;
      barrier.rotation =
        (barrier.rotation + deltaDegrees + 360) % 360;
    });

    state.magnetPreview = null;
    markTrackChanged();
    render();
  }

  newTrackButton.addEventListener("click", newTrack);
  saveTrackButton.addEventListener("click", saveTrack);
  loadTrackButton.addEventListener("click", () => trackFileInput.click());
  exportSvgButton.addEventListener("click", exportSvg);
  exportPdfButton.addEventListener("click", exportPdf);
  trackFileInput.addEventListener("change", () => {
    loadTrackFile(trackFileInput.files?.[0]);
  });

  trackNameInput.addEventListener("input", () => {
    state.trackName = trackNameInput.value;
    markTrackChanged();
  });

  trackNameInput.addEventListener("blur", () => {
    state.trackName = trackNameInput.value.trim() || "Untitled Track";
    trackNameInput.value = state.trackName;
    autosaveTrack();
  });

  addLongButton.addEventListener("click", () => addBarrier("long"));
  addShortButton.addEventListener("click", () => addBarrier("short"));
  addRedButton.addEventListener("click", () => addBarrier("red"));
  addFuelButton.addEventListener("click", () => addBarrier("fuel"));
  addArrowButton.addEventListener("click", () => addBarrier("arrow"));
  deleteButton.addEventListener("click", deleteSelected);
  duplicateButton.addEventListener("click", duplicateSelected);
  angleInput.addEventListener("change", applyAngleInput);
  angleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      applyAngleInput();
      angleInput.blur();
    }

    if (event.key === "Escape") {
      const barrier = getSelected();
      angleInput.value = barrier
        ? String(Math.round(barrier.rotation * 10) / 10)
        : "";
      angleInput.blur();
    }
  });

  toggleMagnetsButton.addEventListener("click", () => {
    state.magnetsEnabled = !state.magnetsEnabled;
    toggleMagnetsButton.textContent =
      `Placement Assist: ${state.magnetsEnabled ? "On" : "Off"}`;
    toggleMagnetsButton.classList.toggle("active", state.magnetsEnabled);
    state.magnetPreview = null;
    autosaveTrack();
    render();
  });

  resetViewButton.addEventListener("click", () => {
    const rect = svg.getBoundingClientRect();
    state.view = { x: rect.width / 2, y: rect.height / 2, scale: 1 };
    applyView();
  });

  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.("[data-id]")) return;
    if (event.target.classList?.contains("rotation-handle")) return;

    const shouldPan = state.spaceDown || event.button === 1;
    if (shouldPan) {
      state.pan = {
        startX: event.clientX,
        startY: event.clientY,
        viewX: state.view.x,
        viewY: state.view.y,
      };
      svg.classList.add("panning");
      svg.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button !== 0) return;

    const world = screenToWorld(event.clientX, event.clientY);
    state.marquee = {
      startX: world.x,
      startY: world.y,
      currentX: world.x,
      currentY: world.y,
      additive: event.shiftKey,
      originalIds: [...state.selectedIds],
    };

    if (!event.shiftKey) {
      selectOnly(null);
    }

    svg.setPointerCapture(event.pointerId);
    renderSelection();
  });

  svg.addEventListener("pointermove", (event) => {
    if (state.pan) {
      state.view.x = state.pan.viewX + (event.clientX - state.pan.startX);
      state.view.y = state.pan.viewY + (event.clientY - state.pan.startY);
      applyView();
      return;
    }

    if (state.marquee) {
      const world = screenToWorld(event.clientX, event.clientY);
      state.marquee.currentX = world.x;
      state.marquee.currentY = world.y;

      const rect = normalizeRect(
        state.marquee.startX,
        state.marquee.startY,
        state.marquee.currentX,
        state.marquee.currentY
      );

      const touchedIds = state.barriers
        .filter((barrier) => barrierTouchesRect(barrier, rect))
        .map((barrier) => barrier.id);

      state.selectedIds = state.marquee.additive
        ? [...new Set([...state.marquee.originalIds, ...touchedIds])]
        : touchedIds;

      state.selectedId = state.selectedIds.at(-1) ?? null;
      renderSelection();
      return;
    }

    if (state.drag) {
      const world = screenToWorld(event.clientX, event.clientY);
      const deltaX = world.x - state.drag.startWorldX;
      const deltaY = world.y - state.drag.startWorldY;
      const isGroupDrag = state.drag.positions.length > 1;

      if (isGroupDrag) {
        state.magnetPreview = null;
        state.drag.positions.forEach((startPosition) => {
          const barrier = state.barriers.find((item) => item.id === startPosition.id);
          if (!barrier) return;
          barrier.x = startPosition.x + deltaX;
          barrier.y = startPosition.y + deltaY;
        });
      } else {
        const startPosition = state.drag.positions[0];
        const barrier = state.barriers.find((item) => item.id === startPosition?.id);
        if (!barrier) return;

        const proposedX = startPosition.x + deltaX;
        const proposedY = startPosition.y + deltaY;
        const adjusted = applyEndMagnetism(barrier, proposedX, proposedY);
        barrier.x = adjusted.x;
        barrier.y = adjusted.y;

        if (state.magnetPreview && state.magnetPreview.type === "good") {
          const endpoints = endpointPositions(barrier);
          state.magnetPreview.from =
            state.magnetPreview.movingSide === "start"
              ? endpoints[0]
              : endpoints[1];
        }
      }

      markTrackChanged();
      render();
      return;
    }

    if (state.rotate) {
      if (state.rotate.type === "group") {
        const pointerAngle = Math.atan2(
          event.clientY - state.rotate.centerScreenY,
          event.clientX - state.rotate.centerScreenX
        );

        let deltaAngle = pointerAngle - state.rotate.startPointerAngle;

        if (event.shiftKey) {
          const degrees = deltaAngle * 180 / Math.PI;
          deltaAngle = Math.round(degrees / 15) * 15 * Math.PI / 180;
        }

        const cos = Math.cos(deltaAngle);
        const sin = Math.sin(deltaAngle);
        const deltaDegrees = deltaAngle * 180 / Math.PI;

        state.rotate.barriers.forEach((startBarrier) => {
          const barrier = state.barriers.find(
            (item) => item.id === startBarrier.id
          );
          if (!barrier) return;

          const relativeX = startBarrier.x - state.rotate.centerX;
          const relativeY = startBarrier.y - state.rotate.centerY;

          barrier.x =
            state.rotate.centerX +
            relativeX * cos -
            relativeY * sin;
          barrier.y =
            state.rotate.centerY +
            relativeX * sin +
            relativeY * cos;
          barrier.rotation =
            (startBarrier.rotation + deltaDegrees + 360) % 360;
        });

        state.magnetPreview = null;
        markTrackChanged();
        render();
        return;
      }

      const barrier = state.barriers.find((b) => b.id === state.rotate.id);
      if (!barrier) return;

      const dx = event.clientX - state.rotate.centerX;
      const dy = event.clientY - state.rotate.centerY;
      let angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;

      if (event.shiftKey) {
        angle = Math.round(angle / 15) * 15;
      }

      barrier.rotation = (angle + 360) % 360;
      state.magnetPreview = evaluatePlacementFeedback(barrier);
      markTrackChanged();
      render();
    }
  });

  function endPointerInteraction() {
    state.drag = null;
    state.marquee = null;
    state.pan = null;
    state.rotate = null;
    state.magnetPreview = null;
    state.interactionHistoryCaptured = false;
    svg.classList.remove("panning");
    render();
  }

  svg.addEventListener("pointerup", endPointerInteraction);
  svg.addEventListener("pointercancel", endPointerInteraction);

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();

    const rect = svg.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const before = {
      x: (mouseX - state.view.x) / state.view.scale,
      y: (mouseY - state.view.y) / state.view.scale,
    };

    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const newScale = Math.min(40, Math.max(0.20, state.view.scale * zoomFactor));

    state.view.x = mouseX - before.x * newScale;
    state.view.y = mouseY - before.y * newScale;
    state.view.scale = newScale;
    applyView();
  }, { passive: false });

  window.addEventListener("keydown", (event) => {
    const isTyping =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement;

    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (modifier && key === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
      return;
    }

    if (
      (modifier && key === "z" && event.shiftKey) ||
      (event.ctrlKey && key === "y")
    ) {
      event.preventDefault();
      redo();
      return;
    }

    if (modifier && key === "c" && !isTyping) {
      event.preventDefault();
      copySelected();
      return;
    }

    if (modifier && key === "v" && !isTyping) {
      event.preventDefault();
      pasteClipboard();
      return;
    }

    if (modifier && key === "a" && !isTyping) {
      event.preventDefault();
      selectAllBarriers();
      return;
    }

    if (modifier && key === "d" && !isTyping) {
      event.preventDefault();
      duplicateSelected();
      return;
    }

    if (isTyping) return;

    if (event.code === "Space") {
      state.spaceDown = true;
      event.preventDefault();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      clearSelection();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelectedBy(event.shiftKey ? -10 : -1, 0);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelectedBy(event.shiftKey ? 10 : 1, 0);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelectedBy(0, event.shiftKey ? -10 : -1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelectedBy(0, event.shiftKey ? 10 : 1);
      return;
    }

    if (key === "q") {
      rotateSelected(event.shiftKey ? -15 : -5);
      return;
    }

    if (key === "e") {
      rotateSelected(event.shiftKey ? 15 : 5);
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      state.spaceDown = false;
    }
  });

  window.addEventListener("resize", () => {
    if (state.view.x === 0 && state.view.y === 0) {
      const rect = svg.getBoundingClientRect();
      state.view.x = rect.width / 2;
      state.view.y = rect.height / 2;
      applyView();
    }
  });

  // Restore the latest browser autosave. If none exists, open the sample track.
  requestAnimationFrame(() => {
    const rect = svg.getBoundingClientRect();
    state.view = { x: rect.width / 2, y: rect.height / 2, scale: 1 };

    const autosave = localStorage.getItem(AUTOSAVE_KEY);
    if (autosave) {
      try {
        restoreTrack(JSON.parse(autosave), { dirty: false });
        return;
      } catch (error) {
        console.warn("Could not restore autosave:", error);
        localStorage.removeItem(AUTOSAVE_KEY);
      }
    }

    state.trackName = "Untitled Track";
    trackNameInput.value = state.trackName;
    state.barriers.push(
      { id: state.nextId++, kind: "long", x: -110, y: 0, rotation: 0 },
      { id: state.nextId++, kind: "short", x: 60, y: 0, rotation: 25 }
    );
    state.isDirty = false;
    applyView();
    render();
    autosaveTrack();
  });
})();

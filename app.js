(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Editor scale: 10 SVG units = 1 cm.
  const CM = 10;
  const LONG_LENGTH = 15 * CM;
  const SHORT_LENGTH = 7.5 * CM;
  const FOOT_LENGTH = 1.9 * CM;
  const LONG_FOOT_OFFSET = 2 * CM;
  const BARRIER_THICKNESS = 2; // Matches the visible barrier stroke width.
  const COLLISION_EPSILON = 0.08;

  const svg = document.getElementById("canvas");
  const viewport = document.getElementById("viewport");
  const barriersLayer = document.getElementById("barriers");
  const overlayLayer = document.getElementById("selectionOverlay");

  const trackNameInput = document.getElementById("trackName");
  const newTrackButton = document.getElementById("newTrack");
  const saveTrackButton = document.getElementById("saveTrack");
  const loadTrackButton = document.getElementById("loadTrack");
  const exportSvgButton = document.getElementById("exportSvg");
  const trackFileInput = document.getElementById("trackFileInput");

  const addLongButton = document.getElementById("addLong");
  const addShortButton = document.getElementById("addShort");
  const addRedButton = document.getElementById("addRed");
  const duplicateButton = document.getElementById("duplicate");
  const deleteButton = document.getElementById("delete");
  const toggleMagnetsButton = document.getElementById("toggleMagnets");
  const angleInput = document.getElementById("angleInput");
  const resetViewButton = document.getElementById("resetView");

  const selectionInfo = document.getElementById("selectionInfo");
  const zoomInfo = document.getElementById("zoomInfo");

  const TRACK_FORMAT = "mole-racing-track";
  const TRACK_VERSION = 1;
  const AUTOSAVE_KEY = "mole-racing-track-autosave";

  const state = {
    trackName: "Untitled Track",
    isDirty: false,
    barriers: [],
    selectedId: null,
    view: { x: 0, y: 0, scale: 1 },
    drag: null,
    pan: null,
    rotate: null,
    spaceDown: false,
    nextId: 1,
    magnetsEnabled: true,
    magnetPreview: null,
  };

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

    const validKinds = new Set(["long", "short", "red"]);
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
    state.magnetPreview = null;
    state.view = {
      x: rect.width / 2,
      y: rect.height / 2,
      scale: 1,
    };
    state.isDirty = false;
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
    return barrier.kind === "short" ? "short-barrier" : "long-barrier";
  }

  function exportBarrierLabel(barrier, number) {
    if (barrier.kind === "red") return `Start Finish ${number}`;
    if (barrier.kind === "short") return `Short Barrier ${number}`;
    return `Long Barrier ${number}`;
  }

  function createExportBarrierGroup(barrier, number) {
    const length = barrierLength(barrier);
    const halfLength = length / 2;
    const bodyX = -halfLength;
    const footCenters =
      barrier.kind === "short"
        ? [0]
        : [-halfLength + LONG_FOOT_OFFSET, halfLength - LONG_FOOT_OFFSET];

    const type = exportBarrierType(barrier);
    const paddedNumber = String(number).padStart(3, "0");
    const groupId = `${type}-${paddedNumber}`;
    const label = exportBarrierLabel(barrier, paddedNumber);
    const fill = barrier.kind === "red" ? "#37B56A" : "#000000";

    const parts = [
      `    <g id="${groupId}" data-barrier-id="${barrier.id}" transform="translate(${formatSvgNumber(barrier.x)} ${formatSvgNumber(barrier.y)}) rotate(${formatSvgNumber(barrier.rotation)})">`,
      `      <title>${escapeXml(label)}</title>`,
      `      <rect id="${groupId}-body" x="${formatSvgNumber(bodyX)}" y="${formatSvgNumber(-BARRIER_THICKNESS / 2)}" width="${formatSvgNumber(length)}" height="${formatSvgNumber(BARRIER_THICKNESS)}" fill="${fill}">`,
      `        <title>Body</title>`,
      `      </rect>`,
    ];

    footCenters.forEach((footX, index) => {
      const footName =
        footCenters.length === 1
          ? "foot"
          : index === 0
            ? "foot-left"
            : "foot-right";
      const footTitle =
        footCenters.length === 1
          ? "Foot"
          : index === 0
            ? "Foot Left"
            : "Foot Right";

      parts.push(
        `      <rect id="${groupId}-${footName}" x="${formatSvgNumber(footX - BARRIER_THICKNESS / 2)}" y="${formatSvgNumber(-FOOT_LENGTH / 2)}" width="${formatSvgNumber(BARRIER_THICKNESS)}" height="${formatSvgNumber(FOOT_LENGTH)}" fill="${fill}">`,
        `        <title>${footTitle}</title>`,
        `      </rect>`
      );
    });

    parts.push("    </g>");
    return parts.join("\n");
  }

  function calculateTrackBounds() {
    if (!state.barriers.length) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    state.barriers.forEach((barrier) => {
      barrierRectangles(barrier).forEach((rectangle) => {
        rectangle.corners.forEach((point) => {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        });
      });
    });

    return { minX, minY, maxX, maxY };
  }

  function createExportSvg() {
    const bounds = calculateTrackBounds();
    if (!bounds) {
      throw new Error("The track is empty.");
    }

    // 10 SVG units equal 1 cm. A 10-unit margin therefore equals 10 mm.
    const margin = CM;
    const minX = bounds.minX - margin;
    const minY = bounds.minY - margin;
    const width = bounds.maxX - bounds.minX + margin * 2;
    const height = bounds.maxY - bounds.minY + margin * 2;
    const widthCm = width / CM;
    const heightCm = height / CM;

    const counters = {
      long: 0,
      short: 0,
      red: 0,
    };

    const barrierGroups = state.barriers.map((barrier) => {
      counters[barrier.kind] += 1;
      return createExportBarrierGroup(barrier, counters[barrier.kind]);
    });

    const title = state.trackName.trim() || "Untitled Track";

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg xmlns="http://www.w3.org/2000/svg"`,
      `     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"`,
      `     width="${formatSvgNumber(widthCm)}cm"`,
      `     height="${formatSvgNumber(heightCm)}cm"`,
      `     viewBox="${formatSvgNumber(minX)} ${formatSvgNumber(minY)} ${formatSvgNumber(width)} ${formatSvgNumber(height)}"`,
      `     fill="none">`,
      `  <title>${escapeXml(title)}</title>`,
      `  <desc>Mole Racing track. Full scale: 10 SVG units equal 1 cm.</desc>`,
      `  <g id="track" inkscape:groupmode="layer" inkscape:label="Track">`,
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

  function addBarrier(kind) {
    if (kind === "red" && state.barriers.filter((b) => b.kind === "red").length >= 2) {
      alert("There are only two Start / Finish barriers in the physical game.");
      return;
    }

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
    state.selectedId = barrier.id;
    markTrackChanged();
    render();
  }

  function getSelected() {
    return state.barriers.find((b) => b.id === state.selectedId) || null;
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
    const movingRectangles = barrierRectangles(barrier, x, y, rotation);
    let strongestOverlap = null;

    state.barriers.forEach((other) => {
      if (other.id === barrier.id) return;

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
    if (!state.magnetsEnabled) return null;

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
      if (other.id === movingBarrier.id) return;

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

  function createBarrierGroup(barrier) {
    const group = createSvgElement("g", {
      "data-id": barrier.id,
      transform: `translate(${barrier.x} ${barrier.y}) rotate(${barrier.rotation})`,
    });

    const length = barrierLength(barrier);
    const x1 = -length / 2;
    const x2 = length / 2;
    const isRed = barrier.kind === "red";
    const colorClass = isRed ? " red" : "";

    const line = createSvgElement("line", {
      x1,
      y1: 0,
      x2,
      y2: 0,
      class: `barrier-line${colorClass}`,
      "pointer-events": "none",
    });
    group.appendChild(line);

    const hitbox = createSvgElement("line", {
      x1,
      y1: 0,
      x2,
      y2: 0,
      class: "barrier-hitbox",
    });
    group.appendChild(hitbox);

    const footCenters =
      barrier.kind === "short"
        ? [0]
        : [x1 + LONG_FOOT_OFFSET, x2 - LONG_FOOT_OFFSET];

    footCenters.forEach((footX) => {
      const foot = createSvgElement("line", {
        x1: footX,
        y1: -FOOT_LENGTH / 2,
        x2: footX,
        y2: FOOT_LENGTH / 2,
        class: `barrier-foot${colorClass}`,
        "pointer-events": "none",
      });
      group.appendChild(foot);
    });

    group.addEventListener("pointerdown", (event) => {
      if (state.spaceDown || event.button === 1) return;

      event.stopPropagation();
      state.selectedId = barrier.id;

      const world = screenToWorld(event.clientX, event.clientY);
      state.drag = {
        id: barrier.id,
        offsetX: world.x - barrier.x,
        offsetY: world.y - barrier.y,
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

    const barrier = getSelected();

    duplicateButton.disabled = !barrier;
    deleteButton.disabled = !barrier;
    angleInput.disabled = !barrier;

    const redCount = state.barriers.filter((b) => b.kind === "red").length;
    addRedButton.disabled = redCount >= 2;

    if (!barrier) {
      selectionInfo.textContent = "Nothing selected";
      angleInput.value = "";
      return;
    }

    selectionInfo.textContent =
      `${barrierName(barrier)} · ${Math.round(barrier.rotation)}°`;

    if (document.activeElement !== angleInput) {
      angleInput.value = String(Math.round(barrier.rotation * 10) / 10);
    }

    const length = barrierLength(barrier);
    const padding = 15;
    const box = createSvgElement("rect", {
      x: -length / 2 - padding,
      y: -FOOT_LENGTH / 2 - padding,
      width: length + padding * 2,
      height: FOOT_LENGTH + padding * 2,
      rx: 5,
      class: "selection-box",
    });

    const handleDistance = FOOT_LENGTH / 2 + 45;
    const handleLine = createSvgElement("line", {
      x1: 0,
      y1: -FOOT_LENGTH / 2 - padding,
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

    group.append(box, handleLine, handle);

    handle.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      const centerScreen = worldToScreen(barrier.x, barrier.y);
      state.rotate = {
        id: barrier.id,
        centerX: centerScreen.x,
        centerY: centerScreen.y,
      };
      svg.setPointerCapture(event.pointerId);
    });

    overlayLayer.appendChild(group);
  }

  function worldToScreen(x, y) {
    const rect = svg.getBoundingClientRect();
    return {
      x: rect.left + state.view.x + x * state.view.scale,
      y: rect.top + state.view.y + y * state.view.scale,
    };
  }

  function render() {
    barriersLayer.innerHTML = "";
    state.barriers.forEach((barrier) => {
      barriersLayer.appendChild(createBarrierGroup(barrier));
    });
    renderSelection();
  }

  function deleteSelected() {
    if (!state.selectedId) return;
    state.barriers = state.barriers.filter((b) => b.id !== state.selectedId);
    state.selectedId = null;
    markTrackChanged();
    render();
  }

  function duplicateSelected() {
    const barrier = getSelected();
    if (!barrier) return;

    if (barrier.kind === "red" &&
        state.barriers.filter((b) => b.kind === "red").length >= 2) {
      alert("There are only two Start / Finish barriers in the physical game.");
      return;
    }

    const copy = {
      ...barrier,
      id: state.nextId++,
      x: barrier.x + 30,
      y: barrier.y + 30,
    };
    state.barriers.push(copy);
    state.selectedId = copy.id;
    markTrackChanged();
    render();
  }

  function rotateSelected(delta) {
    const barrier = getSelected();
    if (!barrier) return;

    barrier.rotation = (barrier.rotation + delta + 360) % 360;
      markTrackChanged();
    state.magnetPreview = evaluatePlacementFeedback(barrier);
    markTrackChanged();
    render();
  }

  function applyAngleInput() {
    const barrier = getSelected();
    if (!barrier) return;

    const normalizedInput = angleInput.value.trim().replace(",", ".");
    if (normalizedInput === "") return;

    const angle = Number(normalizedInput);
    if (!Number.isFinite(angle)) {
      angleInput.value = String(Math.round(barrier.rotation * 10) / 10);
      return;
    }

    barrier.rotation = ((angle % 360) + 360) % 360;
    state.magnetPreview = evaluatePlacementFeedback(barrier);
    markTrackChanged();
    render();
  }

  newTrackButton.addEventListener("click", newTrack);
  saveTrackButton.addEventListener("click", saveTrack);
  loadTrackButton.addEventListener("click", () => trackFileInput.click());
  exportSvgButton.addEventListener("click", exportSvg);
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

    state.selectedId = null;
    renderSelection();
  });

  svg.addEventListener("pointermove", (event) => {
    if (state.pan) {
      state.view.x = state.pan.viewX + (event.clientX - state.pan.startX);
      state.view.y = state.pan.viewY + (event.clientY - state.pan.startY);
      applyView();
      return;
    }

    if (state.drag) {
      const barrier = state.barriers.find((b) => b.id === state.drag.id);
      if (!barrier) return;
      const world = screenToWorld(event.clientX, event.clientY);
      const proposedX = world.x - state.drag.offsetX;
      const proposedY = world.y - state.drag.offsetY;
      const adjusted = applyEndMagnetism(barrier, proposedX, proposedY);
      barrier.x = adjusted.x;
      barrier.y = adjusted.y;
      markTrackChanged();

      if (state.magnetPreview && state.magnetPreview.type === "good") {
        const endpoints = endpointPositions(barrier);
        state.magnetPreview.from =
          state.magnetPreview.movingSide === "start"
            ? endpoints[0]
            : endpoints[1];
      }

      render();
      return;
    }

    if (state.rotate) {
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
      render();
    }
  });

  function endPointerInteraction() {
    state.drag = null;
    state.pan = null;
    state.rotate = null;
    state.magnetPreview = null;
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
    const isTyping = event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement;

    if (isTyping) return;

    if (event.code === "Space") {
      state.spaceDown = true;
      event.preventDefault();
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
    }

    if (event.key.toLowerCase() === "q") {
      rotateSelected(event.shiftKey ? -15 : -5);
    }

    if (event.key.toLowerCase() === "e") {
      rotateSelected(event.shiftKey ? 15 : 5);
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateSelected();
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

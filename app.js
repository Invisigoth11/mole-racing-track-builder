(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Editor scale: 10 SVG units = 1 cm.
  const CM = 10;
  const LONG_LENGTH = 15 * CM;
  const SHORT_LENGTH = 7.5 * CM;
  const FOOT_LENGTH = 1.9 * CM;
  const LONG_FOOT_OFFSET = 2 * CM;
  const BARRIER_THICKNESS = 4; // Matches the visible barrier stroke width.
  const COLLISION_EPSILON = 0.08;

  const svg = document.getElementById("canvas");
  const viewport = document.getElementById("viewport");
  const barriersLayer = document.getElementById("barriers");
  const overlayLayer = document.getElementById("selectionOverlay");

  const addLongButton = document.getElementById("addLong");
  const addShortButton = document.getElementById("addShort");
  const addRedButton = document.getElementById("addRed");
  const duplicateButton = document.getElementById("duplicate");
  const deleteButton = document.getElementById("delete");
  const toggleMagnetsButton = document.getElementById("toggleMagnets");
  const resetViewButton = document.getElementById("resetView");

  const selectionInfo = document.getElementById("selectionInfo");
  const zoomInfo = document.getElementById("zoomInfo");

  const state = {
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

  function barrierSegments(
    barrier,
    x = barrier.x,
    y = barrier.y,
    rotation = barrier.rotation
  ) {
    const length = barrierLength(barrier);
    const halfLength = length / 2;

    const segments = [
      {
        part: "body",
        thickness: BARRIER_THICKNESS,
        ...segmentFromLocalPoints(
          barrier,
          { x: -halfLength, y: 0 },
          { x: halfLength, y: 0 },
          x,
          y,
          rotation
        ),
      },
    ];

    const footCenters =
      barrier.kind === "short"
        ? [0]
        : [-halfLength + LONG_FOOT_OFFSET, halfLength - LONG_FOOT_OFFSET];

    footCenters.forEach((footX, index) => {
      segments.push({
        part: `foot-${index}`,
        thickness: 3,
        ...segmentFromLocalPoints(
          barrier,
          { x: footX, y: -FOOT_LENGTH / 2 },
          { x: footX, y: FOOT_LENGTH / 2 },
          x,
          y,
          rotation
        ),
      });
    });

    return segments;
  }

  function closestPointOnSegment(point, a, b) {
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const lengthSquared = abX * abX + abY * abY;

    if (lengthSquared === 0) return { x: a.x, y: a.y, t: 0 };

    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x - a.x) * abX + (point.y - a.y) * abY) / lengthSquared
      )
    );

    return {
      x: a.x + t * abX,
      y: a.y + t * abY,
      t,
    };
  }

  function orientation(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function segmentIntersection(first, second) {
    const x1 = first.a.x;
    const y1 = first.a.y;
    const x2 = first.b.x;
    const y2 = first.b.y;
    const x3 = second.a.x;
    const y3 = second.a.y;
    const x4 = second.b.x;
    const y4 = second.b.y;

    const denominator =
      (x1 - x2) * (y3 - y4) -
      (y1 - y2) * (x3 - x4);

    if (Math.abs(denominator) < 1e-8) return null;

    const t =
      ((x1 - x3) * (y3 - y4) -
        (y1 - y3) * (x3 - x4)) /
      denominator;

    const u =
      -(
        (x1 - x2) * (y1 - y3) -
        (y1 - y2) * (x1 - x3)
      ) / denominator;

    if (t < 0 || t > 1 || u < 0 || u > 1) return null;

    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    };
  }

  function closestPointsBetweenSegments(first, second) {
    const intersection = segmentIntersection(first, second);

    if (intersection) {
      return {
        first: intersection,
        second: intersection,
        distance: 0,
      };
    }

    const candidates = [];

    const firstAToSecond = closestPointOnSegment(first.a, second.a, second.b);
    candidates.push({
      first: first.a,
      second: firstAToSecond,
      distance: Math.hypot(
        first.a.x - firstAToSecond.x,
        first.a.y - firstAToSecond.y
      ),
    });

    const firstBToSecond = closestPointOnSegment(first.b, second.a, second.b);
    candidates.push({
      first: first.b,
      second: firstBToSecond,
      distance: Math.hypot(
        first.b.x - firstBToSecond.x,
        first.b.y - firstBToSecond.y
      ),
    });

    const secondAToFirst = closestPointOnSegment(second.a, first.a, first.b);
    candidates.push({
      first: secondAToFirst,
      second: second.a,
      distance: Math.hypot(
        second.a.x - secondAToFirst.x,
        second.a.y - secondAToFirst.y
      ),
    });

    const secondBToFirst = closestPointOnSegment(second.b, first.a, first.b);
    candidates.push({
      first: secondBToFirst,
      second: second.b,
      distance: Math.hypot(
        second.b.x - secondBToFirst.x,
        second.b.y - secondBToFirst.y
      ),
    });

    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0];
  }

  function overlapInfo(
    barrier,
    x = barrier.x,
    y = barrier.y,
    rotation = barrier.rotation
  ) {
    const movingSegments = barrierSegments(barrier, x, y, rotation);
    let strongestOverlap = null;

    state.barriers.forEach((other) => {
      if (other.id === barrier.id) return;

      const otherSegments = barrierSegments(other);

      movingSegments.forEach((movingSegment) => {
        otherSegments.forEach((otherSegment) => {
          const closest = closestPointsBetweenSegments(
            movingSegment,
            otherSegment
          );

          const overlapThreshold =
            movingSegment.thickness / 2 +
            otherSegment.thickness / 2 -
            COLLISION_EPSILON;

          if (closest.distance < overlapThreshold) {
            const penetration = overlapThreshold - closest.distance;

            if (
              !strongestOverlap ||
              penetration > strongestOverlap.penetration
            ) {
              strongestOverlap = {
                other,
                first: closest.first,
                second: closest.second,
                distance: closest.distance,
                penetration,
                movingSegment,
                otherSegment,
              };
            }
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

    const touchDistance = BARRIER_THICKNESS;
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
      const dx = preview.to.x - preview.from.x;
      const dy = preview.to.y - preview.from.y;
      const distance = Math.hypot(dx, dy);

      if (preview.type === "good" && distance > 0.001) {
        const ux = dx / distance;
        const uy = dy / distance;
        const radius = BARRIER_THICKNESS / 2;

        const startX = preview.from.x + ux * radius;
        const startY = preview.from.y + uy * radius;
        const endX = preview.to.x - ux * radius;
        const endY = preview.to.y - uy * radius;

        if (Math.hypot(endX - startX, endY - startY) > 0.05) {
          const guide = createSvgElement("line", {
            x1: startX,
            y1: startY,
            x2: endX,
            y2: endY,
            class: "magnet-guide",
          });
          overlayLayer.appendChild(guide);
        }
      } else if (preview.type === "overlap") {
        const centerX = (preview.from.x + preview.to.x) / 2;
        const centerY = (preview.from.y + preview.to.y) / 2;

        const segment = preview.movingSegment;
        const segmentDx = segment.b.x - segment.a.x;
        const segmentDy = segment.b.y - segment.a.y;
        const segmentLength = Math.hypot(segmentDx, segmentDy) || 1;

        // Draw a short marker perpendicular to the moving barrier part.
        // Its visual size stays constant at every zoom level.
        const nx = -segmentDy / segmentLength;
        const ny = segmentDx / segmentLength;
        const halfMarker = 6 / state.view.scale;

        const warning = createSvgElement("line", {
          x1: centerX - nx * halfMarker,
          y1: centerY - ny * halfMarker,
          x2: centerX + nx * halfMarker,
          y2: centerY + ny * halfMarker,
          class: "overlap-warning-line",
        });
        overlayLayer.appendChild(warning);
      }
    }

    const barrier = getSelected();

    duplicateButton.disabled = !barrier;
    deleteButton.disabled = !barrier;

    const redCount = state.barriers.filter((b) => b.kind === "red").length;
    addRedButton.disabled = redCount >= 2;

    if (!barrier) {
      selectionInfo.textContent = "Nothing selected";
      return;
    }

    selectionInfo.textContent =
      `${barrierName(barrier)} · ${Math.round(barrier.rotation)}°`;

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
    render();
  }

  function rotateSelected(delta) {
    const barrier = getSelected();
    if (!barrier) return;

    barrier.rotation = (barrier.rotation + delta + 360) % 360;
    state.magnetPreview = evaluatePlacementFeedback(barrier);
    render();
  }

  addLongButton.addEventListener("click", () => addBarrier("long"));
  addShortButton.addEventListener("click", () => addBarrier("short"));
  addRedButton.addEventListener("click", () => addBarrier("red"));
  deleteButton.addEventListener("click", deleteSelected);
  duplicateButton.addEventListener("click", duplicateSelected);

  toggleMagnetsButton.addEventListener("click", () => {
    state.magnetsEnabled = !state.magnetsEnabled;
    toggleMagnetsButton.textContent =
      `Placement Assist: ${state.magnetsEnabled ? "On" : "Off"}`;
    toggleMagnetsButton.classList.toggle("active", state.magnetsEnabled);
    state.magnetPreview = null;
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
    const newScale = Math.min(12, Math.max(0.20, state.view.scale * zoomFactor));

    state.view.x = mouseX - before.x * newScale;
    state.view.y = mouseY - before.y * newScale;
    state.view.scale = newScale;
    applyView();
  }, { passive: false });

  window.addEventListener("keydown", (event) => {
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

  // Initial view and sample barrier.
  requestAnimationFrame(() => {
    const rect = svg.getBoundingClientRect();
    state.view = { x: rect.width / 2, y: rect.height / 2, scale: 1 };
    state.barriers.push(
      { id: state.nextId++, kind: "long", x: -110, y: 0, rotation: 0 },
      { id: state.nextId++, kind: "short", x: 60, y: 0, rotation: 25 }
    );
    applyView();
    render();
  });
})();

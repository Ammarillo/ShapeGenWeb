import { maskFromImageData } from "./geometry.js";
import { exportSvg, exportVmf } from "./vmf.js";

const $ = (id) => document.getElementById(id);

const els = {
  file: $("file-input"),
  dropzone: $("dropzone"),
  loadBtn: $("load-btn"),
  fileMeta: $("file-meta"),
  thumb: $("thumb"),
  fileName: $("file-name"),
  fileSize: $("file-size"),
  tolerance: $("tolerance"),
  toleranceVal: $("tolerance-val"),
  iterations: $("iterations"),
  angle: $("angle"),
  optimize: $("optimize"),
  invertMask: $("invert-mask"),
  colorize: $("colorize"),
  worldW: $("world-w"),
  worldH: $("world-h"),
  thickness: $("thickness"),
  snapGrid: $("snap-grid"),
  generateBtn: $("generate-btn"),
  cancelBtn: $("cancel-btn"),
  exportVmfBtn: $("export-vmf-btn"),
  exportSvgBtn: $("export-svg-btn"),
  stats: $("stats"),
  canvas: $("preview"),
  empty: $("empty"),
  progress: $("progress"),
  progressText: $("progress-text"),
  progressBar: $("progress-bar"),
  zoomIn: $("zoom-in"),
  zoomOut: $("zoom-out"),
  zoomFit: $("zoom-fit"),
  toolbar: $("toolbar"),
  hud: $("hud"),
  toasts: $("toasts"),
};

const state = {
  name: "",
  width: 0,
  height: 0,
  sourceMask: null,
  mask: null,
  maskCanvas: null,
  shapes: [],
  generating: false,
  view: { x: 0, y: 0, scale: 1 },
  pan: { active: false, x: 0, y: 0, vx: 0, vy: 0 },
};

let worker = null;
let workerReady = false;

function createWorker() {
  if (worker) worker.terminate();
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  workerReady = true;
  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === "progress") {
      state.shapes = msg.shapes;
      const pct = msg.stats.totalRegions
        ? Math.round((msg.stats.regions / msg.stats.totalRegions) * 100)
        : 15;
      setProgress(pct, `${msg.stats.count} shapes · ${msg.stats.elapsed.toFixed(2)}s`);
      render();
      return;
    }
    if (msg.type === "done" || msg.type === "cancelled") {
      state.shapes = msg.shapes;
      finishGeneration(msg.type === "cancelled");
      return;
    }
    if (msg.type === "error") {
      finishGeneration(true);
      toast(msg.message, true);
    }
  };
  worker.onerror = (err) => {
    finishGeneration(true);
    toast(err.message || "Worker failed", true);
  };
}

function toast(message, isError = false) {
  const el = document.createElement("div");
  el.className = `toast${isError ? " error" : ""}`;
  el.textContent = message;
  els.toasts.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function setProgress(pct, text) {
  els.progress.classList.remove("hidden");
  els.progressText.textContent = text;
  els.progressBar.style.width = `${Math.max(8, Math.min(100, pct))}%`;
}

function optionsFromForm() {
  return {
    tolerance: Number(els.tolerance.value),
    iterations: Number(els.iterations.value),
    angleThreshold: Number(els.angle.value),
    optimize: els.optimize.checked,
  };
}

function worldOptions() {
  return {
    width: Number(els.worldW.value),
    height: Number(els.worldH.value),
    thickness: Number(els.thickness.value),
    snapToGrid: els.snapGrid.checked,
  };
}

function updateStats(extra = "") {
  if (!state.mask) {
    els.stats.innerHTML = "Load a mask to begin.";
    return;
  }
  const bits = [
    `<span>${state.width}×${state.height}</span>`,
    `<span><b>${state.shapes.length}</b> shapes</span>`,
  ];
  if (extra) bits.push(`<span>${extra}</span>`);
  els.stats.innerHTML = bits.join("");
}

function enableSourceActions(hasImage) {
  els.generateBtn.disabled = !hasImage || state.generating;
  els.cancelBtn.disabled = !state.generating;
  els.exportVmfBtn.disabled = !state.shapes.length;
  els.exportSvgBtn.disabled = !state.shapes.length;
  els.toolbar.classList.toggle("hidden", !hasImage);
  els.empty.classList.toggle("hidden", hasImage);
  els.empty.hidden = hasImage;
}

function fitView() {
  if (!state.width || !state.height) return;
  const dpr = window.devicePixelRatio || 1;
  const viewW = els.canvas.clientWidth;
  const viewH = els.canvas.clientHeight;
  const pad = 48;
  const scale = Math.min((viewW - pad) / state.width, (viewH - pad) / state.height, 8);
  state.view.scale = Math.max(0.05, scale);
  state.view.x = (viewW - state.width * state.view.scale) / 2;
  state.view.y = (viewH - state.height * state.view.scale) / 2;
  render();
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = els.canvas.parentElement.getBoundingClientRect();
  els.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  els.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  els.canvas.style.width = `${rect.width}px`;
  els.canvas.style.height = `${rect.height}px`;
  render();
}

function render() {
  const ctx = els.canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = els.canvas.clientWidth;
  const h = els.canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  if (!state.maskCanvas) return;

  ctx.save();
  ctx.translate(state.view.x, state.view.y);
  ctx.scale(state.view.scale, state.view.scale);
  ctx.imageSmoothingEnabled = state.view.scale < 1;
  ctx.drawImage(state.maskCanvas, 0, 0);

  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.15 / state.view.scale, 0.75);
  state.shapes.forEach((poly, i) => {
    if (!poly || poly.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let p = 1; p < poly.length; p++) ctx.lineTo(poly[p][0], poly[p][1]);
    ctx.closePath();
    if (els.colorize.checked) {
      const hue = (i * 137.508) % 360;
      ctx.fillStyle = `hsla(${hue}, 72%, 58%, 0.38)`;
      ctx.strokeStyle = `hsla(${hue}, 85%, 68%, 0.95)`;
      ctx.fill();
    } else {
      ctx.strokeStyle = "rgb(255, 70, 70)";
    }
    ctx.stroke();
  });
  ctx.restore();

  els.hud.innerHTML = `
    <span class="badge">${Math.round(state.view.scale * 100)}%</span>
    ${state.shapes.length ? `<span class="badge">${state.shapes.length} convex pieces</span>` : ""}
  `;
}

function paintMaskCanvas(mask, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const painted = ctx.createImageData(width, height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const v = mask[i] ? 255 : 0;
    painted.data[p] = v;
    painted.data[p + 1] = v;
    painted.data[p + 2] = v;
    painted.data[p + 3] = mask[i] ? 230 : 0;
  }
  ctx.putImageData(painted, 0, 0);
  return canvas;
}

function activeMask() {
  if (!state.sourceMask) return null;
  if (!els.invertMask.checked) return state.sourceMask;
  const out = new Uint8Array(state.sourceMask.length);
  for (let i = 0; i < out.length; i++) out[i] = state.sourceMask[i] ? 0 : 1;
  return out;
}

function refreshMaskView() {
  if (!state.sourceMask) return;
  const mask = activeMask();
  state.mask = mask;
  state.maskCanvas = paintMaskCanvas(mask, state.width, state.height);
  els.thumb.src = state.maskCanvas.toDataURL("image/png");
  render();
}

function setMaskFromImageData(imageData, name) {
  const { mask, width, height } = maskFromImageData(imageData, 128);
  state.name = name.replace(/\.[^.]+$/, "") || "mask";
  state.width = width;
  state.height = height;
  state.sourceMask = mask;
  state.shapes = [];
  refreshMaskView();
  els.fileName.textContent = name;
  els.fileSize.textContent = `${width} × ${height} px`;
  els.fileMeta.classList.add("visible");
  updateStats();
  enableSourceActions(true);
  fitView();
}

function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    toast("Please drop a PNG, JPG, or similar image.", true);
    return;
  }
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    setMaskFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), file.name);
    URL.revokeObjectURL(url);
    toast("Mask loaded.");
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast("Could not decode that image.", true);
  };
  img.src = url;
}

function startGeneration() {
  if (!state.mask || state.generating) return;
  if (!workerReady) createWorker();
  state.generating = true;
  state.shapes = [];
  enableSourceActions(true);
  els.generateBtn.disabled = true;
  els.cancelBtn.disabled = false;
  setProgress(8, "Tracing contours…");
  updateStats("generating");
  worker.postMessage({
    type: "generate",
    mask: state.mask,
    width: state.width,
    height: state.height,
    options: optionsFromForm(),
  });
}

function cancelGeneration() {
  worker?.postMessage({ type: "cancel" });
  els.cancelBtn.disabled = true;
  setProgress(Number.parseFloat(els.progressBar.style.width) || 40, "Cancelling…");
}

function finishGeneration(cancelled) {
  state.generating = false;
  els.progress.classList.add("hidden");
  enableSourceActions(true);
  updateStats(cancelled ? "cancelled" : "ready");
  render();
  if (!cancelled) toast(`${state.shapes.length} convex shapes ready.`);
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function onWheel(event) {
  if (!state.mask) return;
  event.preventDefault();
  const rect = els.canvas.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;
  const wx = (mx - state.view.x) / state.view.scale;
  const wy = (my - state.view.y) / state.view.scale;
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  state.view.scale = Math.min(32, Math.max(0.05, state.view.scale * factor));
  state.view.x = mx - wx * state.view.scale;
  state.view.y = my - wy * state.view.scale;
  render();
}

function onPointerDown(event) {
  if (!state.mask || event.button !== 0) return;
  state.pan.active = true;
  state.pan.x = event.clientX;
  state.pan.y = event.clientY;
  state.pan.vx = state.view.x;
  state.pan.vy = state.view.y;
  els.canvas.classList.add("panning");
  els.canvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!state.pan.active) return;
  state.view.x = state.pan.vx + (event.clientX - state.pan.x);
  state.view.y = state.pan.vy + (event.clientY - state.pan.y);
  render();
}

function onPointerUp(event) {
  state.pan.active = false;
  els.canvas.classList.remove("panning");
  try {
    els.canvas.releasePointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
}

function bindUi() {
  els.tolerance.addEventListener("input", () => {
    els.toleranceVal.textContent = Number(els.tolerance.value).toFixed(1);
  });
  els.colorize.addEventListener("change", render);
  els.invertMask.addEventListener("change", () => {
    if (!state.sourceMask) return;
    state.shapes = [];
    refreshMaskView();
    updateStats();
    enableSourceActions(true);
  });
  els.loadBtn.addEventListener("click", () => els.file.click());
  els.file.addEventListener("change", () => {
    const file = els.file.files?.[0];
    if (file) loadFile(file);
    els.file.value = "";
  });
  els.generateBtn.addEventListener("click", startGeneration);
  els.cancelBtn.addEventListener("click", cancelGeneration);
  els.exportVmfBtn.addEventListener("click", () => {
    const vmf = exportVmf(state.shapes, state.width, state.height, worldOptions());
    const base = state.name.replace(/\.[^.]+$/, "") || "shapes";
    downloadText(`${base}.vmf`, vmf, "text/plain");
    toast("VMF exported.");
  });
  els.exportSvgBtn.addEventListener("click", () => {
    const svg = exportSvg(state.shapes, state.width, state.height, state.maskCanvas.toDataURL("image/png"));
    downloadText(`${state.name}.svg`, svg, "image/svg+xml");
    toast("SVG exported.");
  });

  ["dragenter", "dragover"].forEach((type) => {
    els.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    els.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove("dragover");
    });
  });
  els.dropzone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    if (event.target.closest("#dropzone")) return;
    const file = event.dataTransfer?.files?.[0];
    if (file?.type.startsWith("image/")) loadFile(file);
  });

  els.canvas.addEventListener("wheel", onWheel, { passive: false });
  els.canvas.addEventListener("pointerdown", onPointerDown);
  els.canvas.addEventListener("pointermove", onPointerMove);
  els.canvas.addEventListener("pointerup", onPointerUp);
  els.canvas.addEventListener("pointercancel", onPointerUp);
  els.zoomIn.addEventListener("click", () => {
    state.view.scale = Math.min(32, state.view.scale * 1.2);
    render();
  });
  els.zoomOut.addEventListener("click", () => {
    state.view.scale = Math.max(0.05, state.view.scale / 1.2);
    render();
  });
  els.zoomFit.addEventListener("click", fitView);

  window.addEventListener("resize", () => {
    resizeCanvas();
    if (state.mask) fitView();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) startGeneration();
    if (event.key === "Escape") cancelGeneration();
  });
}

createWorker();
bindUi();
resizeCanvas();
enableSourceActions(false);
updateStats();
els.toleranceVal.textContent = Number(els.tolerance.value).toFixed(1);

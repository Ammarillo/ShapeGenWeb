import { generateShapes } from "./geometry.js";

let cancelled = false;

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }
  if (msg.type !== "generate") return;

  cancelled = false;
  const { mask, width, height, options } = msg;
  const binary = mask instanceof Uint8Array ? mask : new Uint8Array(mask);

  try {
    const shapes = generateShapes(binary, width, height, options, {
      isCancelled: () => cancelled,
      onProgress: (current, stats) => {
        self.postMessage({
          type: "progress",
          shapes: current,
          stats,
          cancelled,
        });
      },
    });
    self.postMessage({
      type: cancelled ? "cancelled" : "done",
      shapes,
      stats: {
        count: shapes.length,
        elapsed: 0,
      },
    });
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err?.message || String(err),
    });
  }
};

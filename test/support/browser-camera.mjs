// Synthetic media only: the application still uses its real html5-qrcode decoder.
// This helper provides no evidence about physical cameras or device flash support.
export async function installSyntheticCamera(pageOrContext) {
  await pageOrContext.addInitScript(() => {
    if (window.__phase2cCamera) return;

    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    let qrImage = null;
    let qrSize = 384;
    const pending = [];
    const state = {
      calls: [],
      tracks: [],
      stopped: 0,
      stopCalls: 0,
      torchRequests: [],
      failExact: false,
      delayed: false,
      release() {
        state.delayed = false;
        pending.splice(0).forEach(resolve => resolve());
      },
      async setQr(svg) {
        if (!svg) {
          qrImage = null;
          paint();
          return;
        }
        // An integer module scale keeps common QR SVG viewBoxes crisp.
        const viewBox = String(svg).match(/viewBox=["']\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*["']/i);
        const modules = viewBox ? Number(viewBox[1]) : 0;
        // Keep the quiet zone inside the decoder's crop even when the app's
        // portrait video preview uses object-fit: cover on a square stream.
        qrSize = modules > 0 && modules <= 296
          ? Math.floor(296 / modules) * modules
          : 296;
        // React's inline SVG serialization may omit the XML namespace because
        // HTML already supplies it. An Image data URL needs a standalone SVG.
        const standaloneSvg = /<svg\b[^>]*\bxmlns=/.test(String(svg))
          ? String(svg)
          : String(svg).replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
        const image = new Image(qrSize, qrSize);
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error("Synthetic QR image failed to load"));
          image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(standaloneSvg);
        });
        qrImage = image;
        paint();
      }
    };
    window.__phase2cCamera = state;

    function paint() {
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (qrImage) {
        const offset = Math.floor((canvas.width - qrSize) / 2);
        context.drawImage(qrImage, offset, offset, qrSize, qrSize);
      }
    }
    paint();
    // Repaint even a stationary QR so Chromium emits continuous video frames.
    setInterval(paint, 50);

    const mediaDevices = navigator.mediaDevices || {};
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: mediaDevices });
    }
    Object.defineProperty(mediaDevices, "getUserMedia", {
      configurable: true,
      value: async constraints => {
        state.calls.push(JSON.parse(JSON.stringify(constraints || {})));
        if (constraints?.audio) throw new Error("Synthetic camera does not provide microphone access");
        const facingMode = constraints?.video?.facingMode;
        if (state.failExact && facingMode?.exact === "environment") {
          state.failExact = false;
          throw new DOMException("Synthetic exact camera unavailable", "OverconstrainedError");
        }
        if (state.delayed) await new Promise(resolve => pending.push(resolve));
        const stream = canvas.captureStream(20);
        for (const track of stream.getVideoTracks()) {
          const originalStop = track.stop.bind(track);
          let stopped = false;
          let requestedConstraints = {};
          Object.defineProperties(track, {
            getCapabilities: {
              configurable: true,
              value: () => ({
                width: { min: 640, max: 640 },
                height: { min: 640, max: 640 },
                aspectRatio: { min: 1, max: 1 },
                frameRate: { min: 20, max: 20 },
                facingMode: ["environment"],
                torch: true
              })
            },
            getSettings: {
              configurable: true,
              value: () => ({
                width: 640,
                height: 640,
                aspectRatio: 1,
                frameRate: 20,
                facingMode: "environment",
                deviceId: "phase2c-synthetic-camera"
              })
            },
            getConstraints: { configurable: true, value: () => requestedConstraints },
            applyConstraints: {
              configurable: true,
              value: async requested => {
                requestedConstraints = requested || {};
                for (const advanced of requested?.advanced || []) {
                  if (typeof advanced.torch === "boolean") state.torchRequests.push(advanced.torch);
                }
              }
            },
            stop: {
              configurable: true,
              value: () => {
                state.stopCalls += 1;
                if (!stopped) {
                  stopped = true;
                  state.stopped += 1;
                }
                originalStop();
              }
            }
          });
          state.tracks.push(track);
        }
        return stream;
      }
    });
    Object.defineProperty(mediaDevices, "enumerateDevices", {
      configurable: true,
      value: async () => [{
        deviceId: "phase2c-synthetic-camera",
        groupId: "phase2c-synthetic-media",
        kind: "videoinput",
        label: "Phase2C synthetic environment camera",
        toJSON() {
          return { deviceId: this.deviceId, groupId: this.groupId, kind: this.kind, label: this.label };
        }
      }]
    });
  });
}

export async function setCameraQr(page, svg) {
  await page.waitForFunction(() => Boolean(window.__phase2cCamera));
  await page.evaluate(value => window.__phase2cCamera.setQr(value), svg);
}

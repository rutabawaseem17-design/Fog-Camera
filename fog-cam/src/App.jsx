
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Camera,
  CameraOff,
  RefreshCw,
  Eraser,
  PenLine,
  Maximize,
  Sparkles,
} from "lucide-react";

import {
  initializeHandTracking,
  getIndexFinger,
  closeHandTracking,
} from "./handTracking";

import "./App.css";

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const lastPointRef = useRef(null);
  const animationRef = useRef(null);
  const modeRef = useRef("wipe");

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [trackingStatus, setTrackingStatus] = useState("off");
  const [mode, setMode] = useState("wipe");
  const [fogKey, setFogKey] = useState(0);

  modeRef.current = mode;

  // Create the fog layer.
  const paintFog = useCallback(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    if (!rect.width || !rect.height) return;

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    const ctx = canvas.getContext("2d");

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    const width = rect.width;
    const height = rect.height;

    // Main translucent fog.
    ctx.fillStyle = "rgba(229, 237, 231, 0.70)";
    ctx.fillRect(0, 0, width, height);

    // Soft cloudy condensation.
    for (let i = 0; i < 120; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const radius = 20 + Math.random() * 95;
      const alpha = 0.03 + Math.random() * 0.11;

      const gradient = ctx.createRadialGradient(
        x,
        y,
        0,
        x,
        y,
        radius
      );

      gradient.addColorStop(
        0,
        `rgba(255,255,255,${alpha})`
      );

      gradient.addColorStop(
        1,
        "rgba(255,255,255,0)"
      );

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tiny condensation droplets.
    for (let i = 0; i < 250; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const radius = 0.5 + Math.random() * 2;

      ctx.beginPath();

      ctx.fillStyle = `rgba(255,255,255,${
        0.15 + Math.random() * 0.35
      })`;

      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Start with no previous drawing point after refogging.
    lastPointRef.current = null;
  }, []);

  // Start the webcam.
  const startCamera = useCallback(async () => {
    setCameraError("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Camera access is unavailable. Open this site on localhost or HTTPS in Chrome."
      );
      return;
    }

    try {
      let stream;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;

      const video = videoRef.current;

      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        return;
      }

      video.srcObject = stream;
      await video.play();

      setCameraOn(true);
      setTrackingStatus("loading");
    } catch (error) {
      console.error("Camera startup failed:", error);

      const reasons = {
        NotAllowedError:
          "Camera permission is blocked. Click the camera icon beside the address bar and allow access.",
        NotFoundError:
          "No camera was found. Connect a webcam or check your laptop camera.",
        NotReadableError:
          "Your camera may be in use by another app. Close other camera apps and try again.",
        OverconstrainedError:
          "Your camera does not support the requested settings. Try again.",
        SecurityError:
          "Camera access is blocked. Use localhost or HTTPS.",
      };

      setCameraError(
        reasons[error.name] ||
          `Camera could not start (${error.name || "unknown error"}). Check browser permissions.`
      );
    }
  }, []);

  // Stop the webcam and tracking.
  const stopCamera = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    closeHandTracking();

    detectorRef.current = null;
    lastPointRef.current = null;

    setCameraOn(false);
    setTrackingStatus("off");
  }, []);

  // Refresh the fog when needed or when the canvas resizes.
  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    paintFog();

    const observer = new ResizeObserver(() => {
      paintFog();
    });

    observer.observe(canvas);

    return () => observer.disconnect();
  }, [paintFog, fogKey]);

  // Start hand tracking once the camera is running.
  useEffect(() => {
    if (!cameraOn) return;

    let cancelled = false;

    async function startTracking() {
      try {
        const detector = await initializeHandTracking();

        if (cancelled) return;

        detectorRef.current = detector;
        setTrackingStatus("ready");

        const detect = () => {
          if (cancelled) return;

          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (
            detectorRef.current &&
            video?.readyState >= 2 &&
            canvas
          ) {
            try {
              const tip = getIndexFinger(
                detectorRef.current,
                video
              );

              if (tip) {
                const rect = canvas.getBoundingClientRect();

                // The video and canvas share the same mirrored
                // display, so use the normalized tip coordinates.
                const point = {
                  x: tip.x * rect.width,
                  y: tip.y * rect.height,
                };

                const previous = lastPointRef.current;

                // Smooth small fingertip movements.
                const smooth = previous
                  ? {
                      x:
                        previous.x * 0.4 +
                        point.x * 0.6,
                      y:
                        previous.y * 0.4 +
                        point.y * 0.6,
                    }
                  : point;

                const ctx = canvas.getContext("2d");

                const radius =
                  modeRef.current === "wipe" ? 32 : 7;

                ctx.save();

                // Remove fog only where the valid index-finger
                // gesture moves.
                ctx.globalCompositeOperation = "destination-out";
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.lineWidth = radius * 2;

                if (previous) {
                  ctx.beginPath();
                  ctx.moveTo(previous.x, previous.y);
                  ctx.lineTo(smooth.x, smooth.y);
                  ctx.stroke();
                } else {
                  // Create a dot when a new valid gesture begins.
                  ctx.beginPath();
                  ctx.arc(
                    smooth.x,
                    smooth.y,
                    radius,
                    0,
                    Math.PI * 2
                  );
                  ctx.fill();
                }

                ctx.restore();

                lastPointRef.current = smooth;
              } else {
                // IMPORTANT:
                // Open palm, multiple raised fingers, or no hand
                // means no drawing. Reset the previous point so
                // a new gesture cannot connect to an old stroke.
                lastPointRef.current = null;
              }
            } catch (error) {
              console.error("Hand detection failed:", error);

              lastPointRef.current = null;
            }
          }

          animationRef.current =
            requestAnimationFrame(detect);
        };

        detect();
      } catch (error) {
        console.error("Hand tracking failed:", error);

        if (!cancelled) {
          setTrackingStatus("error");
        }
      }
    }

    startTracking();

    return () => {
      cancelled = true;

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }

      lastPointRef.current = null;
    };
  }, [cameraOn]);

  // Clean up when the component unmounts.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      closeHandTracking();
    };
  }, []);

  // Toggle fullscreen.
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch (error) {
      console.error("Fullscreen could not be opened:", error);
    }
  };

  return (
    <main className="fog-app">
      <video
        ref={videoRef}
        className={`live-video ${cameraOn ? "visible" : ""}`}
        autoPlay
        muted
        playsInline
      />

      <canvas
        ref={canvasRef}
        className="fog-overlay"
      />

      {!cameraOn && (
        <div className="camera-welcome">
          <div className="welcome-icon">
            <Sparkles size={32} />
          </div>

          <p className="welcome-kicker">
            YOUR LITTLE MIRROR
          </p>

          <h1>
            Meet me in the <em>mist.</em>
          </h1>

          <p className="welcome-copy">
            A foggy screen, your own reflection, and a little magic.
          </p>

          <button
            className="start-button"
            onClick={startCamera}
          >
            <Camera size={19} />
            Turn on camera
          </button>

          {cameraError && (
            <p className="camera-error">{cameraError}</p>
          )}

          <p className="privacy-note">
            <CameraOff size={14} />
            Camera stays in your browser. No video is uploaded.
          </p>
        </div>
      )}

      {cameraOn && (
        <>
          <header className="camera-topbar">
            <a
              className="camera-brand"
              href="#"
              aria-label="Fog Cam"
            >
              <Sparkles size={19} />
              fog cam<span>.</span>
            </a>

            <div className="camera-status">
              <span className="status-dot" />

              {trackingStatus === "ready"
                ? "HAND TRACKING READY"
                : trackingStatus === "loading"
                ? "LOADING HAND TRACKING"
                : trackingStatus === "error"
                ? "TRACKING ERROR"
                : "CAMERA ON"}
            </div>

            <button
              className="icon-button"
              onClick={toggleFullscreen}
              title="Toggle full screen"
              aria-label="Toggle full screen"
            >
              <Maximize size={19} />
            </button>
          </header>

          <div className="camera-instructions">
            {trackingStatus === "ready"
              ? "Raise only your index finger to wipe or write"
              : trackingStatus === "error"
              ? "Camera is on, but hand tracking failed. Check your internet connection."
              : "Your camera is on. Loading finger tracking…"}
          </div>

          <section className="camera-controls">
            <div className="mode-switch">
              <button
                className={
                  mode === "wipe"
                    ? "mode-button active"
                    : "mode-button"
                }
                onClick={() => {
                  setMode("wipe");
                  lastPointRef.current = null;
                }}
              >
                <Eraser size={17} />
                Wipe
              </button>

              <button
                className={
                  mode === "write"
                    ? "mode-button active"
                    : "mode-button"
                }
                onClick={() => {
                  setMode("write");
                  lastPointRef.current = null;
                }}
              >
                <PenLine size={17} />
                Write
              </button>
            </div>

            <button
              className="control-button"
              onClick={() => {
                lastPointRef.current = null;
                setFogKey((key) => key + 1);
              }}
            >
              <RefreshCw size={17} />
              Refog
            </button>

            <button
              className="control-button stop-button"
              onClick={stopCamera}
            >
              <CameraOff size={17} />
              Exit camera
            </button>
          </section>
        </>
      )}
    </main>
  );
}

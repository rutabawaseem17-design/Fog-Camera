
import {
  FilesetResolver,
  HandLandmarker,
} from "@mediapipe/tasks-vision";

let detector = null;
let loading = null;

export async function initializeHandTracking() {
  if (detector) return detector;
  if (loading) return loading;

  loading = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    const options = {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      },
      runningMode: "VIDEO",
      numHands: 1,
    };

    try {
      detector = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: {
          ...options.baseOptions,
          delegate: "GPU",
        },
      });
    } catch {
      detector = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: {
          ...options.baseOptions,
          delegate: "CPU",
        },
      });
    }

    return detector;
  })();

  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

// Returns the index fingertip only when the index finger
// is raised and the middle, ring, and pinky fingers are folded.
export function getIndexFinger(landmarker, video) {
  if (
    !landmarker ||
    !video ||
    video.readyState < 2
  ) {
    return null;
  }

  const results = landmarker.detectForVideo(
    video,
    performance.now()
  );

  const hand = results.landmarks?.[0];

  if (!hand || hand.length < 21) {
    return null;
  }

  const wrist = hand[0];

  // Measure distances between hand landmarks.
  // This works better than relying only on screen Y coordinates
  // when the hand is tilted or rotated.
  const distance = (pointA, pointB) =>
    Math.hypot(
      pointA.x - pointB.x,
      pointA.y - pointB.y
    );

  const isFingerExtended = (tipIndex, pipIndex) => {
    const tipDistance = distance(hand[tipIndex], wrist);
    const jointDistance = distance(hand[pipIndex], wrist);

    return tipDistance > jointDistance * 1.12;
  };

  const indexUp = isFingerExtended(8, 6);
  const middleUp = isFingerExtended(12, 10);
  const ringUp = isFingerExtended(16, 14);
  const pinkyUp = isFingerExtended(20, 18);

  // Only allow a single raised index finger.
  // The thumb can be positioned naturally.
  const indexFingerOnly =
    indexUp &&
    !middleUp &&
    !ringUp &&
    !pinkyUp;

  if (!indexFingerOnly) {
    return null;
  }

  const tip = hand[8];

  if (
    tip.x < 0 ||
    tip.x > 1 ||
    tip.y < 0 ||
    tip.y > 1
  ) {
    return null;
  }

  return tip;
}

export function closeHandTracking() {
  detector?.close();
  detector = null;
  loading = null;
}

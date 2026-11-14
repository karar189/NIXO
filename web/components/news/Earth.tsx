"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import createGlobe from "cobe";

export type EarthMarker = { location: [number, number]; size?: number };

/** NEAR / Intents desk markers (SF, NYC, London, Singapore, Tokyo, Zug). */
const DESK_MARKERS: EarthMarker[] = [
  { location: [37.77, -122.42], size: 0.06 },
  { location: [40.71, -74.0], size: 0.05 },
  { location: [51.5, -0.12], size: 0.05 },
  { location: [1.35, 103.82], size: 0.05 },
  { location: [35.68, 139.69], size: 0.045 },
  { location: [47.17, 8.52], size: 0.045 },
];

const AUTO_ROTATE = 0.003;
const DRAG = 0.005;

/**
 * Arcgenesis-style interactive Earth (cobe), sized to its container and centered.
 */
export function Earth({
  className = "",
  interactive = true,
  markers = DESK_MARKERS,
}: {
  className?: string;
  interactive?: boolean;
  markers?: EarthMarker[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phiRef = useRef(0.3);
  const thetaRef = useRef(2.8);
  const dragging = useRef(false);
  const pointer = useRef({ x: 0, y: 0, theta: 0, phi: 0 });
  const [size, setSize] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const next = Math.max(180, Math.floor(Math.min(w, h)));
      setSize(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size < 16) return;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr,
      width: size * dpr,
      height: size * dpr,
      phi: phiRef.current,
      theta: thetaRef.current,
      dark: 1,
      diffuse: 0.4,
      scale: 0.92,
      mapSamples: 80_000,
      mapBrightness: 5.5,
      mapBaseBrightness: 0.05,
      baseColor: [0.04, 0.06, 0.14],
      markerColor: [0.83, 0.996, 0.03],
      glowColor: [0.45, 0.52, 0.95],
      markers: markers.map((m) => ({ location: m.location, size: m.size ?? 0.04 })),
      offset: [0, 0],
      onRender: (state) => {
        state.phi = phiRef.current;
        state.theta = thetaRef.current;
        if (interactive && dragging.current) return;
        phiRef.current += AUTO_ROTATE;
      },
    });

    return () => globe.destroy();
  }, [size, interactive, markers]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!interactive) return;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragging.current = true;
      pointer.current = { x: e.clientX, y: e.clientY, theta: thetaRef.current, phi: phiRef.current };
    },
    [interactive],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!interactive || !dragging.current) return;
      const { x, y, theta, phi } = pointer.current;
      thetaRef.current = theta + (e.clientX - x) * DRAG;
      phiRef.current = Math.max(-0.5, Math.min(0.5, phi + (e.clientY - y) * DRAG));
    },
    [interactive],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!interactive) return;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragging.current = false;
    },
    [interactive],
  );

  return (
    <div
      ref={wrapRef}
      className={`relative mx-auto flex h-full w-full max-w-full items-center justify-center ${
        interactive ? "cursor-grab active:cursor-grabbing" : ""
      } ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <canvas
        ref={canvasRef}
        style={{ width: size || "100%", height: size || "100%", maxWidth: "100%", maxHeight: "100%" }}
        className="touch-none select-none [transform:scaleY(-1)]"
        aria-hidden
      />
    </div>
  );
}

"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/*
 * Ordered-dither field. Flowing value noise is sampled per screen cell and
 * quantised through a 4x4 Bayer matrix, so the gradient turns into the
 * chunky 1-bit pixel look. Three colours: A (dark) → C (mid) → B (bright).
 */

const VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform float uPx;
uniform float uLevels;
uniform float uScale;
uniform float uExposure;
uniform vec2 uMouse;
uniform float uHover;
out vec4 o;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h21(i); float b = h21(i + vec2(1.0, 0.0)); float c = h21(i + vec2(0.0, 1.0)); float d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
/* 2x2 Bayer cell: (0,0)=0 (1,0)=2 (0,1)=3 (1,1)=1 */
float m2(vec2 p) { return p.x * 2.0 + p.y * 3.0 - 4.0 * p.x * p.y; }
/* 4x4 Bayer built from two 2x2 levels, threshold in (0,1). */
float bayer(vec2 c) { vec2 a = mod(c, 2.0); vec2 b = mod(floor(c / 2.0), 2.0); return (4.0 * m2(a) + m2(b) + 0.5) / 16.0; }

void main() {
  vec2 cell = floor(gl_FragCoord.xy / uPx);
  vec2 uv = (cell + 0.5) * uPx / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * uScale;
  float t = uTime * 0.07;
  float warp = fbm(p * 2.2 - vec2(t * 0.8, t * 0.5));
  float n = fbm(p * 1.4 + vec2(t, -t * 0.6) + 0.45 * warp);
  float g = n * uExposure;
  vec2 d = (uv - uMouse) * vec2(aspect, 1.0);
  g += uHover * 0.35 * exp(-dot(d, d) * 22.0);
  float q = clamp(floor(g * uLevels + bayer(cell)) / uLevels, 0.0, 1.0);
  vec3 col = q < 0.5 ? mix(uA, uC, q * 2.0) : mix(uC, uB, (q - 0.5) * 2.0);
  o = vec4(col, 1.0);
}`;

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export default function DitherField({
  colorA = "#000000",
  colorB = "#d4fe08",
  colorC = "#191d32",
  pixel = 4,
  levels = 4,
  scale = 1,
  exposure = 1,
  speed = 1,
  hover = 1,
  className = "",
  style,
}: {
  colorA?: string;
  colorB?: string;
  colorC?: string;
  /** cell size in CSS px */
  pixel?: number;
  /** quantisation steps; 3–5 reads as dither, 16+ as a smooth gradient */
  levels?: number;
  scale?: number;
  exposure?: number;
  speed?: number;
  /** strength of the pointer lift, 0 disables */
  hover?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, powerPreference: "low-power" });
    if (!gl) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error("DitherField shader:", gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("DitherField link:", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);
    const u = (name: string) => gl.getUniformLocation(prog, name);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = Math.max(1, Math.floor(root.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(root.clientHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u("uRes"), canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(root);

    gl.uniform3f(u("uA"), ...rgb(colorA));
    gl.uniform3f(u("uB"), ...rgb(colorB));
    gl.uniform3f(u("uC"), ...rgb(colorC));
    gl.uniform1f(u("uPx"), Math.max(1, pixel * dpr));
    gl.uniform1f(u("uLevels"), Math.max(2, levels));
    gl.uniform1f(u("uScale"), scale);
    gl.uniform1f(u("uExposure"), exposure);

    let mx = 0.5;
    let my = 0.5;
    let hov = 0;
    let hovTarget = 0;
    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      mx = (e.clientX - r.left) / r.width;
      my = 1 - (e.clientY - r.top) / r.height;
      hovTarget = hover;
    };
    const onLeave = () => {
      hovTarget = 0;
    };
    if (hover > 0) {
      root.addEventListener("pointermove", onMove, { passive: true });
      root.addEventListener("pointerleave", onLeave);
    }

    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(root);

    const t0 = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      if (!reduced) frame = requestAnimationFrame(draw);
      if (!visible && !reduced) return;
      hov += (hovTarget - hov) * 0.08;
      gl.uniform1f(u("uTime"), ((now - t0) / 1000) * speed);
      gl.uniform2f(u("uMouse"), mx, my);
      gl.uniform1f(u("uHover"), hov);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      gl.deleteProgram(prog);
    };
  }, [colorA, colorB, colorC, pixel, levels, scale, exposure, speed, hover]);

  return (
    <div ref={rootRef} className={`dither-field ${className}`} style={{ background: colorA, ...style }} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

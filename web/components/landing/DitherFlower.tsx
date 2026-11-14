"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/*
 * Dithered flower. Petals, leaves and a stem are drawn procedurally in a
 * fragment shader, shaded, then quantised through an 8x8 Bayer matrix so the
 * form turns into a field of round dots — the 1-bit halftone look. The flower
 * blooms in petal by petal, then keeps swaying, breathing and shimmering.
 */

const VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

/* Pass 1: one texel per dot cell. R = quantised brightness, G = body mask. */
const SHADE_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uBloom;
uniform vec2 uMouse;
uniform float uHover;
out vec4 o;

const float PI = 3.14159265;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h21(i); float b = h21(i + vec2(1.0, 0.0)); float c = h21(i + vec2(0.0, 1.0)); float d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
/* 2x2 Bayer cell: (0,0)=0 (1,0)=2 (0,1)=3 (1,1)=1 */
float m2(vec2 p) { return p.x * 2.0 + p.y * 3.0 - 4.0 * p.x * p.y; }
/* 8x8 Bayer threshold in (0,1). */
float bayer8(vec2 c) {
  return (m2(mod(c, 2.0)) + 4.0 * m2(mod(floor(c / 2.0), 2.0)) + 16.0 * m2(mod(floor(c / 4.0), 2.0)) + 0.5) / 64.0;
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

/* One petal along +x from the origin: length L, half-width W, pointed at both ends. */
float petal(vec2 p, float L, float W, float curve) {
  p.y -= curve * p.x * p.x / max(L, 1e-4);
  float x = p.x / L;
  if (x <= 0.0 || x >= 1.0) return 0.0;
  float w = W * pow(sin(PI * x), 0.75);
  float ay = abs(p.y);
  if (ay >= w) return 0.0;
  float e = ay / w;                              /* 0 midline → 1 edge */
  float rim = pow(e, 3.5);                       /* bright rim, dark interior */
  float lit = 0.5 + 0.5 * (p.y / w);             /* one side catches light */
  float vein = exp(-pow(p.y / (0.04 * W + 1e-4), 2.0)) * 0.26;
  float veins = 0.06 * smoothstep(0.75, 1.0, abs(sin((e * 3.0 + x * 1.5) * PI)));
  return 0.03 + 0.7 * rim + 0.2 * x * x * x + 0.08 * lit * (1.0 - rim) + vein + veins;
}

float flower(vec2 p, int k, float L, float W, float base, float t, float bloom, float seed) {
  float g = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= k) break;
    float fi = float(i);
    float b = clamp(bloom * 1.5 - fi * 0.08, 0.0, 1.0);
    b = 1.0 - pow(1.0 - b, 3.0);
    float a = base + 2.0 * PI * fi / float(k) + (1.0 - b) * 1.1 + 0.04 * sin(t * 0.7 + fi * 1.7 + seed);
    float s = b * (1.0 + 0.03 * sin(t * 0.55 + fi * 2.1 + seed));
    vec2 q = rot(-a) * p;
    float pg = petal(q, L * s, W * s * (0.8 + 0.2 * b), 0.14 * sin(t * 0.28 + fi * 0.9 + seed));
    pg *= mod(fi, 2.0) < 0.5 ? 1.0 : 0.8;
    g = max(g, pg);
  }
  float r = length(p) / (0.17 * L);
  float core = smoothstep(1.0, 0.82, r) * (0.22 + 0.62 * smoothstep(0.15, 0.95, r));
  float ang = atan(p.y, p.x);
  float stamen = smoothstep(0.9, 0.3, abs(fract(ang / (2.0 * PI) * float(k) * 2.0) - 0.5) * 2.0) * smoothstep(0.35, 0.6, r) * smoothstep(1.05, 0.9, r) * 0.35;
  g = max(g, (core + stamen) * bloom);
  return g;
}

float leaf(vec2 p, float L, float W, float a, float t, float bloom, float seed) {
  float b = 1.0 - pow(1.0 - bloom, 3.0);
  vec2 q = rot(-(a + 0.05 * sin(t * 0.45 + seed))) * p;
  return petal(q, L * b, W * b, 0.22 * sin(t * 0.3 + seed)) * 0.7;
}

float stem(vec2 p, vec2 from, float len, float bend, float t, float bloom) {
  float y = from.y - p.y;
  float l = len * (1.0 - pow(1.0 - bloom, 3.0));
  if (y < 0.0 || y > l) return 0.0;
  float u = y / len;
  float xc = from.x + bend * u * u + 0.012 * sin(t * 0.5 + u * 4.0);
  float d = abs(p.x - xc);
  return d < 0.009 ? 0.42 : 0.0;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 uv = (cell + 0.5) / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime;

  /* pointer parallax + a slow drift */
  vec2 par = (uMouse - 0.5) * vec2(0.035, 0.025) + vec2(0.0, 0.006 * sin(t * 0.35));
  p -= par;

  float g = 0.0;
  /* main bloom, upper centre */
  vec2 cA = vec2(aspect * 0.55, 0.56);
  g = max(g, flower(p - cA, 6, 0.27, 0.074, 0.35, t, uBloom, 0.0));
  /* second, lower right, overlapping */
  vec2 cB = vec2(aspect * 0.86, 0.30);
  g = max(g, flower(p - cB, 5, 0.19, 0.058, 1.1, t, clamp(uBloom * 1.25 - 0.2, 0.0, 1.0), 2.3) * 0.9);
  /* small bud, upper left */
  vec2 cC = vec2(aspect * 0.2, 0.8);
  g = max(g, flower(p - cC, 5, 0.1, 0.036, 2.0, t, clamp(uBloom * 1.4 - 0.35, 0.0, 1.0), 4.1) * 0.8);

  /* stems + leaves */
  float lb = clamp(uBloom * 1.3, 0.0, 1.0);
  g = max(g, stem(p, cA, 0.62, 0.10, t, lb));
  g = max(g, stem(p, cB, 0.38, -0.06, t, lb));
  g = max(g, leaf(p - (cA + vec2(0.02, -0.33)), 0.32, 0.055, -0.55, t, lb, 1.0));
  g = max(g, leaf(p - (cA + vec2(0.05, -0.46)), 0.24, 0.045, -2.55, t, lb, 2.0));
  g = max(g, leaf(p - (cB + vec2(-0.02, -0.24)), 0.2, 0.04, -2.9, t, lb, 3.0));

  float body = step(0.001, g);

  /* shimmer over the form, sparse dust around it */
  float shimmer = (fbm(p * 16.0 + vec2(t * 0.22, -t * 0.17)) - 0.5) * 0.14;
  g = g > 0.0 ? g + shimmer : 0.0;
  float dust = smoothstep(0.66, 0.8, fbm(p * 3.2 + vec2(t * 0.04, t * 0.03))) * 0.24 * uBloom;
  g = max(g, dust);

  /* pointer lift */
  vec2 d = (uv - uMouse) * vec2(aspect, 1.0);
  g += uHover * 0.3 * exp(-dot(d, d) * 26.0) * step(0.001, g);

  /* fade toward the copy on the left, and at the bottom */
  float fade = smoothstep(0.0, 0.22, uv.x) * smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.92, uv.y);
  g *= fade;

  float levels = 4.0;
  float q = clamp(floor(g * levels + bayer8(cell)) / levels, 0.0, 1.0);
  /* the petal body sits as a dark shape under the dots so it reads against the bloom behind */
  float shade = body * fade * 0.9 * uBloom;
  o = vec4(q, shade, 0.0, 1.0);
}`;

/* Pass 2: full resolution, draws one round dot per cell from the shade texture. */
const DOT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uPx;
uniform vec3 uBright;
uniform vec3 uDim;
out vec4 o;
void main() {
  vec2 cell = floor(gl_FragCoord.xy / uPx);
  vec2 s = texelFetch(uTex, ivec2(cell), 0).rg;
  float q = s.r;
  vec2 f = fract(gl_FragCoord.xy / uPx) - 0.5;
  float dot_ = step(length(f), 0.17 + 0.23 * q);
  float a = q > 0.0 ? dot_ : 0.0;
  vec3 col = mix(uDim, uBright, q);
  o = vec4(col * a, max(a, s.g));
}`;

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export default function DitherFlower({
  active = true,
  bright = "#d4fe08",
  dim = "#4f6410",
  pixel = 5,
  speed = 1,
  hover = 1,
  className = "",
  style,
}: {
  /** starts the bloom-in; until then nothing is drawn */
  active?: boolean;
  bright?: string;
  dim?: string;
  /** dot cell size in CSS px */
  pixel?: number;
  speed?: number;
  hover?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bloomStart = useRef<number | null>(null);

  useEffect(() => {
    if (active && bloomStart.current === null) bloomStart.current = performance.now();
  }, [active]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, powerPreference: "low-power" });
    if (!gl) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error("DitherFlower shader:", gl.getShaderInfoLog(s));
      return s;
    };
    const link = (frag: string) => {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error("DitherFlower link:", gl.getProgramInfoLog(prog));
        return null;
      }
      return prog;
    };
    const shadeProg = link(SHADE_FRAG);
    const dotProg = link(DOT_FRAG);
    if (!shadeProg || !dotProg) return;
    gl.clearColor(0, 0, 0, 0);
    const us = (name: string) => gl.getUniformLocation(shadeProg, name);
    const ud = (name: string) => gl.getUniformLocation(dotProg, name);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.max(1, Math.round(pixel * dpr));
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let cw = 1;
    let ch = 1;
    const resize = () => {
      canvas.width = Math.max(1, Math.floor(root.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(root.clientHeight * dpr));
      cw = Math.max(1, Math.ceil(canvas.width / px));
      ch = Math.max(1, Math.ceil(canvas.height / px));
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.useProgram(shadeProg);
      gl.uniform2f(us("uRes"), cw, ch);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(root);

    gl.useProgram(dotProg);
    gl.uniform3f(ud("uBright"), ...rgb(bright));
    gl.uniform3f(ud("uDim"), ...rgb(dim));
    gl.uniform1f(ud("uPx"), px);
    gl.uniform1i(ud("uTex"), 0);

    let mx = 0.5;
    let my = 0.5;
    let hov = 0;
    let hovTarget = 0;
    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      mx = Math.min(1.5, Math.max(-0.5, x));
      my = Math.min(1.5, Math.max(-0.5, y));
      hovTarget = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? hover : 0;
    };
    const onLeave = () => {
      hovTarget = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(root);

    const t0 = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (!visible) return;
      const start = bloomStart.current;
      const bloom = start === null ? 0 : reduced ? 1 : Math.min(1, (now - start) / 2600);
      hov += (hovTarget - hov) * 0.08;
      /* pass 1: shade one texel per dot cell */
      gl.useProgram(shadeProg);
      gl.uniform1f(us("uTime"), reduced ? 0 : ((now - t0) / 1000) * speed);
      gl.uniform1f(us("uBloom"), bloom);
      gl.uniform2f(us("uMouse"), reduced ? 0.5 : mx, reduced ? 0.5 : my);
      gl.uniform1f(us("uHover"), reduced ? 0 : hov);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, cw, ch);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      /* pass 2: dots */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(dotProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (reduced && bloom >= 1) cancelAnimationFrame(frame);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      gl.deleteProgram(shadeProg);
      gl.deleteProgram(dotProg);
    };
  }, [bright, dim, pixel, speed, hover]);

  return (
    <div ref={rootRef} className={`dither-flower ${className}`} style={style} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

export type Vec = { x: number; y: number };

export type Assembly = 1 | -1;

export type Mech = {
  a0x: number;
  a0y: number;
  groundLen: number;
  groundAngle: number;
  crank: number;
  coupler: number;
  rocker: number;
  pu: number;
  pv: number;
  theta: number;
  assembly: Assembly;
};

export type Pose = {
  A: Vec;
  B: Vec;
  B0: Vec;
  P: Vec;
  mu: number;
};

export type SweepSample = {
  theta: number;
  pose: Pose | null;
};

export type LinkName = "crank" | "coupler" | "rocker" | "ground";

export type GrashofKind = "grashof" | "special" | "non";

export type Classification = {
  kind: GrashofKind;
  name: string;
  shortest: LinkName;
  rotatable: boolean;
  minQualityDeg: number | null;
  locks: number;
};

export const DEFAULT_MECH: Mech = {
  a0x: -80,
  a0y: -10,
  groundLen: 150,
  groundAngle: 0,
  crank: 50,
  coupler: 140,
  rocker: 110,
  pu: 90,
  pv: 52,
  theta: 0.7,
  assembly: 1,
};

export const PRESETS: { id: string; label: string; mech: Mech }[] = [
  { id: "crank-rocker", label: "Crank-rocker", mech: DEFAULT_MECH },
  {
    id: "hoekens",
    label: "Hoekens straight-line",
    mech: {
      a0x: -90,
      a0y: -30,
      groundLen: 100,
      groundAngle: 0,
      crank: 50,
      coupler: 125,
      rocker: 125,
      pu: 250,
      pv: 0,
      theta: 0.4,
      assembly: 1,
    },
  },
  {
    id: "drag-link",
    label: "Drag-link",
    mech: {
      a0x: -40,
      a0y: 0,
      groundLen: 50,
      groundAngle: 0.15,
      crank: 100,
      coupler: 80,
      rocker: 90,
      pu: 40,
      pv: 28,
      theta: 0.2,
      assembly: 1,
    },
  },
  {
    id: "triple",
    label: "Triple rocker",
    mech: {
      a0x: -70,
      a0y: 0,
      groundLen: 120,
      groundAngle: 0,
      crank: 75,
      coupler: 95,
      rocker: 85,
      pu: 60,
      pv: 36,
      theta: 1.1,
      assembly: -1,
    },
  },
];

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function b0Of(m: Mech): Vec {
  return {
    x: m.a0x + m.groundLen * Math.cos(m.groundAngle),
    y: m.a0y + m.groundLen * Math.sin(m.groundAngle),
  };
}

export function circleCircle(c0: Vec, r0: number, c1: Vec, r1: number, which: Assembly): Vec | null {
  const dx = c1.x - c0.x;
  const dy = c1.y - c0.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-8) return null;
  if (d > r0 + r1 + 1e-4) return null;
  if (d < Math.abs(r0 - r1) - 1e-4) return null;
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
  const mx = c0.x + (a * dx) / d;
  const my = c0.y + (a * dy) / d;
  const rx = (-dy * h) / d;
  const ry = (dx * h) / d;
  return which === 1 ? { x: mx + rx, y: my + ry } : { x: mx - rx, y: my - ry };
}

function angleBetween(u: Vec, v: Vec) {
  const nu = Math.hypot(u.x, u.y);
  const nv = Math.hypot(v.x, v.y);
  if (nu < 1e-9 || nv < 1e-9) return 0;
  const c = clamp((u.x * v.x + u.y * v.y) / (nu * nv), -1, 1);
  return Math.acos(c);
}

export function solve(m: Mech): Pose | null {
  if (m.crank < 1 || m.coupler < 1 || m.rocker < 1 || m.groundLen < 1) return null;
  const A = {
    x: m.a0x + m.crank * Math.cos(m.theta),
    y: m.a0y + m.crank * Math.sin(m.theta),
  };
  const B0 = b0Of(m);
  const B = circleCircle(A, m.coupler, B0, m.rocker, m.assembly);
  if (!B) return null;
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const vx = -uy;
  const vy = ux;
  const P = { x: A.x + ux * m.pu + vx * m.pv, y: A.y + uy * m.pu + vy * m.pv };
  const mu = angleBetween({ x: A.x - B.x, y: A.y - B.y }, { x: B0.x - B.x, y: B0.y - B.y });
  return { A, B, B0, P, mu };
}

export function toCouplerFrame(m: Mech, pose: Pose, point: Vec): { pu: number; pv: number } {
  const dx = pose.B.x - pose.A.x;
  const dy = pose.B.y - pose.A.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const vx = -uy;
  const vy = ux;
  const rx = point.x - pose.A.x;
  const ry = point.y - pose.A.y;
  return { pu: rx * ux + ry * uy, pv: rx * vx + ry * vy };
}

export function sweep(m: Mech, steps = 72): SweepSample[] {
  const out: SweepSample[] = [];
  for (let i = 0; i < steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    out.push({ theta, pose: solve({ ...m, theta }) });
  }
  return out;
}

export function classify(m: Mech, samples?: SweepSample[]): Classification {
  const links: { name: LinkName; len: number }[] = [
    { name: "crank", len: m.crank },
    { name: "coupler", len: m.coupler },
    { name: "rocker", len: m.rocker },
    { name: "ground", len: m.groundLen },
  ];
  const sorted = [...links].sort((a, b) => a.len - b.len);
  const s = sorted[0];
  const l = sorted[3];
  const other = sorted[1].len + sorted[2].len;
  const sl = s.len + l.len;
  const scale = Math.max(1, sl + other);
  let kind: GrashofKind;
  if (Math.abs(sl - other) < 1e-3 * scale) kind = "special";
  else if (sl < other) kind = "grashof";
  else kind = "non";

  let name = "Triple rocker";
  if (kind === "special") name = "Change-point";
  else if (kind === "non") name = "Triple rocker";
  else if (s.name === "crank") name = "Crank-rocker";
  else if (s.name === "ground") name = "Drag-link";
  else if (s.name === "coupler") name = "Grashof double-rocker";
  else name = "Rocker-crank";

  const data = samples ?? sweep(m);
  let locks = 0;
  let minQ = Infinity;
  let any = false;
  for (const s of data) {
    if (!s.pose) {
      locks += 1;
      continue;
    }
    any = true;
    const deg = (s.pose.mu * 180) / Math.PI;
    minQ = Math.min(minQ, Math.min(deg, 180 - deg));
  }
  return {
    kind,
    name,
    shortest: s.name,
    rotatable: locks === 0 && any,
    minQualityDeg: any ? minQ : null,
    locks,
  };
}

export function locusOf(samples: SweepSample[]): Vec[][] {
  const runs: Vec[][] = [];
  let cur: Vec[] = [];
  for (const s of samples) {
    if (!s.pose) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else {
      cur.push(s.pose.P);
    }
  }
  if (cur.length) runs.push(cur);
  if (runs.length > 1 && samples[0]?.pose && samples[samples.length - 1]?.pose) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    runs[0] = last.concat(first);
    runs.pop();
  }
  return runs;
}

export function resample(points: Vec[], n: number): Vec[] {
  if (points.length === 0) return [];
  if (points.length === 1) return Array.from({ length: n }, () => ({ ...points[0] }));
  const seg: number[] = [0];
  for (let i = 1; i < points.length; i++) seg.push(seg[i - 1] + dist(points[i - 1], points[i]));
  const total = seg[seg.length - 1] || 1;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * total;
    let k = 1;
    while (k < seg.length - 1 && seg[k] < t) k++;
    const span = seg[k] - seg[k - 1] || 1;
    const u = (t - seg[k - 1]) / span;
    const a = points[k - 1];
    const b = points[k];
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return out;
}

export function pathError(mechPts: Vec[], target: Vec[]): number {
  if (mechPts.length < 8 || target.length < 4) return 1e9;
  const T = resample(target, 24);
  const n = mechPts.length;
  let best = 1e9;
  for (const dir of [1, -1] as const) {
    for (let w = Math.max(6, Math.floor(n * 0.28)); w <= n; w += Math.max(1, Math.floor(n / 10))) {
      for (let s = 0; s < n; s += 2) {
        let acc = 0;
        for (let i = 0; i < T.length; i++) {
          const t = i / (T.length - 1);
          const idx = (s + dir * Math.round(t * (w - 1)) + n * 8) % n;
          const p = mechPts[idx];
          const ddx = T[i].x - p.x;
          const ddy = T[i].y - p.y;
          acc += ddx * ddx + ddy * ddy;
        }
        if (acc < best) best = acc;
      }
    }
  }
  return Math.sqrt(best / T.length);
}

function pathSize(target: Vec[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of target) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    span: Math.max(20, maxX - minX, maxY - minY),
  };
}

function loss(m: Mech, target: Vec[], span: number) {
  const samples = sweep(m, 48);
  const pts = samples.flatMap((s) => (s.pose ? [s.pose.P] : []));
  if (pts.length < 10) return 1e9;
  const err = pathError(pts, target);
  const info = classify(m, samples);
  let pen = 0;
  const sum = m.crank + m.coupler + m.rocker + m.groundLen;
  if (sum > span * 7) pen += (sum - span * 7) * 0.35;
  if (m.crank < span * 0.04) pen += span;
  const ratio =
    Math.max(m.crank, m.coupler, m.rocker, m.groundLen) /
    Math.min(m.crank, m.coupler, m.rocker, m.groundLen);
  if (ratio > 8) pen += (ratio - 8) * span * 0.15;
  if (info.minQualityDeg != null && info.minQualityDeg < 30) {
    pen += (30 - info.minQualityDeg) * span * 0.01;
  }
  if (!info.rotatable) pen += span * 0.08 * (info.locks / samples.length);
  return err + pen;
}

function jitter(m: Mech, step: number, salt: number): Mech {
  const pick = salt % 9;
  const next = { ...m };
  const bump = ((salt * 17) % 2 === 0 ? 1 : -1) * step;
  if (pick === 0) next.a0x += bump;
  else if (pick === 1) next.a0y += bump * 0.8;
  else if (pick === 2) next.groundLen = clamp(next.groundLen + bump, 12, 800);
  else if (pick === 3) next.groundAngle += bump * 0.01;
  else if (pick === 4) next.crank = clamp(next.crank + bump * 0.6, 8, 500);
  else if (pick === 5) next.coupler = clamp(next.coupler + bump, 8, 700);
  else if (pick === 6) next.rocker = clamp(next.rocker + bump, 8, 700);
  else if (pick === 7) next.pu += bump;
  else next.pv += bump * 0.8;
  if (salt % 23 === 0) next.assembly = next.assembly === 1 ? -1 : 1;
  return next;
}

function seedAt(cx: number, cy: number, span: number, i: number, assembly: Assembly): Mech {
  const ang = (i * 2.399) % (Math.PI * 2);
  const crank = span * (0.12 + ((i * 17) % 40) / 100);
  const coupler = span * (0.45 + ((i * 13) % 90) / 100);
  const rocker = span * (0.35 + ((i * 19) % 80) / 100);
  const ground = span * (0.5 + ((i * 11) % 100) / 120);
  return {
    a0x: cx + Math.cos(ang) * span * (0.3 + (i % 5) * 0.12),
    a0y: cy + Math.sin(ang) * span * (0.15 + (i % 4) * 0.1),
    groundLen: ground,
    groundAngle: ang * 0.25,
    crank,
    coupler,
    rocker,
    pu: coupler * (0.3 + ((i * 7) % 20) / 20),
    pv: span * (((i % 2 === 0 ? 1 : -1) * ((i * 3) % 25)) / 80),
    theta: 0,
    assembly,
  };
}

export function synthesize(target: Vec[]): { mech: Mech; rms: number } | null {
  if (target.length < 6) return null;
  const { cx, cy, span } = pathSize(target);
  const seeds: Mech[] = [];
  for (const assembly of [1, -1] as const) {
    for (const side of [-1, 1]) {
      seeds.push({
        a0x: cx - span * 0.9,
        a0y: cy + side * span * 0.15,
        groundLen: span * 1.15,
        groundAngle: 0,
        crank: span * 0.28,
        coupler: span * 0.95,
        rocker: span * 0.72,
        pu: span * 0.62,
        pv: side * span * 0.22,
        theta: 0.4,
        assembly,
      });
      seeds.push({
        a0x: cx - span * 0.4,
        a0y: cy - side * span * 0.55,
        groundLen: span * 0.85,
        groundAngle: side * 0.4,
        crank: span * 0.22,
        coupler: span * 1.2,
        rocker: span * 0.9,
        pu: span * 0.4,
        pv: side * span * 0.05,
        theta: 1,
        assembly,
      });
    }
    for (let i = 0; i < 70; i++) seeds.push(seedAt(cx, cy, span, i + (assembly === 1 ? 0 : 80), assembly));
  }

  const scored = seeds
    .map((m) => ({ m, e: loss(m, target, span) }))
    .filter((s) => s.e < 1e8)
    .sort((a, b) => a.e - b.e)
    .slice(0, 6);

  if (!scored.length) return null;

  for (const item of scored) {
    let step = span * 0.18;
    let current = item;
    for (let k = 0; k < 28; k++) {
      const trial = jitter(current.m, step, k + Math.round(current.e));
      const e = loss(trial, target, span);
      if (e < current.e) {
        current = { m: trial, e };
      } else {
        step *= 0.78;
      }
    }
    item.m = current.m;
    item.e = current.e;
  }

  scored.sort((a, b) => a.e - b.e);
  const best = scored[0];
  if (best.e > span * 1.4) return null;
  const pose = solve(best.m) ?? solve({ ...best.m, theta: 0.5 });
  return {
    mech: { ...best.m, theta: pose ? best.m.theta : 0 },
    rms: pathError(
      sweep(best.m, 48).flatMap((s) => (s.pose ? [s.pose.P] : [])),
      target,
    ),
  };
}

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Download,
  FlipHorizontal2,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Spline,
  X,
} from "lucide-react";
import {
  DEFAULT_MECH,
  PRESETS,
  b0Of,
  classify,
  locusOf,
  round1,
  solve,
  sweep,
  synthesize,
  toCouplerFrame,
  type Mech,
  type Vec,
} from "@/lib/kinematics";
import { downloadText, mechanismToDxf } from "@/lib/dxf";

const STORE_KEY = "locus-workshop-v1";

type Tool = "move" | "draw";
type DragWhat = "a0" | "b0" | "a" | "b" | "p" | "pan";

type View = { scale: number; panX: number; panY: number };

function loadStored(): { mech: Mech; target: Vec[] } | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { mech?: Mech; target?: Vec[] };
    if (!parsed.mech || typeof parsed.mech.crank !== "number") return null;
    return { mech: { ...DEFAULT_MECH, ...parsed.mech }, target: parsed.target ?? [] };
  } catch {
    return null;
  }
}

function cssVar(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function Studio() {
  const [mech, setMech] = useState<Mech>(DEFAULT_MECH);
  const [target, setTarget] = useState<Vec[]>([]);
  const [tool, setTool] = useState<Tool>("move");
  const [playing, setPlaying] = useState(false);
  const [rms, setRms] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<View>({ scale: 2.2, panX: 360, panY: 280 });
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ what: DragWhat; px: number; py: number; panX: number; panY: number } | null>(null);
  const drawing = useRef<Vec[] | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const mechRef = useRef(mech);
  mechRef.current = mech;

  const samples = useMemo(
    () => sweep({ ...mech, theta: 0 }),
    [
      mech.a0x,
      mech.a0y,
      mech.groundLen,
      mech.groundAngle,
      mech.crank,
      mech.coupler,
      mech.rocker,
      mech.pu,
      mech.pv,
      mech.assembly,
    ],
  );

  const info = useMemo(() => classify(mech, samples), [mech, samples]);
  const pose = solve(mech);
  const runs = useMemo(() => locusOf(samples), [samples]);

  useEffect(() => {
    const stored = loadStored();
    if (stored) {
      setMech(stored.mech);
      setTarget(stored.target);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORE_KEY, JSON.stringify({ mech, target }));
  }, [mech, target, ready]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setMech((m) => ({ ...m, theta: m.theta + dt * 1.4 }));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setMech((m) => ({ ...m, theta: m.theta + 0.04 }));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setMech((m) => ({ ...m, theta: m.theta - 0.04 }));
      } else if (event.key === " ") {
        event.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fit = (nextMech = mechRef.current, nextTarget = target) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const pts: Vec[] = [ { x: nextMech.a0x, y: nextMech.a0y }, b0Of(nextMech), ...nextTarget ];
    const poseNow = solve(nextMech);
    if (poseNow) pts.push(poseNow.A, poseNow.B, poseNow.P);
    for (const run of locusOf(sweep(nextMech))) pts.push(...run);
    if (!pts.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const bw = Math.max(40, maxX - minX);
    const bh = Math.max(40, maxY - minY);
    const scale = Math.max(0.4, Math.min(8, Math.min((w - 64) / bw, (h - 64) / bh)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView({ scale, panX: w / 2 - cx * scale, panY: h / 2 + cy * scale });
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => {
      setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    });
    observer.observe(wrap);
    setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    return () => observer.disconnect();
  }, []);

  const sized = size.w > 20;
  useEffect(() => {
    if (!ready || !sized) return;
    const frame = requestAnimationFrame(() => fit(mechRef.current, target));
    return () => cancelAnimationFrame(frame);
  }, [ready, sized]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ink = cssVar("--color-fg", "#1c1915");
    const muted = cssVar("--color-muted", "#6b645c");
    const paper = cssVar("--color-bg", "#e7e1d6");
    const copper = cssVar("--color-primary", "#8c3d1e");
    const grid = cssVar("--color-grid", "#ddd6cb");
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);

    const { scale, panX, panY } = view;
    const sx = (p: Vec) => panX + p.x * scale;
    const sy = (p: Vec) => panY - p.y * scale;

    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    const step = scale > 3 ? 10 : 20;
    const x0 = (0 - panX) / scale;
    const y0 = (panY - h) / scale;
    const x1 = (w - panX) / scale;
    const y1 = (panY - 0) / scale;
    for (let x = Math.floor(Math.min(x0, x1) / step) * step; x < Math.max(x0, x1); x += step) {
      ctx.moveTo(sx({ x, y: 0 }), 0);
      ctx.lineTo(sx({ x, y: 0 }), h);
    }
    for (let y = Math.floor(Math.min(y0, y1) / step) * step; y < Math.max(y0, y1); y += step) {
      ctx.moveTo(0, sy({ x: 0, y }));
      ctx.lineTo(w, sy({ x: 0, y }));
    }
    ctx.stroke();
    ctx.restore();

    const drawPoly = (pts: Vec[], color: string, width: number, dash: number[] = []) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(sx(pts[0]), sy(pts[0]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i]), sy(pts[i]));
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    for (const run of runs) drawPoly(run, copper, 1.5);
    if (target.length > 1) drawPoly(target, ink, 1.25, [5, 4]);

    const A0 = { x: mech.a0x, y: mech.a0y };
    const B0 = b0Of(mech);
    if (!pose) {
      drawPoly([A0, B0], muted, 2);
      joint(ctx, sx(A0), sy(A0), ink, true);
      joint(ctx, sx(B0), sy(B0), ink, true);
      ctx.fillStyle = copper;
      ctx.font = "500 14px IBM Plex Sans, sans-serif";
      ctx.fillText("Locked at this crank angle", 16, h - 20);
      return;
    }

    const poor = Math.min(pose.mu, Math.PI - pose.mu) < (40 * Math.PI) / 180;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawPoly([A0, B0], muted, 3);
    drawPoly([A0, pose.A], ink, 4);
    drawPoly([pose.A, pose.B], ink, 4);
    drawPoly([pose.B, B0], poor ? copper : ink, 4);
    drawPoly([pose.A, pose.P], copper, 1.5, [3, 3]);

    joint(ctx, sx(A0), sy(A0), ink, true);
    joint(ctx, sx(B0), sy(B0), ink, true);
    joint(ctx, sx(pose.A), sy(pose.A), ink, false);
    joint(ctx, sx(pose.B), sy(pose.B), ink, false);
    ctx.beginPath();
    ctx.arc(sx(pose.P), sy(pose.P), 5, 0, Math.PI * 2);
    ctx.fillStyle = copper;
    ctx.fill();

    if (hover) {
      const map: Record<string, Vec> = { a0: A0, b0: B0, a: pose.A, b: pose.B, p: pose.P };
      const p = map[hover];
      if (p) {
        ctx.beginPath();
        ctx.arc(sx(p), sy(p), 12, 0, Math.PI * 2);
        ctx.strokeStyle = copper;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }, [mech, pose, runs, target, view, hover, size]);

  const worldFromEvent = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { scale, panX, panY } = viewRef.current;
    return {
      x: (event.clientX - rect.left - panX) / scale,
      y: (panY - (event.clientY - rect.top)) / scale,
    };
  };

  const pick = (p: Vec): DragWhat | null => {
    const poseNow = solve(mechRef.current);
    const { scale } = viewRef.current;
    const slop = 14 / scale;
    const pts: { id: DragWhat; at: Vec }[] = [
      { id: "p", at: poseNow?.P ?? p },
      { id: "a", at: poseNow?.A ?? p },
      { id: "b", at: poseNow?.B ?? p },
      { id: "a0", at: { x: mechRef.current.a0x, y: mechRef.current.a0y } },
      { id: "b0", at: b0Of(mechRef.current) },
    ];
    if (!poseNow) {
      pts.splice(0, 3);
    }
    let best: { id: DragWhat; d: number } | null = null;
    for (const item of pts) {
      const d = Math.hypot(item.at.x - p.x, item.at.y - p.y);
      if (d < slop && (!best || d < best.d)) best = { id: item.id, d };
    }
    return best?.id ?? null;
  };

  const applyDrag = (what: DragWhat, p: Vec) => {
    setMech((m) => {
      const poseNow = solve(m);
      if (what === "a0") {
        const fixed = b0Of(m);
        const groundLen = Math.max(12, Math.hypot(fixed.x - p.x, fixed.y - p.y));
        return {
          ...m,
          a0x: p.x,
          a0y: p.y,
          groundLen,
          groundAngle: Math.atan2(fixed.y - p.y, fixed.x - p.x),
        };
      }
      if (what === "b0") {
        const groundLen = Math.max(12, Math.hypot(p.x - m.a0x, p.y - m.a0y));
        return { ...m, groundLen, groundAngle: Math.atan2(p.y - m.a0y, p.x - m.a0x) };
      }
      if (what === "a") {
        return {
          ...m,
          theta: Math.atan2(p.y - m.a0y, p.x - m.a0x),
          crank: Math.max(8, Math.min(480, Math.hypot(p.x - m.a0x, p.y - m.a0y))),
        };
      }
      if (what === "b" && poseNow) {
        return {
          ...m,
          coupler: Math.max(8, Math.min(640, Math.hypot(p.x - poseNow.A.x, p.y - poseNow.A.y))),
          rocker: Math.max(8, Math.min(640, Math.hypot(p.x - poseNow.B0.x, p.y - poseNow.B0.y))),
        };
      }
      if (what === "p" && poseNow) {
        const frame = toCouplerFrame(m, poseNow, p);
        return { ...m, pu: frame.pu, pv: frame.pv };
      }
      return m;
    });
  };

  const chart = samples.map((s) => ({
    deg: Math.round((s.theta * 180) / Math.PI),
    mu: s.pose ? Math.round((s.pose.mu * 180) / Math.PI) : null,
  }));
  const crankDeg = ((mech.theta * 180) / Math.PI) % 360;
  const quality = pose ? Math.min((pose.mu * 180) / Math.PI, 180 - (pose.mu * 180) / Math.PI) : null;

  const onExport = () => {
    const dxf = mechanismToDxf(mech);
    if (!dxf) {
      setNote("This position is locked, so there is no DXF to cut. Scrub the crank off the dead point.");
      return;
    }
    downloadText("locus-linkage.dxf", dxf, "application/dxf");
    downloadText("locus-linkage.locus.json", JSON.stringify({ mech, target }, null, 2), "application/json");
    setNote("Downloaded a DXF in millimeters and the mechanism file.");
  };

  const onFit = () => {
    setNote("Fitting a four-bar to the path…");
    window.setTimeout(() => {
      const result = synthesize(target);
      if (!result) {
        setNote("No four-bar stayed close to that curve. Draw a smoother stroke and try again.");
        setRms(null);
        return;
      }
      setMech(result.mech);
      setRms(result.rms);
      setNote(null);
      requestAnimationFrame(() => fit(result.mech, target));
    }, 30);
  };

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4">
        <div className="min-w-0">
          <p className="font-display text-xl leading-none">Locus</p>
          <p className="hidden text-xs text-muted sm:block">Draw the motion. Keep the mechanism.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPlanOpen(true)}
            className="h-11 rounded-full bg-primary px-4 text-sm font-medium text-primary-fg"
          >
            $5.99/mo
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div ref={wrapRef} className="relative min-h-72 flex-1">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 touch-none"
            onPointerDown={(event) => {
              const p = worldFromEvent(event);
              if (tool === "draw") {
                drawing.current = [p];
                setTarget([p]);
                setRms(null);
                event.currentTarget.setPointerCapture(event.pointerId);
                return;
              }
              const hit = pick(p);
              drag.current = {
                what: hit ?? "pan",
                px: event.clientX,
                py: event.clientY,
                panX: viewRef.current.panX,
                panY: viewRef.current.panY,
              };
              if (hit) applyDrag(hit, p);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const p = worldFromEvent(event);
              if (tool === "draw" && drawing.current) {
                const last = drawing.current[drawing.current.length - 1];
                if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 2.5) {
                  drawing.current = [...drawing.current, p];
                  setTarget(drawing.current);
                }
                return;
              }
              if (!drag.current) {
                setHover(pick(p));
                return;
              }
              if (drag.current.what === "pan") {
                setView((v) => ({
                  ...v,
                  panX: drag.current!.panX + (event.clientX - drag.current!.px),
                  panY: drag.current!.panY + (event.clientY - drag.current!.py),
                }));
                return;
              }
              applyDrag(drag.current.what, p);
            }}
            onPointerUp={() => {
              drag.current = null;
              drawing.current = null;
            }}
            onPointerLeave={() => setHover(null)}
            onWheel={(event) => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const rect = canvas.getBoundingClientRect();
              const sx = event.clientX - rect.left;
              const sy = event.clientY - rect.top;
              const factor = event.deltaY > 0 ? 0.92 : 1.08;
              setView((v) => {
                const scale = Math.max(0.35, Math.min(10, v.scale * factor));
                const wx = (sx - v.panX) / v.scale;
                const wy = (v.panY - sy) / v.scale;
                return { scale, panX: sx - wx * scale, panY: sy + wy * scale };
              });
            }}
          />

          <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap gap-2 sm:inset-x-3">
            <div className="pointer-events-auto flex flex-wrap gap-2">
              <ToolButton active={tool === "move"} onClick={() => setTool("move")} label="Move">
                <Spline className="size-4" />
                Move
              </ToolButton>
              <ToolButton active={tool === "draw"} onClick={() => setTool("draw")} label="Draw path">
                <Pencil className="size-4" />
                Draw path
              </ToolButton>
              <ToolButton
                active={false}
                onClick={() => setPlaying((p) => !p)}
                label={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                {playing ? "Pause" : "Play"}
              </ToolButton>
              <ToolButton active={false} onClick={() => fit()} label="Fit view">
                <RotateCcw className="size-4" />
                Fit
              </ToolButton>
            </div>
          </div>

          <p className="pointer-events-none absolute bottom-3 left-3 max-w-xs text-xs text-muted">
            {tool === "draw"
              ? "Draw the stroke the coupler point should follow, then fit."
              : "Drag a pivot. Empty board pans. Scroll to zoom."}
          </p>
        </div>

        <aside className="flex max-h-[48dvh] w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-border bg-surface p-4 lg:max-h-none lg:w-96 lg:border-t-0 lg:border-l">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-wide text-muted uppercase">Certificate</p>
              <h1 className="font-display text-2xl leading-tight">{info.name}</h1>
            </div>
            <label className="text-xs text-muted">
              Template
              <select
                className="mt-1 block h-11 rounded-lg border border-border bg-bg px-2 text-sm text-fg"
                value=""
                onChange={(event) => {
                  const preset = PRESETS.find((item) => item.id === event.target.value);
                  if (!preset) return;
                  setMech(preset.mech);
                  setTarget([]);
                  setRms(null);
                  setNote(null);
                  setPlaying(false);
                  requestAnimationFrame(() => fit(preset.mech, []));
                }}
              >
                <option value="">Load…</option>
                {PRESETS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Mobility" value="1 DOF" />
            <Stat label="Grashof" value={info.kind === "grashof" ? "Yes" : info.kind === "special" ? "Change-point" : "No"} />
            <Stat label="Input" value={info.rotatable ? "Full turn" : `Locks in ${info.locks} steps`} />
            <Stat
              label="Min transmission"
              value={info.minQualityDeg == null ? "—" : `${round1(info.minQualityDeg)}°`}
              warn={info.minQualityDeg != null && info.minQualityDeg < 40}
            />
          </dl>

          {!pose && (
            <p className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary">
              This crank angle is a lock. Scrub off it, flip the branch, or shorten a link.
            </p>
          )}
          {pose && quality != null && quality < 40 && (
            <p className="rounded-lg border border-border bg-bg px-3 py-2 text-sm">
              Transmission is {round1(quality)}° here. Below 40° the rocker takes load poorly.
            </p>
          )}
          {rms != null && (
            <p className="text-sm text-muted">
              Path fit {round1(rms)} mm RMS on the closest crank window. Four-bars close their curve; an open
              sketch is matched along the best arc.
            </p>
          )}
          {note && <p className="text-sm text-muted">{note}</p>}

          <div className="h-36 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="deg"
                  tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                  stroke="var(--color-border)"
                  unit="°"
                />
                <YAxis
                  domain={[0, 180]}
                  width={32}
                  tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                  stroke="var(--color-border)"
                />
                <Tooltip
                  formatter={(value) => [`${value}°`, "Transmission"]}
                  labelFormatter={(label) => `Crank ${label}°`}
                />
                <ReferenceLine y={40} stroke="var(--color-primary)" strokeDasharray="3 3" />
                <ReferenceLine y={140} stroke="var(--color-primary)" strokeDasharray="3 3" />
                <ReferenceLine x={Math.round(((crankDeg % 360) + 360) % 360)} stroke="var(--color-fg)" />
                <Line type="monotone" dataKey="mu" stroke="var(--color-fg)" dot={false} strokeWidth={2} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted">Transmission angle against crank angle. Copper lines mark 40° and 140°.</p>

          <label className="block text-xs text-muted">
            Crank angle {round1(((crankDeg % 360) + 360) % 360)}°
            <input
              type="range"
              min={0}
              max={360}
              value={((crankDeg % 360) + 360) % 360}
              onChange={(event) => setMech((m) => ({ ...m, theta: (Number(event.target.value) * Math.PI) / 180 }))}
              className="mt-2 h-11 w-full accent-primary"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <Length label="Crank" value={mech.crank} onChange={(crank) => setMech((m) => ({ ...m, crank }))} />
            <Length label="Coupler" value={mech.coupler} onChange={(coupler) => setMech((m) => ({ ...m, coupler }))} />
            <Length label="Rocker" value={mech.rocker} onChange={(rocker) => setMech((m) => ({ ...m, rocker }))} />
            <Length
              label="Ground"
              value={mech.groundLen}
              onChange={(groundLen) => setMech((m) => ({ ...m, groundLen }))}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-bg px-3 text-sm"
              onClick={() => setMech((m) => ({ ...m, assembly: m.assembly === 1 ? -1 : 1 }))}
            >
              <FlipHorizontal2 className="size-4" />
              Other branch
            </button>
            <button
              type="button"
              disabled={target.length < 8}
              onClick={onFit}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-fg px-3 text-sm text-surface disabled:opacity-40"
            >
              Fit four-bar
            </button>
            {target.length > 0 && (
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm"
                onClick={() => {
                  setTarget([]);
                  setRms(null);
                }}
              >
                <X className="size-4" />
                Clear path
              </button>
            )}
            <button
              type="button"
              onClick={onExport}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-bg px-3 text-sm"
            >
              <Download className="size-4" />
              Export DXF
            </button>
          </div>
          <p className="text-xs text-muted">Lengths in millimeters. Saved on this device.</p>
        </aside>
      </div>

      <Dialog.Root open={planOpen} onOpenChange={setPlanOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-fg/40" />
          <Dialog.Content className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-md -translate-y-1/2 rounded-xl border border-border bg-surface p-5 text-fg shadow-lg">
            <Dialog.Title className="font-display text-2xl">Locus, $5.99 a month</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted">
              One plan. The workshop, path fitting, the defect certificate, and DXF export. No feature
              ladder and no commercial-use cap. This preview already has the full workshop open. Nothing is
              charged here.
            </Dialog.Description>
            <div className="mt-5 flex justify-end">
              <Dialog.Close className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg">
                Keep designing
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function joint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  ground: boolean,
) {
  ctx.beginPath();
  ctx.arc(x, y, ground ? 6 : 5, 0, Math.PI * 2);
  ctx.fillStyle = ground ? color : cssPaper();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
}

function cssPaper() {
  return cssVar("--color-surface", "#f6f3ec");
}

function ToolButton({
  children,
  active,
  onClick,
  label,
}: {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-11 items-center gap-2 rounded-full border px-3 text-sm ${
        active ? "border-fg bg-fg text-surface" : "border-border bg-surface text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-sm font-medium ${warn ? "text-primary" : "text-fg"}`}>{value}</dd>
    </div>
  );
}

function Length({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="text-xs text-muted">
      {label}
      <input
        type="number"
        min={8}
        max={800}
        step={1}
        value={round1(value)}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.max(8, Math.min(800, next)));
        }}
        className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-2 text-sm text-fg"
      />
    </label>
  );
}

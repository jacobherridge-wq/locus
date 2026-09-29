import { b0Of, solve, type Mech, type Vec } from "@/lib/kinematics";

function bar(a: Vec, b: Vec, width: number): Vec[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

function lwpolyline(pts: Vec[]) {
  const body = [
    "0",
    "LWPOLYLINE",
    "8",
    "LINKS",
    "90",
    String(pts.length),
    "70",
    "1",
  ];
  for (const p of pts) {
    body.push("10", p.x.toFixed(4), "20", p.y.toFixed(4));
  }
  return body;
}

function circle(c: Vec, r: number) {
  return ["0", "CIRCLE", "8", "HOLES", "10", c.x.toFixed(4), "20", c.y.toFixed(4), "40", r.toFixed(4)];
}

export function mechanismToDxf(m: Mech): string | null {
  const pose = solve(m);
  if (!pose) return null;
  const A0 = { x: m.a0x, y: m.a0y };
  const width = 10;
  const hole = 3.2;
  const ents = [
    ...lwpolyline(bar(A0, pose.A, width)),
    ...lwpolyline(bar(pose.A, pose.B, width)),
    ...lwpolyline(bar(pose.B0, pose.B, width)),
    ...lwpolyline(bar(A0, b0Of(m), 14)),
    ...circle(A0, hole),
    ...circle(pose.A, hole),
    ...circle(pose.B, hole),
    ...circle(pose.B0, hole),
    ...circle(pose.P, hole * 0.75),
  ];
  return [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$INSUNITS",
    "70",
    "4",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    ...ents,
    "0",
    "ENDSEC",
    "0",
    "EOF",
    "",
  ].join("\n");
}

export function downloadText(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

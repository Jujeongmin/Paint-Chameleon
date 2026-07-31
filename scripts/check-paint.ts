/**
 * Body paint: dab shape, and where a joined stroke is allowed to put paint.
 *
 * Both properties are geometric, so both can be measured without a renderer —
 * the meshes come from buildPartGeometries, the same call Humanoid renders,
 * and strokeSteps is the stroke's own choice of points with the canvas taken
 * out of it.
 */
import * as THREE from "three";
import {
  BODY_PARTS,
  GRID_COLS,
  GRID_ROWS,
  PART_CELL,
  SURFACE_SIZE,
  strokeSteps,
  type BodyPart,
} from "../game/src/game/paint";
import { buildPartGeometries } from "../game/src/game/bodyGeometry";
import { BODIES } from "../game/src/game/bodies";
import { BRUSH, PAINT } from "../game/src/game/constants";

let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ---------------------------------------------------------------- dab shape */

/**
 * How elongated a circle drawn in texture space lands on the surface: the
 * ratio of the two singular values of the UV->world Jacobian. 1 is round.
 */
interface Sample {
  ratio: number;
  /** World area, so the crowd of tiny triangles at a pole can't outvote the
   *  broad sides that most paint actually lands on. */
  area: number;
}

function triSample(
  p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3,
  t0: THREE.Vector2, t1: THREE.Vector2, t2: THREE.Vector2
): Sample | null {
  const e1 = p1.clone().sub(p0);
  const e2 = p2.clone().sub(p0);
  const d1 = t1.clone().sub(t0);
  const d2 = t2.clone().sub(t0);
  const det = d1.x * d2.y - d2.x * d1.y;
  if (Math.abs(det) < 1e-12) return null;

  const du = e1.clone().multiplyScalar(d2.y).addScaledVector(e2, -d1.y).divideScalar(det);
  const dv = e1.clone().multiplyScalar(-d2.x).addScaledVector(e2, d1.x).divideScalar(det);

  // Singular values of the 3x2 [du dv], via the eigenvalues of its 2x2 metric.
  const a = du.dot(du), b = du.dot(dv), c = dv.dot(dv);
  const tr = a + c;
  const disc = Math.max(0, (tr * tr) / 4 - (a * c - b * b));
  const l1 = tr / 2 + Math.sqrt(disc);
  const l2 = tr / 2 - Math.sqrt(disc);
  if (l2 <= 1e-18) return null;

  return { ratio: Math.sqrt(l1 / l2), area: e1.clone().cross(e2).length() / 2 };
}

function anisotropy(geometry: THREE.BufferGeometry): (p: number) => number {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const index = geometry.index;
  const samples: Sample[] = [];
  const count = index ? index.count : pos.count;

  for (let i = 0; i < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    const s = triSample(
      new THREE.Vector3().fromBufferAttribute(pos, ia),
      new THREE.Vector3().fromBufferAttribute(pos, ib),
      new THREE.Vector3().fromBufferAttribute(pos, ic),
      new THREE.Vector2().fromBufferAttribute(uv, ia).multiplyScalar(SURFACE_SIZE),
      new THREE.Vector2().fromBufferAttribute(uv, ib).multiplyScalar(SURFACE_SIZE),
      new THREE.Vector2().fromBufferAttribute(uv, ic).multiplyScalar(SURFACE_SIZE)
    );
    if (s && Number.isFinite(s.ratio)) samples.push(s);
  }

  samples.sort((x, y) => x.ratio - y.ratio);
  const total = samples.reduce((sum, s) => sum + s.area, 0);

  return (p: number) => {
    let seen = 0;
    for (const s of samples) {
      seen += s.area;
      if (seen >= total * p) return s.ratio;
    }
    return samples[samples.length - 1].ratio;
  };
}

/**
 * Both limits are forced by the sphere, not chosen to fit the current numbers.
 *
 * A sphere cannot be mapped to a rectangle without distortion: once the widest
 * ring is round, a ring at latitude f is squeezed by cos f, so the ratio there
 * is exactly 1/cos f. Ranking by area, the band |f| <= f0 covers sin f0 of the
 * surface — so the median is forced to 1/cos(30 deg) = 1.15 and the 90th
 * percentile to 1/cos(64 deg) = 2.29. A capsule is a cylinder (ratio 1) plus
 * two hemispherical caps, so it can only do better than that.
 *
 * Anything above these limits is a packing that wasted the freedom it had, not
 * geometry defending itself.
 */
const MEDIAN_LIMIT = 1.25;
const P90_LIMIT = 2.5;

console.log("dab shape on the body (1.00 = round)\n");
for (const profile of BODIES) {
  const geoms = buildPartGeometries(profile);
  for (const part of BODY_PARTS) {
    const at = anisotropy(geoms[part]);
    const median = at(0.5);
    const p90 = at(0.9);
    check(
      median <= MEDIAN_LIMIT && p90 <= P90_LIMIT,
      `${profile.id}/${part}`,
      `median ${median.toFixed(2)} (<= ${MEDIAN_LIMIT}), 90th ${p90.toFixed(2)} (<= ${P90_LIMIT})`
    );
  }
}

/* --------------------------------------------------- brush size conversion */

/**
 * The brush is set in world units and drawn in texels, and the exchange rate is
 * different on every part. Both ends of the slider have to survive that trip on
 * every part of every avatar: too small and PaintSurface's own 1.5-texel floor
 * quietly takes over, so the bottom of the slider stops doing anything; too
 * large and the server clamps the radius it relays, so what the painter sees on
 * their own body is not what anyone else gets.
 */
console.log("\nbrush size survives the world-to-texel conversion\n");
for (const profile of BODIES) {
  const geoms = buildPartGeometries(profile);
  for (const part of BODY_PARTS) {
    const scale = geoms[part].userData.texelsPerWorld as number | undefined;
    if (typeof scale !== "number") {
      check(false, `${profile.id}/${part}`, "packUVs recorded no texelsPerWorld");
      continue;
    }
    const small = BRUSH.min * scale;
    const large = BRUSH.max * scale;
    check(
      small >= 1.5 && large <= PAINT.maxRadius,
      `${profile.id}/${part}`,
      `${small.toFixed(1)}..${large.toFixed(1)} texels (need 1.5..${PAINT.maxRadius})`
    );
  }
}

/* ------------------------------------------------------------ stroke joins */

const cellOf = (u: number, v: number): string =>
  `${Math.min(GRID_COLS - 1, Math.floor(u * GRID_COLS))},${Math.min(GRID_ROWS - 1, Math.floor(v * GRID_ROWS))}`;

const cellKey = (part: BodyPart): string => `${PART_CELL[part][0]},${PART_CELL[part][1]}`;

const centre = (part: BodyPart) => ({
  u: (PART_CELL[part][0] + 0.5) / GRID_COLS,
  v: (PART_CELL[part][1] + 0.5) / GRID_ROWS,
});

const BRUSH_R = 48;
const painted = (from: { u: number; v: number }, to: { u: number; v: number }): Set<string> =>
  new Set(strokeSteps(from, { ...to, r: BRUSH_R, c: 0 }).map((p) => cellOf(p.u, p.v)));

console.log("\njoined strokes stay on the part the pointer is on\n");

// Every ordered pair of parts. A drag that leaves one part and lands on
// another is two separate touches, not one stroke: the parts are neighbours in
// the atlas but nowhere near each other on the body, so interpolating between
// them paints a line across whatever cells the straight line crosses.
let worst = "";
let bled = 0;
for (const a of BODY_PARTS) {
  for (const b of BODY_PARTS) {
    if (a === b) continue;
    const cells = painted(centre(a), centre(b));
    const strays = [...cells].filter((c) => c !== cellKey(b));
    if (strays.length) {
      bled++;
      if (!worst) worst = `${a} -> ${b} also painted ${strays.length} other cell(s)`;
    }
  }
}
check(bled === 0, "no part-to-part drag paints outside the part it lands on", worst || "30 pairs");

// A capsule's u wraps all the way around the limb, so painting round an arm
// crosses the seam: the two dabs sit at opposite edges of the SAME cell with
// the whole part between them. Interpolating draws a band across the limb.
const arm = PART_CELL.armL;
const seam = painted(
  { u: (arm[0] + 0.02) / GRID_COLS, v: (arm[1] + 0.5) / GRID_ROWS },
  { u: (arm[0] + 0.98) / GRID_COLS, v: (arm[1] + 0.5) / GRID_ROWS }
);
const seamSteps = strokeSteps(
  { u: (arm[0] + 0.02) / GRID_COLS, v: (arm[1] + 0.5) / GRID_ROWS },
  { u: (arm[0] + 0.98) / GRID_COLS, v: (arm[1] + 0.5) / GRID_ROWS, r: BRUSH_R, c: 0 }
);
check(
  seamSteps.length === 1 && seam.size === 1,
  "a drag across a limb's uv seam does not sweep the limb",
  `${seamSteps.length} dab(s)`
);

// The guard on the two above: a rule of "never interpolate" would satisfy them
// and silently turn every drag into dotted lines. A real drag inside one part
// must still be filled in.
const near = strokeSteps(
  { u: (arm[0] + 0.3) / GRID_COLS, v: (arm[1] + 0.3) / GRID_ROWS },
  { u: (arm[0] + 0.45) / GRID_COLS, v: (arm[1] + 0.42) / GRID_ROWS, r: BRUSH_R, c: 0 }
);
check(near.length >= 2, "a short drag within one part is still filled in", `${near.length} dabs`);
check(
  near.every((p) => cellOf(p.u, p.v) === cellKey("armL")),
  "and every dab of it lands on that part"
);

console.log(failures ? `\n${failures} failure(s)` : "\nall good");
process.exit(failures ? 1 : 0);

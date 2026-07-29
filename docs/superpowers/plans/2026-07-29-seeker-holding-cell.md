# 술래 대기실 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 숨기 페이즈 동안 술래가 보던 검은 화면을, 걸어다니고 붓질을 연습할 수 있는 지하 밀봉 방으로 바꾼다.

**Architecture:** 셀은 아레나와 좌표가 겹치지 않는 y=-8의 별도 박스 목록이다. 허브가 이미 자기 `boxes`와 `worldHalfSize`를 넘기는 것과 같은 방식에 **바닥 높이 인자 하나**를 더 얹는다 — `groundHeightAt`이 `let best = 0`으로 시작하는 탓에 y=0 아래는 전부 끌어올려지기 때문이다. 서버는 셀 스폰 좌표만 알고, `hiding → seeking` 전환에서 술래를 `[0,0,0]`으로 옮긴다.

**Tech Stack:** TypeScript, React Three Fiber, tsx 스크립트 기반 검사(테스트 프레임워크 없음)

**설계 문서:** [`docs/superpowers/specs/2026-07-29-seeker-holding-cell-design.md`](../specs/2026-07-29-seeker-holding-cell-design.md)

## Global Constraints

- 이 저장소는 테스트 프레임워크가 없다. 검증은 `scripts/check-*.ts`를 `tsx`로 돌리는 방식이며, 실패 시 `process.exit(1)`. 새 검사도 이 패턴을 그대로 따른다.
- `npm run check` = `tsc --noEmit` + check:sync + check:bodies + check:shop + check:movement + check:hub + check:map + check:audio + check:leaderboard + server:test. **모든 태스크가 끝날 때 전부 통과해야 한다.**
- 서버(`server/src/`)는 격리된 VM에서 돌아 `src/`를 import할 수 없다. 공유가 필요한 값은 복제하고 `check:sync`가 대조한다.
- 기존 상수는 바꾸지 않는다: `MOVE.playerRadius` 0.45, `MOVE.jumpSpeed` 7.4, `MOVE.gravity` 22, `STEP_HEIGHT` 0.45, `TOP_Y` 1.86.
- 아레나(`src/game/arena.ts`)와 허브(`src/hub/hubMap.ts`)의 지오메트리는 건드리지 않는다. `check:map`과 `check:hub`는 계속 통과해야 한다.
- 커밋 메시지는 영어, 본문은 왜 그렇게 했는지를 적는다. 소스 주석도 영어(기존 이력의 스타일).
- PowerShell에서 `git commit -m` 안에 큰따옴표가 들어가면 인자가 쪼개진다. 본문이 긴 커밋은 메시지를 파일에 쓰고 `git commit -F <파일>`로 한다.

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `src/game/map.ts` (수정) | `groundHeightAt`/`resolveMove`에 `floorY` 인자 | 1 |
| `src/game/movement.ts` (수정) | `stepMotion` 옵션에 `floorY` 전달 | 1 |
| `src/game/cell.ts` (신규) | 셀 상수·박스·스폰. 순수 데이터 | 2 |
| `scripts/check-cell.ts` (신규) | 셀 불변식 | 2 |
| `src/game/CellScene.tsx` (신규) | 셀 렌더 | 3 |
| `src/game/LocalPlayer.tsx` (수정) | 셀 안에서는 셀 박스/바닥으로 걷고, 해제 시 스냅 | 3 |
| `src/App.tsx` (수정) | 셀/아레나 분기, `frozen`·`canPaint` 완화 | 3 |
| `src/ui/Hud.tsx` (수정) | 블라인드 오버레이 제거, 남은 인원 표시 | 3 |
| `src/game/constants.ts`, `server/src/rules.ts` (수정) | 숨기 30초, 셀 스폰 사본 | 4 |
| `server/src/server.ts` (수정) | 셀 스폰, 전환 시 순간이동 | 4 |
| `scripts/check-sync.ts` (수정) | 셀 스폰 대조 | 4 |
| `src/net/offline.ts` (수정) | 봇 제거, 혼자서도 라운드 진행 | 5 |

---

### Task 1: floorY — 바닥 평면을 인자로 만든다

동작은 한 줄도 바뀌지 않는다. 기본값이 0이라 기존 호출부가 전부 그대로 통과하는 것이 곧 검증이다.

**Files:**
- Modify: `src/game/map.ts`, `src/game/movement.ts`, `scripts/check-movement.ts`

**Interfaces:**
- Produces:
  - `groundHeightAt(x: number, z: number, feetY: number, boxes?: MapBox[], floorY?: number): number`
  - `resolveMove(from, dx, dz, radius, boxes?, floorY?): [number, number, number]`
  - `stepMotion(s, input, yaw, opts)` — `opts`에 `floorY?: number` 추가

- [ ] **Step 1: 실패하는 검사부터 — `scripts/check-movement.ts`의 `ground and jumping` 블록 끝에 추가**

`OPEN` 상수 바로 뒤, `// Step-up is what stops a player...` 주석 앞에 넣는다.

```ts
  // A world whose floor is not at y=0. Nothing in the arena needs this, but the
  // seeker's holding cell sits underground, and without it the implicit plane
  // at zero yanks anything below it back up to the surface.
  {
    const deep = -8;
    check(
      `an empty world with floorY ${deep} reads that height, not 0`,
      groundHeightAt(0, 0, deep, [], deep) === deep
    );
    check(
      "a box below the surface is still standable",
      groundHeightAt(0, 0, deep, [{ p: [0, deep + 0.25, 0], s: [2, 0.5, 2], c: 0 }], deep) ===
        deep + 0.5
    );
    check(
      "omitting floorY keeps the old behaviour",
      groundHeightAt(0, 0, 0, []) === 0
    );
  }
```

- [ ] **Step 2: 실패 확인**

Run: `npm run check:movement`
Expected: FAIL — 첫 두 검사가 `0`을 돌려주며 실패한다. 세 번째는 통과한다.

- [ ] **Step 3: `src/game/map.ts`의 `groundHeightAt` 교체**

```ts
/**
 * Highest surface the player can stand on at (x,z), given their current feet
 * height.
 *
 * `floorY` is the height of the implicit ground plane. It is 0 for the arena
 * and the hub, and it exists because the seeker's holding cell is underground:
 * with a hardcoded zero, standing at y=-8 snaps you to the surface instantly.
 */
export function groundHeightAt(
  x: number,
  z: number,
  feetY: number,
  boxes = MAP_BOXES,
  floorY = 0
): number {
  let best = floorY;
  for (const b of boxes) {
    if (!overlapsXZ(b, x, z, 0)) continue;
    const top = b.p[1] + b.s[1] / 2;
    if (top <= feetY + STEP_HEIGHT && top > best) best = top;
  }
  return best;
}
```

같은 파일의 `resolveMove`도 인자를 받아 넘긴다:

```ts
export function resolveMove(
  from: [number, number, number],
  dx: number,
  dz: number,
  radius: number,
  boxes = MAP_BOXES,
  floorY = 0
): [number, number, number] {
  const [x, y, z] = moveXZ(from, dx, dz, radius, boxes);
  return [x, groundHeightAt(x, z, y, boxes, floorY), z];
}
```

- [ ] **Step 4: `src/game/movement.ts`의 `stepMotion`에 전달**

`opts` 타입에 한 줄 추가한다:

```ts
    /** Height of the implicit ground plane; the holding cell's is below zero. */
    floorY?: number;
```

그리고 본문의 `groundHeightAt` 호출을 고친다:

```ts
  const ground = groundHeightAt(next[0], next[2], next[1], boxes, opts.floorY ?? 0);
```

- [ ] **Step 5: 통과 확인**

Run: `npm run check:movement`
Expected: PASS — 새 검사 3개 포함 전부 통과.

**실패하면**: `moveXZ`는 높이를 건드리지 않는다(호출자가 중력을 소유한다). `floorY`가 필요한 곳은 `groundHeightAt`뿐이고, `resolveMove`와 `stepMotion`은 그저 전달자다.

- [ ] **Step 6: 나머지 검사**

Run: `npx tsc --noEmit && npm run check`
Expected: 전부 통과. 기본값이 0이라 아레나·허브·카메라 동작이 바뀔 이유가 없다.

- [ ] **Step 7: 커밋**

```bash
git add src/game/map.ts src/game/movement.ts scripts/check-movement.ts
git commit -m "refactor: make the ground plane's height an argument"
```

---

### Task 2: 셀 지오메트리와 그 불변식

**Files:**
- Create: `src/game/cell.ts`, `scripts/check-cell.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `MapBox` (`src/game/arena.ts`), `MOVE` (`src/game/constants.ts`), `TOP_Y` (`src/game/bodies.ts`)
- Produces:
  - `CELL_FLOOR_Y: number` (-8)
  - `CELL_INNER: number` (6) — 안쪽 한 변
  - `CELL_HALF: number` — `moveXZ`에 넘길 `worldHalfSize`
  - `CELL_SPAWN: [number, number, number]`
  - `CELL_BOXES: MapBox[]`

- [ ] **Step 1: `src/game/cell.ts` 작성**

```ts
/**
 * The seeker's holding cell.
 *
 * The seeker used to spend the hiding phase behind an opaque overlay, frozen in
 * place — fair, but forty-five seconds of looking at a black rectangle. This is
 * a room to spend them in instead.
 *
 * It sits underground rather than in the arena so it costs no floor space and
 * no hider can find it. That is only possible because groundHeightAt takes a
 * floor height now; the implicit plane at y=0 would otherwise lift anything
 * standing here straight up to the surface.
 *
 * Sealed on all six sides. The ceiling is not about escape — you cannot walk
 * through the walls either — it is about sight: without one you look up through
 * the arena floor from below.
 */

import type { MapBox } from "./arena";
import { MOVE } from "./constants";
import { TOP_Y } from "./bodies";

/** Deep enough that nothing in the arena reaches down to it. */
export const CELL_FLOOR_Y = -8;

/** Inner side length. Room to walk and to orbit the camera round your body. */
export const CELL_INNER = 6;

/** Half-extent handed to moveXZ, which clamps to ±(worldHalfSize - radius). */
export const CELL_HALF = CELL_INNER / 2 + MOVE.playerRadius;

/** Head clearance above the floor. */
const CELL_HEIGHT = 3;

const THICKNESS = 0.5;

export const CELL_SPAWN: [number, number, number] = [0, CELL_FLOOR_Y, 0];

const CONCRETE = 0x6f7378;
const TRIM = 0x8a8f96;

function slab(
  p: [number, number, number],
  s: [number, number, number],
  c: number
): MapBox {
  return { p, s, c, wall: true };
}

/**
 * Six slabs. The walls stand ON the floor slab rather than beside it, so their
 * inner faces are exactly ±CELL_INNER/2 and CELL_HALF describes the same room
 * the collision boxes do.
 */
export const CELL_BOXES: MapBox[] = (() => {
  const half = CELL_INNER / 2;
  const outer = CELL_INNER + THICKNESS * 2;
  const midY = CELL_FLOOR_Y + CELL_HEIGHT / 2;

  return [
    // Floor and ceiling.
    slab([0, CELL_FLOOR_Y - THICKNESS / 2, 0], [outer, THICKNESS, outer], CONCRETE),
    slab([0, CELL_FLOOR_Y + CELL_HEIGHT + THICKNESS / 2, 0], [outer, THICKNESS, outer], TRIM),
    // Walls.
    slab([0, midY, -half - THICKNESS / 2], [outer, CELL_HEIGHT, THICKNESS], CONCRETE),
    slab([0, midY, half + THICKNESS / 2], [outer, CELL_HEIGHT, THICKNESS], CONCRETE),
    slab([-half - THICKNESS / 2, midY, 0], [THICKNESS, CELL_HEIGHT, outer], TRIM),
    slab([half + THICKNESS / 2, midY, 0], [THICKNESS, CELL_HEIGHT, outer], TRIM),
  ];
})();

/** Sanity: a 1.86-tall body has to fit under the ceiling. */
export const CELL_CLEARS_BODY = CELL_HEIGHT > TOP_Y;
```

- [ ] **Step 2: `scripts/check-cell.ts` 작성**

```ts
/**
 * Holding cell invariants.
 *
 * The cell is the one place in this game where the floor is not at y=0, and
 * nothing else would notice if that broke — the seeker would simply be standing
 * on the surface, invisible to every other check. So it is asserted here.
 *
 * Run: npm run check:cell
 */

import {
  CELL_BOXES,
  CELL_CLEARS_BODY,
  CELL_FLOOR_Y,
  CELL_HALF,
  CELL_INNER,
  CELL_SPAWN,
} from "../src/game/cell";
import { MAP_BOXES } from "../src/game/arena";
import { groundHeightAt, playerBlockedAt } from "../src/game/map";
import { createMotionState, stepMotion } from "../src/game/movement";
import { MOVE } from "../src/game/constants";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

console.log("\nthe cell is somewhere you can stand");

check("a standing body clears the ceiling", CELL_CLEARS_BODY);
check(
  `the spawn rests on the cell floor (${groundHeightAt(
    CELL_SPAWN[0],
    CELL_SPAWN[2],
    CELL_FLOOR_Y,
    CELL_BOXES,
    CELL_FLOOR_Y
  )})`,
  groundHeightAt(CELL_SPAWN[0], CELL_SPAWN[2], CELL_FLOOR_Y, CELL_BOXES, CELL_FLOOR_Y) ===
    CELL_FLOOR_Y
);
check(
  "the spawn is not inside a wall",
  !playerBlockedAt(CELL_SPAWN[0], CELL_SPAWN[2], CELL_FLOOR_Y, MOVE.playerRadius, CELL_BOXES)
);

console.log("\nthe cell is sealed");
{
  // Walk hard at all four walls with the real integrator. Escaping is not a
  // cosmetic failure: the seeker would drop through the world.
  const dt = 1 / 60;
  for (const [name, yaw] of [
    ["+z", 0],
    ["-z", Math.PI],
    ["+x", Math.PI / 2],
    ["-x", -Math.PI / 2],
  ] as [string, number][]) {
    const state = createMotionState([...CELL_SPAWN] as [number, number, number]);
    for (let i = 0; i < 300; i++) {
      stepMotion(state, { forward: 1, strafe: 0, jump: true }, yaw, {
        boxes: CELL_BOXES,
        dt,
        now: i * dt * 1000,
        speed: MOVE.seekerSpeed,
        radius: MOVE.playerRadius,
        worldHalfSize: CELL_HALF,
        floorY: CELL_FLOOR_Y,
      });
    }
    const inside =
      Math.abs(state.pos[0]) <= CELL_INNER / 2 &&
      Math.abs(state.pos[2]) <= CELL_INNER / 2 &&
      state.pos[1] >= CELL_FLOOR_Y - 1e-6;
    check(
      `five seconds of walking and jumping into the ${name} wall stays inside ` +
        `(${state.pos.map((v) => v.toFixed(2)).join(", ")})`,
      inside
    );
  }
}

console.log("\nthe cell cannot collide with the arena");
{
  // They share a coordinate space; only the height keeps them apart.
  const cellTop = Math.max(...CELL_BOXES.map((b) => b.p[1] + b.s[1] / 2));
  const arenaBottom = Math.min(...MAP_BOXES.map((b) => b.p[1] - b.s[1] / 2));
  check(
    `the cell's ceiling (${cellTop.toFixed(2)}) is below the arena (${arenaBottom.toFixed(2)})`,
    cellTop < arenaBottom
  );
}

console.log("\nthe seeker has somewhere to land");
{
  // hiding -> seeking teleports the seeker to the arena centre.
  check(
    "[0,0,0] is standable in the arena",
    !playerBlockedAt(0, 0, 0, MOVE.playerRadius, MAP_BOXES) &&
      groundHeightAt(0, 0, 0, MAP_BOXES) === 0
  );
}

if (failures === 0) {
  console.log("\n✅ the holding cell holds\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
```

- [ ] **Step 3: `package.json`에 스크립트 추가**

`"check:map"` 줄 다음에 넣고, `"check"` 체인의 `npm run check:map` 뒤에 `&& npm run check:cell`을 넣는다.

```json
"check:cell": "tsx scripts/check-cell.ts",
```

- [ ] **Step 4: 검사 실행**

Run: `npm run check:cell`
Expected: PASS — 전부 통과.

**실패하면**: 밀봉 검사가 실패한다면 벽 슬래브의 안쪽 면과 `CELL_HALF`가 어긋난 것이다. `moveXZ`는 `worldHalfSize - radius`로 clamp하므로 `CELL_HALF`가 `CELL_INNER/2 + playerRadius`여야 벽면과 정확히 맞는다.

- [ ] **Step 5: 전체 검사**

Run: `npx tsc --noEmit && npm run check`
Expected: 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add src/game/cell.ts scripts/check-cell.ts package.json
git commit -m "feat: build the seeker's underground holding cell"
```

---

### Task 3: 클라이언트 — 셀을 그리고, 그 안에서 걷게 한다

여기까지 하면 서버 없이도 화면에서 확인할 수 있다. 서버는 Task 4다.

**Files:**
- Create: `src/game/CellScene.tsx`
- Modify: `src/game/LocalPlayer.tsx`, `src/App.tsx`, `src/ui/Hud.tsx`

**Interfaces:**
- Consumes: `CELL_BOXES`, `CELL_FLOOR_Y`, `CELL_HALF`, `CELL_SPAWN` (`src/game/cell.ts`)
- Produces: `<CellScene />`; `LocalPlayer`가 새 prop `inCell: boolean`을 받는다

- [ ] **Step 1: `src/game/CellScene.tsx` 작성**

```tsx
import { ThreeEvent } from "@react-three/fiber";
import { CELL_BOXES } from "./cell";

/**
 * The holding cell, drawn.
 *
 * Flat colours rather than the kit models the arena uses: this is a concrete
 * box, and the only thing in it worth looking at is your own body.
 */

function hex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

interface Props {
  onPickColor?: (color: number) => void;
}

export function CellScene({ onPickColor }: Props) {
  const pick = (color: number) => (e: ThreeEvent<MouseEvent>) => {
    if (!onPickColor) return;
    e.stopPropagation();
    onPickColor(color);
  };

  return (
    <group>
      {CELL_BOXES.map((b, i) => (
        <mesh key={i} position={b.p} receiveShadow onClick={pick(b.c)}>
          <boxGeometry args={b.s} />
          <meshStandardMaterial color={hex(b.c)} roughness={0.95} metalness={0.02} />
        </mesh>
      ))}
    </group>
  );
}

/** Lighting for a windowless room: one soft overhead, no sun, no fog. */
export function CellLighting() {
  return (
    <>
      <hemisphereLight args={["#cfd6de", "#2a2f38", 0.9]} />
      <ambientLight intensity={0.5} />
      <color attach="background" args={["#05070a"]} />
    </>
  );
}
```

- [ ] **Step 2: `src/game/LocalPlayer.tsx` — 셀 안에서는 셀의 박스·바닥·경계를 쓴다**

`Props` 인터페이스에 추가:

```tsx
  /** True while the seeker waits out the hiding phase underground. */
  inCell: boolean;
```

구조 분해에 `inCell`을 추가하고, 파일 상단 import에 셀 상수를 더한다:

```tsx
import { CELL_BOXES, CELL_FLOOR_Y, CELL_HALF, CELL_SPAWN } from "./cell";
```

`useFrame` 안의 `stepMotion` 호출을 교체한다:

```tsx
    const jumped = stepMotion(motion.current, input, yaw.current, {
      boxes: inCell ? CELL_BOXES : MAP_BOXES,
      dt: step,
      now,
      speed,
      radius: MOVE.playerRadius,
      locked: charLocked,
      worldHalfSize: inCell ? CELL_HALF : undefined,
      floorY: inCell ? CELL_FLOOR_Y : 0,
    });
```

같은 `useFrame` 안 `updateFollowCamera`의 `boxes`도 바꾼다:

```tsx
      boxes: inCell ? CELL_BOXES : MAP_BOXES,
```

- [ ] **Step 3: `src/game/LocalPlayer.tsx` — 셀 입장과 순간이동에서 위치를 스냅한다**

기존의 `phase === "hiding"` effect 바로 뒤에 넣는다. 서버가 쓴 좌표를 그대로 채택하는 기존 패턴과 같지만, **셀 안팎을 오갈 때는 서버를 기다리지 않는다** — 한 프레임이라도 늦으면 지하에 있던 몸이 아레나 지오메트리 속에서 깨어난다.

```tsx
  // Entering and leaving the cell are both teleports. The local rig owns its
  // own position, so it has to be told; waiting for the server's write to
  // arrive would leave the body a frame or more inside the wrong world.
  useEffect(() => {
    motion.current = createMotionState(
      inCell ? ([...CELL_SPAWN] as [number, number, number]) : [0, 0, 0]
    );
    lastSent.current.pose = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCell]);
```

- [ ] **Step 4: `src/App.tsx` — 씬을 분기하고 얼음을 푼다**

import를 추가한다:

```tsx
import { CellScene, CellLighting } from "./game/CellScene";
```

`isSeeker`가 이미 있다. 그 아래에 한 줄 더한다:

```tsx
  /** The seeker sits out the hiding phase underground rather than blindfolded. */
  const inCell = isSeeker && phase === "hiding";
```

`frozen`에서 술래-숨기 항목을 **삭제**한다. 안 지우면 셀 안에서 못 움직인다:

```tsx
  const frozen = paintMode || poseMenuOpen || !!me.caught || phase === "results";
```

Canvas의 매치 분기에서 `Lighting`/`Arena`를 조건부로 바꾼다:

```tsx
          <Suspense fallback={null}>
            {inCell ? <CellLighting /> : <Lighting />}
            {inCell ? <CellScene /> : <Arena />}
            <LocalPlayer
              me={me}
              phase={phase}
              inCell={inCell}
```

`RemotePlayers`는 셀에서 렌더하지 않는다 — 다른 사람은 지상에 있다:

```tsx
            {!inCell && <RemotePlayers players={players} selfAccount={account} />}
```

- [ ] **Step 5: `src/App.tsx` — 셀 안에서 칠할 수 있게 한다**

`canPose`가 무엇으로 계산되는지 읽고, `canPaint`가 `inCell`일 때도 true가 되도록 한 줄 고친다:

```tsx
  const canPaint = canPose || inCell;
```

`canPose`는 그대로 둔다 — 셀에서 포즈를 잡을 이유는 없고, 포즈 잠금은 아레나 규칙이다.

- [ ] **Step 6: `src/ui/Hud.tsx` — 블라인드 오버레이를 없애고 남은 인원을 남긴다**

`blindfolded` 상수와 그것을 쓰는 JSX 블록(`{blindfolded && ( ... )}`) 전체를 삭제한다. 그 자리에 셀 안내를 넣는다:

```tsx
      {isSeeker && room.phase === "hiding" && (
        <div className="cell-note">
          <strong>{secondsLeft}초</strong> 후 추적이 시작됩니다 · 숨는 사람 {remaining}명
        </div>
      )}
```

`src/ui/ui.css`의 `.blindfold` 규칙을 다음으로 교체한다:

```css
.cell-note {
  position: absolute;
  left: 50%;
  bottom: 92px;
  transform: translateX(-50%);
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(5, 7, 10, 0.72);
  color: #fff;
  font-size: 15px;
  pointer-events: none;
}
```

- [ ] **Step 7: 타입체크와 전체 검사**

Run: `npx tsc --noEmit && npm run check && npx vite build`
Expected: 전부 통과.

- [ ] **Step 8: 화면으로 확인**

**미리보기 패널을 화면에 띄운 상태에서** 진행한다. 패널이 안 보이면 페이지가 백그라운드 탭이 되어 `requestAnimationFrame`이 돌지 않고 R3F가 마운트조차 하지 않는다(HANDOFF 6차 세션 기록 참고).

이 시점에는 서버가 아직 술래를 셀 좌표로 스폰하지 않는다. 클라이언트가 `inCell`에서 스스로 스냅하므로 셀 안에는 정상적으로 서 있어야 한다.

1. `npm run dev`, 접속, 포털로 매치 입장.
2. 술래가 되면 콘크리트 방 안에 서 있는지 — 검은 화면이 아니어야 한다.
3. 사방 벽으로 걸어보고, 점프해보고, 빠져나가지 못하는지.
4. `F`로 붓질이 되는지.
5. 30초(아직 45초) 뒤 아레나 중앙으로 나오는지, 바닥을 뚫지 않는지.

- [ ] **Step 9: 커밋**

```bash
git add src/game/CellScene.tsx src/game/LocalPlayer.tsx src/App.tsx src/ui/Hud.tsx src/ui/ui.css
git commit -m "feat: put the seeker in the cell instead of behind a blindfold"
```

---

### Task 4: 서버 — 셀에 스폰하고, 전환에서 꺼낸다

**Files:**
- Modify: `src/game/constants.ts`, `server/src/rules.ts`, `server/src/server.ts`, `scripts/check-sync.ts`

**Interfaces:**
- Produces: `server/src/rules.ts`의 `CELL_SPAWN: [number, number, number]` (클라와 동일), `PHASE_SECONDS.hiding` 30

- [ ] **Step 1: 숨기 30초 — 양쪽**

`src/game/constants.ts`:

```ts
export const PHASE_SECONDS: Record<Phase, number> = {
  lobby: 0, // ends when enough players ready
  hiding: 30,
  seeking: 90,
  results: 10,
};
```

`server/src/rules.ts`:

```ts
export const PHASE_SECONDS = { hiding: 30, seeking: 90, results: 10 };
```

- [ ] **Step 2: `server/src/rules.ts`에 셀 스폰 사본을 추가**

`SPAWN_POINTS` 바로 뒤에 넣는다.

```ts
/**
 * Where the seeker waits out the hiding phase.
 *
 * Must match CELL_SPAWN in src/game/cell.ts — check:sync compares them. The
 * server needs no other part of the cell: it never simulates movement, and the
 * cell's walls are a client-side collision concern.
 */
export const CELL_SPAWN: [number, number, number] = [0, -8, 0];
```

- [ ] **Step 3: `server/src/server.ts` — 술래를 셀에 스폰한다**

import에 `CELL_SPAWN`을 더하고, `startRound`의 `pos` 한 줄을 바꾼다:

```ts
      pos: isSeeker ? CELL_SPAWN : randomSpawn(),
```

- [ ] **Step 4: `server/src/server.ts` — 전환에서 술래를 꺼낸다**

`case "hiding":` 블록을 교체한다.

```ts
      case "hiding": {
        if (now >= num(state.phaseEndsAt)) {
          // Lift the seeker out of the holding cell. lastMoveAt has to move
          // with the position: updateTransform clamps a report against the
          // distance travelled since that timestamp, so leaving it behind means
          // the server's own teleport reads as a speed hack and gets clamped
          // back toward the cell.
          const seeker = state.seeker as string | undefined;
          if (seeker) {
            await $global.updateRoomUserState(roomId, seeker, {
              pos: [0, 0, 0],
              lastMoveAt: now,
            });
          }

          await $global.updateRoomState(roomId, {
            phase: "seeking" as Phase,
            phaseEndsAt: now + PHASE_SECONDS.seeking * 1000,
          });
          await $global.broadcastToAll("seekingStart", { roomId });
        }
        break;
      }
```

- [ ] **Step 5: `scripts/check-sync.ts` — 셀 스폰 대조**

`spawn points` 블록 다음에 넣는다. import에 클라의 `CELL_SPAWN`과 서버의 `CELL_SPAWN`을 별칭으로 추가한다.

```ts
import { CELL_SPAWN as CLIENT_CELL } from "../src/game/cell";
```

```ts
import {
  ARENA as SERVER_ARENA,
  SPAWN_POINTS as SERVER_SPAWNS,
  CELL_SPAWN as SERVER_CELL,
  POSE_COUNT as SERVER_POSE_COUNT,
  MOVE_SPEED_CAP,
  AVATAR_PRICES,
} from "../server/src/rules";
```

```ts
console.log("\nholding cell");

// The server spawns the seeker here and never simulates the room around it, so
// a drift would drop them outside the cell with no wall to stop them.
if (CLIENT_CELL.some((v, i) => v !== SERVER_CELL[i])) {
  fail(`cell spawn differs: client [${CLIENT_CELL}], server [${SERVER_CELL}]`);
} else {
  pass(`cell spawn [${CLIENT_CELL}] matches on both sides`);
}
```

- [ ] **Step 6: 전체 검사 — 서버 테스트가 핵심**

Run: `npm run check`
Expected: 전부 통과. 서버 테스트 22개가 통과해야 한다.

**주의**: 이 테스트 하네스는 라운드를 페이즈 전환까지 진행시키지 못한 전례가 있다(리더보드·코인 적립이 같은 벽에 막혀 있다). Step 4의 순간이동이 자동 검증되지 않는다면 **그 사실을 Task 6의 문서에 정직하게 적고**, 화면 확인으로 대신한다.

- [ ] **Step 7: 커밋**

```bash
git add src/game/constants.ts server/src/rules.ts server/src/server.ts scripts/check-sync.ts
git commit -m "feat: spawn the seeker in the cell and lift them out on the phase change"
```

---

### Task 5: 오프라인 모드에서 봇을 걷어낸다

사용자 결정: AI는 술래가 될 수 없다. 온라인 방에는 사람만 들어오므로 이 규칙이 실제로 걸리는 곳은 오프라인 리허설뿐이고, 거기서 봇을 없애면 규칙이 저절로 지켜진다.

**Files:**
- Modify: `src/net/offline.ts`

**Interfaces:**
- 변경 없음. `useOfflineGame()`의 반환 형태는 그대로여야 한다 — `useGame()`이 온라인 구현과 같은 타입으로 취급한다.

- [ ] **Step 1: `src/net/offline.ts`를 읽고 봇에 닿는 부분을 전부 찾는다**

Run: `grep -n "bot\|BOTS" src/net/offline.ts`

`BOTS` 상수, `bots` ref, 봇 AI 루프, 결과 집계의 봇 항목, `players` 목록 조립의 봇 부분이 나온다.

- [ ] **Step 2: 봇을 삭제하고 혼자 라운드가 돌게 한다**

- `BOTS` 상수와 `bots` ref를 지운다.
- 페이즈 머신의 봇 AI 블록 전체를 지운다.
- `startRound`에 해당하는 부분에서 `seeker`를 항상 `ME`로 둔다. 주석을 남긴다:

```ts
  // Solo rehearsal: you are always the seeker. That is not a shortcut — an AI
  // seeker is explicitly not allowed, and with nobody else in the room there is
  // no one else it could be. The cost is that hiding can't be practised
  // offline.
```

- 라운드 종료 집계에서 봇 항목을 지우고 자기 결과만 남긴다.
- `players` 목록은 자기 자신 하나만 돌려준다.
- 라운드 시작 조건에서 `MIN_PLAYERS`를 요구하지 않는다. **`src/game/constants.ts`의 `MIN_PLAYERS`는 건드리지 않는다** — 실서버 규칙이다.

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 클린. 미사용 import가 남으면 지운다.

- [ ] **Step 4: 전체 검사와 빌드**

Run: `npm run check && npx vite build`
Expected: 전부 통과.

- [ ] **Step 5: 화면으로 확인**

패널을 띄운 상태로:

1. 로비에 봇 이름(`미나`, `준`)이 더 이상 없는지.
2. 혼자 포털에 들어가 라운드가 시작되는지.
3. 술래로 셀에 들어가고, 30초 뒤 아레나 중앙으로 나오는지.

- [ ] **Step 6: 커밋**

```bash
git add src/net/offline.ts
git commit -m "refactor: drop the offline bots so no AI can be the seeker"
```

---

### Task 6: 문서 — 이번 세션 전체를 기록한다

아레나 재설계 계획의 Task 7이 아직 안 끝났고, 그 사이에 방향 전환이 여럿 있었다. 술래 작업까지 한 번에 적는다.

**Files:**
- Modify: `README.md`, `HANDOFF.md`
- Modify: `docs/superpowers/specs/2026-07-28-arena-redesign-design.md`

- [ ] **Step 1: 아레나 설계 문서에 후기(postscript)를 붙인다**

섹션 2(미미크리)가 **구현 후 폐기됐다**는 것을 문서 안에 적는다. 문서만 읽는 사람이 폐기된 설계를 유효한 것으로 오해하지 않도록, 문서 첫머리에 한 문단으로 넣는다:

- 관문(드럼 구역)은 **통과**했다 — 사용자가 직접 확인했다.
- 그럼에도 사용자가 "코드로 만든 박스처럼 보인다"며 에셋 모델을 요구했고, 텍스처 모델은 단색 페인트로 흉내낼 수 없으므로 미미크리를 버렸다.
- 남은 것: 손설계 배치, 빈 슬롯, 풍차 칸막이, `check:map`. 이들은 위장이 아니라 엄폐와 시야 차단을 근거로 계속 유효하다.

- [ ] **Step 2: `README.md`**

- 아레나: 절차적 생성 → 손설계 + 에셋 모델 + 시드 산개. 크기 44×44 → 88×88.
- "서버와 클라이언트에 맵 생성기가 중복" 서술을 스폰 지점·셀 스폰 공유로 교체.
- 알려진 한계에 추가:
  - **밸런스 미검증** — 숨기 30초 / 술래 90초는 44×44 기준이었다. 88×88의 대각선은 124u, 횡단 약 21초.
  - **성능 미측정** — 아레나에 모델 621개. 인스턴싱은 아직 없다.
- 검사 목록에 `check:map`, `check:cell` 추가.

- [ ] **Step 3: `HANDOFF.md`에 7차 세션 절을 추가**

앞에 붙인다(최신이 위). 반드시 담을 것:

- **아레나 재설계**: 태스크 1~6 실행. `poseBounds` 추출, `arena.ts` 분리, 서버 맵 사본 제거, `check:map` 신설, 관문 통과, 4구역+칸막이.
- **방향 전환 셋**: 미미크리 폐기(위 Step 1), 에셋 모델 도입, 맵 4배.
- **런타임에서만 나온 버그 셋** — 코드 리뷰로는 안 나왔을 종류라 다음 세션이 알아야 한다:
  1. `Arena.tsx`와 `arena.ts`가 Windows 대소문자 무시 파일시스템에서 충돌해 `tsc`가 프로그램을 거부했다. 컴포넌트를 `ArenaScene.tsx`로 개명.
  2. drei의 `useTexture`를 쓰자 Vite가 `@react-three/fiber`를 두 번 pre-bundle해 `<Arena>`의 모든 훅이 `Invalid hook call`로 터졌다. R3F의 `useLoader`로 교체하고 `node_modules/.vite`를 비웠다.
  3. 스포이드가 엉뚱한 색을 돌려줬다. `GLTFLoader`는 `texture.flipY = false`(glTF는 uv 원점이 좌상단), `TextureLoader`는 기본 `true`. 한쪽만 가정하면 모델 텍스처를 세로로 뒤집어 읽고, Kenney 컬러맵은 작은 단색 패치가 빼곡해 전혀 다른 색이 나온다.
- **에셋 규칙**: `public/`은 전부 배포에 실린다. 84MB로 들어온 것을 4.9MB로 줄였다. 킷마다 `Textures/colormap.png`를 상대참조하므로 폴더를 섞으면 안 된다.
- **술래 대기실**: 설계·계획·구현. 실제 문제는 공정성이 아니라 45초 검은 화면이었다는 정정도 함께.
- **남은 미결**: Verse8 배포 후 확인 항목들(기존 5개) + 밸런스 + 성능.

- [ ] **Step 4: 커밋**

```bash
git add README.md HANDOFF.md docs/superpowers/specs/2026-07-28-arena-redesign-design.md
git commit -m "docs: record the arena redesign, the pivots, and the holding cell"
```

---

## Self-Review 결과

**스펙 커버리지**: 설계 문서의 섹션 1(floorY)=Task 1, 섹션 2(셀)=Task 2, 섹션 3(서버)=Task 4, 섹션 4(오프라인)=Task 5, 섹션 5(HUD)=Task 3 Step 6, 섹션 6(검증)=Task 2 Step 2 + Task 4 Step 5. R1=Task 1의 기본값 0과 `check:movement`. R2=Task 4 Step 4의 `lastMoveAt`. R3=Task 5. R4(밸런스)=Task 6 Step 2. R5(지루함)=Task 3 Step 8의 화면 확인.

**설계 문서에서 바뀐 것 하나**: 초안의 문제 진술("술래가 다 본다")이 사실과 달랐다. 블라인드 오버레이와 `frozen`이 이미 술래를 막고 있었다. 문서를 정정했고, **그 오버레이를 제거하는 것이 Task 3의 핵심 산출물**이 됐다 — 셀만 만들고 오버레이를 남기면 화면상 아무것도 바뀌지 않는다.

**미해결로 남긴 것**: `hiding → seeking` 순간이동을 서버 테스트가 검증할 수 있는지 모른다. 같은 하네스가 리더보드·코인 적립에서 이미 막혔다. Task 4 Step 6에 판단 기준과 대응을 명시했다.

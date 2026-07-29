# 아레나 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 절차적으로 흩뿌린 아레나를, 포즈 실루엣에 치수를 맞춘 사물 무리로 손설계한 맵으로 교체한다. 숨기가 "사물인 척하기"가 되게 한다.

**Architecture:** 포즈별 바운딩 박스를 계산하는 순수 모듈(`poseBounds.ts`)에서 패밀리 박스 치수를 파생시킨다. 맵 내용은 `arena.ts`로 분리하고 `map.ts`는 충돌 판정만 남긴다. 서버는 맵 사본을 버리고 손으로 정한 `SPAWN_POINTS`만 갖는다. 새 `check:map`이 불변식(실루엣 일치, 빈 슬롯 존재·도달성, 중앙 시선 차단)을 강제한다.

**Tech Stack:** TypeScript, React Three Fiber, tsx 스크립트 기반 검사(테스트 프레임워크 없음)

**설계 문서:** [`docs/superpowers/specs/2026-07-28-arena-redesign-design.md`](../specs/2026-07-28-arena-redesign-design.md)

## Global Constraints

- 이 저장소는 테스트 프레임워크가 없다. 검증은 `scripts/check-*.ts`를 `tsx`로 돌리는 방식이며, 실패 시 `process.exit(1)`. 새 검사도 이 패턴을 그대로 따른다.
- `npm run check` = 타입체크 + check:sync + check:bodies + check:shop + check:movement + check:hub + check:audio + check:leaderboard + server:test. **모든 태스크가 끝날 때 전부 통과해야 한다.**
- 서버(`server/src/`)는 격리된 VM에서 돌아 `src/`를 import할 수 없다. 공유가 필요한 값은 복제하고 `check:sync`가 대조한다.
- 기존 상수는 바꾸지 않는다: `MOVE.playerRadius` 0.45, `MOVE.jumpSpeed` 7.4, `MOVE.gravity` 22, `STEP_HEIGHT` 0.45, `TOP_Y` 1.86, `FOOT_Y` 0.13.
- 파생 수치: 점프 정점 = 7.4² / (2·22) = **1.2445**, 올라탈 수 있는 최대 높이 = 정점 + STEP_HEIGHT = **1.6945**.
- 허브(`src/hub/hubMap.ts`)는 건드리지 않는다. `check:hub`는 계속 통과해야 한다.
- 커밋 메시지는 영어, 본문은 왜 그렇게 했는지를 적는다. 기존 이력의 스타일을 따른다.

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `src/game/poseBounds.ts` (신규) | 포즈+체형 → 바운딩 박스. 순수, 의존성 없음 | 1 |
| `src/game/arena.ts` (신규) | `MapBox`·`ARENA`·색상·구역 테이블·`buildArena()`·`MAP_BOXES`·`SPAWN_POINTS` | 2,3,5,6 |
| `src/game/map.ts` (수정) | 충돌 판정만. `arena.ts`를 import하고 re-export | 2 |
| `server/src/rules.ts` (수정) | 맵 사본 삭제, `SPAWN_POINTS` 추가 | 3 |
| `scripts/check-map.ts` (신규) | 아레나 불변식 | 4 |
| `scripts/check-sync.ts` (수정) | 박스 대조 → 스폰 지점 대조 | 3 |
| `scripts/check-bodies.ts` (수정) | 실루엣 앵커 검사 추가 | 1 |
| `scripts/check-movement.ts` (수정) | 패밀리 기대값으로 교체 | 4 |

---

### Task 1: poseBounds — 포즈 실루엣 순수 계산

`Humanoid.tsx`의 정지 자세를 순수 수학으로 재현한다. 패밀리 치수가 전부 여기서 나온다.

**Files:**
- Create: `src/game/poseBounds.ts`
- Modify: `scripts/check-bodies.ts`

**Interfaces:**
- Consumes: `BODIES`, `BodyProfile`, `derive`, `TOP_Y`, `FOOT_Y` (`src/game/bodies.ts`); `POSES`, `PoseSpec`, `STAND_POSE` (`src/game/constants.ts`)
- Produces:
  - `export interface Bounds { min: [number, number, number]; max: [number, number, number] }`
  - `export function poseBounds(profile: BodyProfile, poseIndex: number): Bounds`
  - `export function poseSize(profile: BodyProfile, poseIndex: number): { width: number; height: number; depth: number }`
  - `export function maxPoseSize(poseIndex: number): { width: number; height: number; depth: number }` — 전 체형 중 최대. **패밀리 박스 치수는 이것을 쓴다.**

- [ ] **Step 1: 실패하는 검사부터 — `scripts/check-bodies.ts` 끝(`if (failures === 0)` 직전)에 추가**

```ts
console.log("\npose silhouette (poseBounds mirrors Humanoid's rest layout)");
{
  // 서기 자세의 위/아래 끝은 bodies.ts가 독립적으로 알고 있는 값과 일치해야 한다.
  // poseBounds가 Humanoid의 정지 레이아웃에서 어긋나면 이 앵커가 먼저 깨진다.
  for (const b of BODIES) {
    const s = poseBounds(b, STAND_POSE);
    check(`${b.id}: 서기 실루엣의 정수리가 TOP_Y (${s.max[1].toFixed(4)})`, Math.abs(s.max[1] - TOP_Y) < 1e-9);
    check(`${b.id}: 서기 실루엣의 발바닥이 FOOT_Y (${s.min[1].toFixed(4)})`, Math.abs(s.min[1] - FOOT_Y) < 1e-9);
  }
  // 팔을 살짝 벌리고 서므로 실제 폭은 maxHalfWidth보다 넓어질 수만 있다.
  for (const b of BODIES) {
    const half = poseSize(b, STAND_POSE).width / 2;
    check(
      `${b.id}: 서기 폭이 maxHalfWidth 이상, +0.15 이내 (${half.toFixed(3)} vs ${maxHalfWidth(b).toFixed(3)})`,
      half >= maxHalfWidth(b) - 1e-9 && half <= maxHalfWidth(b) + 0.15
    );
  }
}
```

`scripts/check-bodies.ts` 상단 import에 추가:

```ts
import { poseBounds, poseSize } from "../src/game/poseBounds";
import { STAND_POSE } from "../src/game/constants";
```

(`BODIES`, `TOP_Y`, `FOOT_Y`, `maxHalfWidth`는 이미 import되어 있는지 확인하고, 없으면 `../src/game/bodies`에서 추가한다.)

- [ ] **Step 2: 실패 확인**

Run: `npm run check:bodies`
Expected: FAIL — `Cannot find module '../src/game/poseBounds'`

- [ ] **Step 3: `src/game/poseBounds.ts` 작성**

```ts
/**
 * 포즈별 실루엣 바운딩 박스.
 *
 * Humanoid.tsx의 **정지 자세**(걷기·점프·착지 스쿼시가 전부 0인 상태)를 순수
 * 수학으로 재현한다. 아레나의 사물 패밀리 치수가 여기서 파생되므로, 이 값이
 * 틀리면 "비슷한데 미묘하게 다른" 사물이 되어 위장이 오히려 더 눈에 띈다.
 *
 * Humanoid와 어긋날 위험은 check:bodies가 막는다 — 서기 자세의 위/아래 끝이
 * bodies.ts가 독립적으로 아는 TOP_Y / FOOT_Y와 정확히 일치하는지 검사한다.
 * 한쪽만 바뀌면 그 앵커가 먼저 깨진다.
 *
 * three.js에 의존하지 않는다. 검사 스크립트가 렌더러 없이 돌아야 하기 때문.
 */

import { POSES } from "./constants";
import { derive, BODIES, type BodyProfile } from "./bodies";

type V3 = [number, number, number];

/** three.js 오일러 기본 순서 XYZ는 R = Rx·Ry·Rz, 즉 Z가 먼저 적용된다. */
function rotZ([x, y, z]: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c, z];
}

function rotX([x, y, z]: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}

function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** 한 부위: 선분 양 끝점(구면은 두 점이 같음) + 반지름. */
interface Part {
  points: V3[];
  r: number;
}

export interface Bounds {
  min: V3;
  max: V3;
}

/**
 * 루트 그룹의 자식 공간에서 본 각 부위. Humanoid의 JSX 배치와 useFrame이
 * 정지 상태에서 수렴하는 값을 그대로 옮긴 것이다.
 */
function restParts(p: BodyProfile, poseIndex: number): Part[] {
  const spec = POSES[Math.min(Math.max(poseIndex | 0, 0), POSES.length - 1)];
  const { headY, hipY, armHalf, legHalf } = derive(p);
  const parts: Part[] = [];

  // 머리 — 구.
  parts.push({ points: [[0, headY, 0]], r: p.head.r });

  // 몸통 — 캡슐. 실린더가 ±l/2, 캡이 반지름만큼 더 나간다.
  parts.push({
    points: [
      [0, p.torso.y - p.torso.l / 2, 0],
      [0, p.torso.y + p.torso.l / 2, 0],
    ],
    r: p.torso.r,
  });

  // 팔 — 어깨 그룹(회전 X=armPitch, Z=∓armSpread) 안에서 (0, -armHalf, 0)에 매달림.
  for (const side of [-1, 1]) {
    const local: V3[] = [
      [0, -armHalf - p.arm.l / 2, 0],
      [0, -armHalf + p.arm.l / 2, 0],
    ];
    const origin: V3 = [side * p.shoulderX, p.shoulderY, 0];
    parts.push({
      points: local.map((v) => add(rotX(rotZ(v, side * spec.armSpread), spec.armPitch), origin)),
      r: p.arm.r,
    });
  }

  // 다리 — 엉덩이 그룹(회전 X=legPitch). legSpread가 hipX를 곱한다.
  for (const side of [-1, 1]) {
    const local: V3[] = [
      [0, -legHalf - p.leg.l / 2, 0],
      [0, -legHalf + p.leg.l / 2, 0],
    ];
    const origin: V3 = [side * p.hipX * spec.legSpread, hipY, 0];
    parts.push({
      points: local.map((v) => add(rotX(v, spec.legPitch), origin)),
      r: p.leg.r,
    });
  }

  return parts;
}

export function poseBounds(p: BodyProfile, poseIndex: number): Bounds {
  const spec = POSES[Math.min(Math.max(poseIndex | 0, 0), POSES.length - 1)];
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];

  // 루트는 scale(1, scaleY, 1) → rotX(pitch) → translate(0, lift, 0) 순으로 적용된다
  // (three.js의 matrix = T·R·S). 비균일 스케일이 구를 타원체로 만들므로 반지름도
  // 축별로 따로 다뤄야 한다. 회전은 X축이라 x 반경은 그대로다.
  const cp = Math.cos(spec.pitch);
  const sp = Math.sin(spec.pitch);

  for (const part of restParts(p, poseIndex)) {
    const ex = part.r;
    const ey = Math.hypot(part.r * spec.scaleY * cp, part.r * sp);
    const ez = Math.hypot(part.r * spec.scaleY * sp, part.r * cp);

    for (const v of part.points) {
      const scaled: V3 = [v[0], v[1] * spec.scaleY, v[2]];
      const w = add(rotX(scaled, spec.pitch), [0, spec.lift, 0]);
      const e: V3 = [ex, ey, ez];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], w[i] - e[i]);
        max[i] = Math.max(max[i], w[i] + e[i]);
      }
    }
  }

  return { min, max };
}

export function poseSize(p: BodyProfile, poseIndex: number) {
  const b = poseBounds(p, poseIndex);
  return {
    width: b.max[0] - b.min[0],
    height: b.max[1] - b.min[1],
    depth: b.max[2] - b.min[2],
  };
}

/**
 * 전 체형 중 최대 치수. 사물 패밀리는 이걸로 치수를 잡는다 — 어떤 아바타를
 * 입어도 사물보다 커지지 않아야 위장이 성립한다.
 */
export function maxPoseSize(poseIndex: number) {
  const sizes = BODIES.map((b) => poseSize(b, poseIndex));
  return {
    width: Math.max(...sizes.map((s) => s.width)),
    height: Math.max(...sizes.map((s) => s.height)),
    depth: Math.max(...sizes.map((s) => s.depth)),
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run check:bodies`
Expected: PASS — 서기 자세의 정수리/발바닥 앵커가 `TOP_Y` 1.86 / `FOOT_Y` 0.13과 1e-9 이내로 일치.

**실패하면**: 앵커가 안 맞는다는 것은 `restParts`가 `Humanoid.tsx`의 배치와 어긋났다는 뜻이다. `Humanoid.tsx:202-223`의 JSX 위치와 `useFrame`이 정지 상태에서 수렴하는 값(`spec.*`만 남고 `swing`/`air`/`bob`은 0)을 다시 대조한다. 추측으로 상수를 맞추지 말 것 — 그게 R1이 경고한 실패 모드다.

- [ ] **Step 5: 실측값 기록**

Run: `npx tsx -e "import {maxPoseSize} from './src/game/poseBounds'; import {POSES} from './src/game/constants'; POSES.forEach((p,i)=>console.log(p.id, JSON.stringify(maxPoseSize(i))))"`

출력된 4개 포즈의 치수를 이 계획서 Task 5·6의 표에 반영한다. 설계 문서의 1.2 / 0.4 / 2.3은 **어림값**이므로 실측값으로 교체한다.

**실측 결과 (2026-07-29, 전 체형 중 최대):**

| 포즈 | 패밀리 | width | depth | 실루엣 꼭대기 `max.y` | 바닥 `min.y` |
|---|---|---|---|---|---|
| stand (0) | 드럼통 | 0.986 | 0.800 | **1.860** (= `TOP_Y`) | 0.130 |
| lie (1) | 팔레트 | 1.460 | 1.637 | 0.948 | 0.148 |
| banzai (2) | 선반기둥 | 1.267 | 0.800 | **2.039** | 0.155 |
| sit (3) | 화물상자 | 1.113 | 0.979 | **1.187** | 0.063 |

바닥에 놓는 박스의 높이는 `max.y`를 쓴다 (박스는 y=0부터 시작하므로 실루엣 높이가 아니라
꼭대기 높이가 곧 박스 높이다). 서기 포즈의 `max.y`가 정확히 `TOP_Y`인 것은 우연이 아니라
`check:bodies`가 강제하는 앵커다.

실측이 설계 문서의 어림값과 어긋난 것 둘:

- **팔레트**: 눕기 실루엣 꼭대기가 0.948이라 `STEP_HEIGHT` 0.45의 두 배가 넘는다. Task 6
  Step 1이 예고한 분기가 실제로 발동한다 — 폭·깊이만 눕기에서 따오고 높이는 0.4로 고정한다.
- **선반기둥**: 만세 포즈는 팔을 위로 **벌리므로** 폭이 1.267이다. 설계 문서의 0.6은
  틀렸다. 가는 기둥이 아니라 넓적한 판에 가깝다.

`sit`의 꼭대기 1.187은 점프 도달(1.6945) 아래이므로 화물상자는 예정대로 "점프로 올라가는"
패밀리가 맞다. `banzai` 2.039와 `stand` 1.86은 둘 다 1.6945를 넘어 올라탈 수 없다.

- [ ] **Step 6: 커밋**

```bash
git add src/game/poseBounds.ts scripts/check-bodies.ts
git commit -m "feat: compute pose silhouettes as pure geometry"
```

---

### Task 2: arena.ts 분리 — 내용과 충돌 판정을 나눈다

동작은 한 줄도 바뀌지 않는다. 기존 검사가 그대로 통과하는 것이 곧 검증이다.

**Files:**
- Create: `src/game/arena.ts`
- Modify: `src/game/map.ts`

**Interfaces:**
- Produces: `arena.ts`에서 `MapBox`, `ARENA`, `FLOOR_COLOR`, `WALL_COLOR`, `MAP_SEED`, `buildMap`, `MAP_BOXES`. `map.ts`는 이들을 전부 re-export하므로 **다른 파일의 import는 바뀌지 않는다.**

- [ ] **Step 1: `src/game/map.ts`의 1~72행(파일 상단 주석부터 `export const MAP_BOXES` 까지)을 잘라 `src/game/arena.ts`로 옮긴다**

파일 상단 주석을 다음으로 교체한다:

```ts
/**
 * 아레나의 내용 — 지오메트리 그 자체. 충돌 판정은 map.ts에 있다.
 *
 * 한 방향으로만 의존한다: map.ts → arena.ts. 이 파일은 충돌 헬퍼를 import하지
 * 않으므로 순환이 생기지 않는다.
 *
 * buildMap()은 server/src/rules.ts에 그대로 복제되어 있었다. Task 3에서
 * 서버 사본이 사라진다.
 */
```

- [ ] **Step 2: `src/game/map.ts` 상단을 다음으로 교체**

```ts
/**
 * 충돌 판정. 아레나의 내용은 arena.ts에 있다.
 *
 * 기존 import 경로를 지키기 위해 arena.ts의 이름을 그대로 re-export한다 —
 * 이 프로젝트의 다른 파일과 검사 스크립트는 전부 "./map"에서 가져온다.
 */

import { MAP_BOXES, ARENA, type MapBox } from "./arena";

export { MAP_BOXES, ARENA, FLOOR_COLOR, WALL_COLOR, MAP_SEED, buildMap } from "./arena";
export type { MapBox } from "./arena";
```

`// ---------------------------------------------------------------- collision` 아래(현재 74행 이후)는 그대로 둔다.

- [ ] **Step 3: 타입체크와 전체 검사**

Run: `npx tsc --noEmit && npm run check`
Expected: 전부 통과. **박스 하나도 바뀌지 않았으므로 `check:sync`도 그대로 통과해야 한다.** 실패하면 옮기는 과정에서 내용이 바뀐 것이다.

- [ ] **Step 4: 커밋**

```bash
git add src/game/arena.ts src/game/map.ts
git commit -m "refactor: split arena content out of the collision module"
```

---

### Task 3: SPAWN_POINTS와 서버 맵 사본 삭제

**배치보다 먼저 한다.** `check:sync`가 클라/서버 박스를 대조하므로, 서버가 맵을 들고 있는 한 배치를 한 번 건드릴 때마다 검사가 깨진다.

**Files:**
- Modify: `src/game/arena.ts`, `server/src/rules.ts`, `scripts/check-sync.ts`

**Interfaces:**
- Produces: `export const SPAWN_POINTS: [number, number][]` (양쪽에 동일하게), `randomSpawn()`은 시그니처 유지 `(): [number, number, number]`

- [ ] **Step 1: `src/game/arena.ts` 끝에 추가**

현재 맵과 새 맵 양쪽에서 비어 있는 바깥 링 위의 지점들이다. Task 6에서 최종 배치에 맞춰 재검토한다.

```ts
/**
 * 하이더 스폰 지점.
 *
 * 손으로 고른다. 이유가 두 가지다. 첫째, 서버가 맵을 필요로 하는 유일한 이유가
 * "지오메트리 안이 아닌 자리 찾기"였는데, 이 목록만 있으면 서버가 박스 전체를
 * 복제할 이유가 없어진다. 둘째, 무작위 스폰은 빈자리만 보장하지만 손으로 고르면
 * **의도된 은신 슬롯 위에서 시작하지 않는 것**까지 보장한다.
 *
 * 술래는 [0,0,0] 중앙 고정이므로(server.ts) 여기에 포함하지 않는다.
 */
export const SPAWN_POINTS: [number, number][] = [
  [-17, -17], [-17, 0], [-17, 17],
  [0, -17], [0, 17],
  [17, -17], [17, 0], [17, 17],
  [-9, -19], [9, -19], [-9, 19], [9, 19],
];
```

- [ ] **Step 2: `server/src/rules.ts`에서 맵 사본 삭제**

`CLUSTERS` 상수, `rng()`, `buildMap()`, `MAP_BOXES`, `isOpen()`, `FLOOR_COLOR`/`WALL_COLOR`/`MAP_SEED`, `MapBox` 타입을 삭제한다. `randomSpawn()`을 다음으로 교체한다:

```ts
/**
 * 스폰 지점 — src/game/arena.ts와 동일해야 하며 check:sync가 대조한다.
 *
 * 서버가 아레나 지오메트리를 들고 있던 유일한 이유가 randomSpawn의 빈자리
 * 탐색이었다. 손으로 고른 목록이 그 일을 대신하므로 맵 사본이 통째로 사라졌다.
 * 이동 검증은 직전 위치 대비 거리 clamp라 박스를 보지 않는다.
 */
export const SPAWN_POINTS: [number, number][] = [
  [-17, -17], [-17, 0], [-17, 17],
  [0, -17], [0, 17],
  [17, -17], [17, 0], [17, 17],
  [-9, -19], [9, -19], [-9, 19], [9, 19],
];

export function randomSpawn(): [number, number, number] {
  const p = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  return [p[0], 0, p[1]];
}
```

`ARENA`는 남긴다 (`check:sync`가 대조하고, 다른 서버 로직이 참조할 수 있다). 삭제 후 `npx tsc --noEmit`으로 미사용 import를 정리한다.

- [ ] **Step 3: `scripts/check-sync.ts` 수정**

`CLIENT_BOXES`/`SERVER_BOXES` 대조 블록 전체를 삭제하고 다음으로 교체한다. `isOpen` import도 제거한다.

```ts
{
  // 서버는 더 이상 맵을 갖지 않는다. 남은 공유 계약은 스폰 지점뿐이다.
  const a = CLIENT_SPAWNS;
  const b = SERVER_SPAWNS;
  if (a.length !== b.length) {
    fail(`spawn point count differs: client ${a.length}, server ${b.length}`);
  } else {
    let bad = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) bad++;
    }
    if (bad) fail(`${bad} spawn points differ between client and server`);
    else console.log(`  ✓ ${a.length} spawn points identical on both sides`);
  }
}
```

import를 다음으로 맞춘다:

```ts
import { SPAWN_POINTS as CLIENT_SPAWNS, ARENA as CLIENT_ARENA } from "../src/game/arena";
import { SPAWN_POINTS as SERVER_SPAWNS, ARENA as SERVER_ARENA, /* 기존 나머지 */ } from "../server/src/rules";
```

- [ ] **Step 4: 전체 검사 — 서버 테스트가 핵심**

Run: `npm run check`
Expected: 전부 통과. 특히 서버 테스트 22개 (`joinGame`, `matchmaking never drops a player into the hub` 등)가 통과해야 한다. **이게 R3의 안전망이다.**

- [ ] **Step 5: 커밋**

```bash
git add src/game/arena.ts server/src/rules.ts scripts/check-sync.ts
git commit -m "refactor: give the server spawn points instead of a copy of the map"
```

---

### Task 4: check:map — 불변식을 배치보다 먼저 못 박는다

**Files:**
- Create: `scripts/check-map.ts`
- Modify: `package.json`, `scripts/check-movement.ts`

**Interfaces:**
- Consumes: `MAP_BOXES`, `SPAWN_POINTS`, `ARENA` (arena.ts); `groundHeightAt`, `playerBlockedAt`, `STEP_HEIGHT` (map.ts); `createMotionState`, `stepMotion` (movement.ts); `maxPoseSize` (poseBounds.ts)
- Produces: `npm run check:map`

- [ ] **Step 1: `scripts/check-map.ts` 작성**

`scripts/check-hub.ts`의 `walkTo` 패턴을 재사용한다 — 실제 물리로 걸어가 도달성을 확인하는 방식.

```ts
/**
 * 아레나 불변식.
 *
 * 이 맵은 절차적 생성이 아니라 손설계이므로, "의도한 대로 되었는가"를 사람이
 * 눈으로 세는 대신 여기서 강제한다. 특히 은신 슬롯은 설계의 핵심 산출물이라
 * 존재·비어있음·도달 가능함을 전부 검사한다.
 *
 * Run: npm run check:map
 */

import { MAP_BOXES, SPAWN_POINTS, ARENA } from "../src/game/arena";
import { groundHeightAt, playerBlockedAt, STEP_HEIGHT } from "../src/game/map";
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

function occupied(x: number, z: number): boolean {
  return playerBlockedAt(x, z, 0, MOVE.playerRadius, MAP_BOXES);
}

/** 점프로 올라갈 수 있는 최대 높이. */
const MOUNTABLE = (MOVE.jumpSpeed * MOVE.jumpSpeed) / (2 * MOVE.gravity) + STEP_HEIGHT;

/** check-hub.ts와 같은 방식: 게임의 실제 적분기로 걸어가 본다. */
function walkFrom(start: [number, number], target: [number, number], maxSeconds = 30): number {
  const state = createMotionState([start[0], 0, start[1]]);
  const dt = 1 / 60;
  let best = Infinity;

  for (let i = 0; i < maxSeconds / dt; i++) {
    const dx = target[0] - state.pos[0];
    const dz = target[1] - state.pos[2];
    best = Math.min(best, Math.hypot(dx, dz));
    if (best < 0.4) break;

    const before: [number, number] = [state.pos[0], state.pos[2]];
    const base = Math.atan2(dx, dz);
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4]) {
      const probe = {
        ...state,
        pos: [...state.pos] as [number, number, number],
        vel: [...state.vel] as [number, number],
      };
      stepMotion(probe, { forward: 1, strafe: 0, jump: false }, base + off, {
        boxes: MAP_BOXES,
        dt,
        now: i * dt * 1000,
        speed: MOVE.hiderSpeed,
        radius: MOVE.playerRadius,
        worldHalfSize: ARENA.size / 2,
      });
      const moved = Math.hypot(probe.pos[0] - before[0], probe.pos[2] - before[1]);
      if (moved > 0.005 || off === 2.4 || off === -2.4) {
        state.pos = probe.pos;
        state.vel = probe.vel;
        state.vy = probe.vy;
        state.grounded = probe.grounded;
        state.lastGroundedAt = probe.lastGroundedAt;
        break;
      }
    }
  }
  return best;
}

/** 두 점을 잇는 선분이 어떤 박스의 옆면에 막히는지 — 눈높이에서 본다. */
function sightBlocked(from: [number, number], to: [number, number], eyeY = 1.5): boolean {
  const steps = 400;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    for (const b of MAP_BOXES) {
      const top = b.p[1] + b.s[1] / 2;
      const bottom = b.p[1] - b.s[1] / 2;
      if (eyeY < bottom || eyeY > top) continue;
      if (Math.abs(x - b.p[0]) < b.s[0] / 2 && Math.abs(z - b.p[2]) < b.s[2] / 2) return true;
    }
  }
  return false;
}

console.log("\nspawn points");

for (const [x, z] of SPAWN_POINTS) {
  check(`(${x}, ${z}) 는 설 수 있는 자리`, !occupied(x, z));
  check(`(${x}, ${z}) 는 바닥 위`, groundHeightAt(x, z, 0, MAP_BOXES) === 0);
}
check("스폰 지점이 8개 이상 (MAX_PLAYERS 8)", SPAWN_POINTS.length >= 8);

console.log("\nfamily step rules");
{
  // 팔레트는 걸어 넘어가야 하고, 나머지 사물은 점프를 요구해야 한다.
  // 높이로 패밀리를 판별한다 — 배치 테이블이 바뀌어도 규칙은 유지된다.
  const walkable = MAP_BOXES.filter((b) => b.p[1] + b.s[1] / 2 <= STEP_HEIGHT);
  const mountable = MAP_BOXES.filter((b) => {
    const top = b.p[1] + b.s[1] / 2;
    return top > STEP_HEIGHT && top <= MOUNTABLE;
  });
  const tall = MAP_BOXES.filter((b) => b.p[1] + b.s[1] / 2 > MOUNTABLE);

  check(`걸어 넘는 사물이 존재 (${walkable.length}개, 팔레트)`, walkable.length > 0);
  check(`점프로 올라가는 사물이 존재 (${mountable.length}개, 화물상자)`, mountable.length > 0);
  check(`올라탈 수 없는 사물이 존재 (${tall.length}개, 드럼통·기둥·칸막이)`, tall.length > 0);
}

console.log("\nsightlines from the centre");
{
  // 술래는 [0,0,0]에서 시작한다. 한자리에서 네 구역을 다 훑을 수 있으면
  // 칸막이가 제 일을 못 하는 것이다.
  const zones: [string, [number, number]][] = [
    ["드럼통", [-12, -12]],
    ["팔레트", [12, -12]],
    ["화물상자", [-12, 12]],
    ["선반기둥", [12, 12]],
  ];
  for (const [name, c] of zones) {
    check(`중앙에서 ${name} 구역 중심이 보이지 않는다`, sightBlocked([0, 0], c));
  }
}

if (failures === 0) {
  console.log("\n✅ arena invariants hold\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
```

**주의**: 이 시점에는 아직 구역이 없으므로 `sightlines`와 `family step rules` 블록은 **실패한다.** 정상이다 — 검사가 배치의 완성 조건을 정의하고, Task 5·6이 그것을 만족시킨다.

- [ ] **Step 2: `package.json`에 스크립트 추가**

`"check:hub"` 줄 다음에 추가하고, `"check"` 체인의 `check:hub` 뒤에 `&& npm run check:map`을 넣는다.

```json
"check:map": "tsx scripts/check-map.ts",
```

- [ ] **Step 3: 실패 확인 (기대된 실패)**

Run: `npm run check:map`
Expected: FAIL — 시선 4개와 걸어 넘는 사물 검사가 실패. 스폰 지점 검사는 통과해야 한다(현재 맵에서도 빈자리이므로). 스폰이 실패하면 `SPAWN_POINTS` 좌표를 옮긴다.

- [ ] **Step 4: `scripts/check-movement.ts`의 아레나 의존 단언을 패밀리 규칙으로 교체**

`"the shortest arena crate (h=...) is not walkable"` 블록은 팔레트가 생기는 순간 실패한다. 삭제하고, `"tall crate"` 블록도 랜덤 맵 전제이므로 삭제한다. 패밀리 규칙은 `check:map`이 담당한다. `STEP_HEIGHT` 경계 검사와 실제 적분기로 상자에 걸어 들어가는 검사는 **그대로 남긴다** — 그건 합성 지오메트리를 쓰므로 맵과 무관하다.

- [ ] **Step 5: 커밋**

```bash
git add scripts/check-map.ts scripts/check-movement.ts package.json
git commit -m "test: state the arena's invariants before building it"
```

---

### Task 5: 관문 — 드럼통 구역 하나만 만들고 눈으로 확인

**이 태스크가 설계 전체의 관문이다.** 미미크리가 통하지 않으면 여기서 멈추고 방향을 다시 잡는다.

**Files:**
- Modify: `src/game/arena.ts`

**Interfaces:**
- Produces: `interface Family { id: string; box: [number, number, number]; colors: [number, number] }`, `FAMILIES`, `interface Cluster { family: string; at: [number, number]; axis: "x" | "z"; count: number; emptyIndex: number }`, `CLUSTERS`

- [ ] **Step 1: `src/game/arena.ts`의 `buildMap()`을 테이블 기반으로 교체**

`rng()`, 기존 `CLUSTERS`, 기존 `buildMap` 본문을 삭제하고 다음을 넣는다. `MAP_SEED`도 삭제한다(더 이상 난수가 없다).

드럼통 박스 치수는 **Task 1 Step 5에서 실측한 서기 자세 값**을 쓴다. 아래 `DRUM_W`/`DRUM_D`는 그 값으로 교체할 것 — 높이만 `TOP_Y`와 같음이 확정이다.

```ts
import { TOP_Y } from "./bodies";

/** 사물 패밀리. 박스 치수는 대응 포즈의 실루엣에서 나온다. */
export interface Family {
  id: string;
  /** [width, height, depth] */
  box: [number, number, number];
  /** 두 톤. 같은 색만 쓰면 하이더의 페인트가 조금만 어긋나도 즉시 튄다. */
  colors: [number, number];
}

// Task 1의 maxPoseSize("stand")에서 나온 실측값으로 채운다.
const DRUM_W = 0.9;
const DRUM_D = 0.9;

export const FAMILIES: Family[] = [
  { id: "drum", box: [DRUM_W, TOP_Y, DRUM_D], colors: [0xc75b39, 0xe08a5f] },
];

/**
 * 한 무리 = 일렬로 선 사물 + **의도적으로 비워둔 자리 하나**.
 *
 * 사물 사이 간격(spacing - box)에는 플레이어가 들어갈 수 없다. 들어갈 수 있는
 * 것은 비워둔 슬롯뿐이고, 그게 곧 설계된 은신처다.
 */
export interface Cluster {
  family: string;
  /** 첫 사물의 중심. */
  at: [number, number];
  axis: "x" | "z";
  count: number;
  /** 0..count-1 중 비워둘 인덱스. */
  emptyIndex: number;
  spacing: number;
}

export const CLUSTERS: Cluster[] = [
  { family: "drum", at: [-17, -16], axis: "x", count: 6, emptyIndex: 3, spacing: 1.5 },
  { family: "drum", at: [-18, -14], axis: "z", count: 4, emptyIndex: 2, spacing: 1.5 },
  { family: "drum", at: [-9.5, -18.5], axis: "z", count: 4, emptyIndex: 1, spacing: 1.5 },
];

/** 무리의 비워둔 슬롯 중심 좌표. check:map이 이걸 검사한다. */
export function slotOf(c: Cluster): [number, number] {
  const d = c.emptyIndex * c.spacing;
  return c.axis === "x" ? [c.at[0] + d, c.at[1]] : [c.at[0], c.at[1] + d];
}

function familyOf(id: string): Family {
  const f = FAMILIES.find((x) => x.id === id);
  if (!f) throw new Error(`unknown family: ${id}`);
  return f;
}

export function buildArena(): MapBox[] {
  const boxes: MapBox[] = [];
  const half = ARENA.size / 2;
  const t = ARENA.wallThickness;
  const wy = ARENA.wallHeight / 2;

  boxes.push({ p: [0, wy, -half], s: [ARENA.size + t * 2, ARENA.wallHeight, t], c: WALL_COLOR });
  boxes.push({ p: [0, wy, half], s: [ARENA.size + t * 2, ARENA.wallHeight, t], c: WALL_COLOR });
  boxes.push({ p: [-half, wy, 0], s: [t, ARENA.wallHeight, ARENA.size + t * 2], c: WALL_COLOR });
  boxes.push({ p: [half, wy, 0], s: [t, ARENA.wallHeight, ARENA.size + t * 2], c: WALL_COLOR });

  for (const c of CLUSTERS) {
    const f = familyOf(c.family);
    for (let i = 0; i < c.count; i++) {
      if (i === c.emptyIndex) continue;
      const d = i * c.spacing;
      const x = c.axis === "x" ? c.at[0] + d : c.at[0];
      const z = c.axis === "z" ? c.at[1] + d : c.at[1];
      boxes.push({
        p: [x, f.box[1] / 2, z],
        s: [...f.box] as [number, number, number],
        // 두 톤을 번갈아 — 무리 안에 이미 편차가 있어야 어설픈 칠도 통한다.
        c: f.colors[i % 2],
      });
    }
  }

  return boxes;
}

export const MAP_BOXES: MapBox[] = buildArena();
```

`map.ts`의 re-export에서 `buildMap`을 `buildArena`로 바꾸고, `MAP_SEED` re-export를 제거한다. `npx tsc --noEmit`으로 남은 참조를 찾아 고친다.

- [ ] **Step 2: `check:map`에 슬롯 검사 추가**

`scripts/check-map.ts`의 `spawn points` 블록 다음에 넣는다. import에 `CLUSTERS`, `slotOf`, `FAMILIES`를 추가한다.

```ts
console.log("\ndesigned hiding slots");

for (const c of CLUSTERS) {
  const [sx, sz] = slotOf(c);
  const label = `${c.family} @ (${sx.toFixed(1)}, ${sz.toFixed(1)})`;

  check(`${label}: 슬롯이 비어 있다`, !occupied(sx, sz));

  // 같은 패밀리 사물 2개 이상과 인접해야 "무리의 일부"로 읽힌다.
  const near = MAP_BOXES.filter(
    (b) => Math.hypot(b.p[0] - sx, b.p[2] - sz) <= c.spacing * 1.6 && b.s[1] < ARENA.wallHeight
  );
  check(`${label}: 같은 무리 사물 2개 이상과 인접 (${near.length})`, near.length >= 2);

  // 모든 스폰에서 걸어서 닿아야 한다. 하나라도 못 닿으면 그 스폰의 플레이어에게는
  // 없는 은신처다.
  let worst = 0;
  let worstFrom: [number, number] = SPAWN_POINTS[0];
  for (const s of SPAWN_POINTS) {
    const d = walkFrom(s, [sx, sz]);
    if (d > worst) {
      worst = d;
      worstFrom = s;
    }
  }
  check(
    `${label}: 모든 스폰에서 도달 가능 (최악 ${worst.toFixed(2)}u, (${worstFrom}) 에서)`,
    worst <= 1.0
  );
}
```

- [ ] **Step 3: 검사 실행**

Run: `npm run check:map`
Expected: 스폰·슬롯 검사 통과. **시선 검사 4개와 걸어 넘는 사물 검사는 여전히 실패** — 칸막이와 다른 패밀리가 Task 6에서 들어온다.

슬롯 도달성이 실패하면 무리 좌표를 옮긴다. 검사가 배치를 이끄는 것이 이 설계의 요지다.

- [ ] **Step 4: 나머지 검사와 빌드**

Run: `npx tsc --noEmit && npm run check:sync && npm run check:movement && npm run check:hub && npx vite build`
Expected: 전부 통과. `check:sync`는 이제 스폰 지점만 보므로 맵이 바뀌어도 통과한다.

- [ ] **Step 5: 관문 — 브라우저에서 눈으로 확인**

**미리보기 패널을 화면에 띄운 상태에서** 진행한다. 패널이 안 보이면 페이지가 백그라운드 탭이 되어 `requestAnimationFrame`이 돌지 않고 R3F가 마운트조차 하지 않는다(HANDOFF 6차 세션 기록 참고).

1. `npm run dev`, 접속, 포털로 매치 입장.
2. 드럼통 무리(약 `-12, -16`)로 걸어간다.
3. 스포이드(`F` → 스포이드)로 드럼통 색을 뽑고 몸을 칠한다.
4. 비워둔 슬롯에 **서기** 자세로 선다.
5. 뒤로 10~15u 물러나서 본다.

**판정 기준**: 몇 미터 밖에서 봤을 때 사람인지 드럼통인지 **즉시 구분되지 않으면 통과**다. 한눈에 사람이면 실패다.

- [ ] **Step 6: 관문 결과에 따라 분기**

**통과**: Task 6으로 진행.

**실패**: 여기서 멈춘다. 나머지 3구역을 만들지 않는다. 설계 문서의 후퇴로를 실행한다 — 섹션 2(미미크리)를 버리고 "구조 우선(방·복도)" 접근으로 선회하며, 그 전에 관문에서 **무엇이 어떻게 보였는지**(스크린샷 포함)를 설계 문서에 追記하고 사용자와 상의한다.

- [ ] **Step 7: 커밋**

```bash
git add src/game/arena.ts src/game/map.ts scripts/check-map.ts
git commit -m "feat: build the drum zone as the mimicry gate"
```

---

### Task 6: 나머지 3구역과 칸막이

관문 통과 후에만 진행한다.

**Files:**
- Modify: `src/game/arena.ts`, `scripts/check-map.ts`

- [ ] **Step 1: `FAMILIES`에 3종 추가**

치수는 **Task 1 Step 5의 실측값**으로 채운다. 아래 주석의 어림값을 그대로 쓰지 말 것.

```ts
export const FAMILIES: Family[] = [
  { id: "drum", box: [DRUM_W, TOP_Y, DRUM_D], colors: [0xc75b39, 0xe08a5f] },
  // 앉기 실루엣 — maxPoseSize(3)
  { id: "crate", box: [CRATE_W, CRATE_H, CRATE_D], colors: [0x6b4e9e, 0x9179c4] },
  // 눕기 실루엣 — maxPoseSize(1). 높이가 STEP_HEIGHT(0.45) 이하라 걸어 넘는다.
  { id: "pallet", box: [PALLET_W, PALLET_H, PALLET_D], colors: [0xd4a53f, 0xe8c66b] },
  // 만세 실루엣 — maxPoseSize(2)
  { id: "pillar", box: [PILLAR_W, PILLAR_H, PILLAR_D], colors: [0x2f8f8a, 0x49b3ad] },
];
```

**팔레트 높이가 실측상 `STEP_HEIGHT`(0.45)를 넘으면** 걸어 넘는 사물이 없어져 `check:map`이 실패한다. 그 경우 팔레트는 눕기 실루엣의 **폭·깊이만** 따르고 높이는 0.4로 고정하며, 그 이유를 코드 주석에 남긴다(눕는 위장은 "팔레트 위에 눕기"로 성립하지 `팔레트인 척 서기`가 아니다).

- [ ] **Step 2: 구역별 무리를 `CLUSTERS`에 추가**

각 구역 중심 기준으로 무리 3개씩, 무리마다 빈 슬롯 1개. 좌표는 `check:map`을 돌려가며 맞춘다.

- 팔레트 구역 중심 `(12, -12)`
- 화물상자 구역 중심 `(-12, 12)`
- 선반기둥 구역 중심 `(12, 12)`

- [ ] **Step 3: 칸막이 추가**

`buildArena()`의 무리 루프 앞에 넣는다. 가운데 6u를 비운 풍차 배치다.

```ts
/**
 * 칸막이 — 풍차 배치. 각 구역이 중앙에서 오는 시선에 대해 가려진다.
 *
 * 높이 2.4는 두 가지를 동시에 만족한다: 점프 도달 1.69보다 높아 올라탈 수 없고,
 * CAMERA.eyeHeight 1.5보다 높아 서서 넘어다볼 수 없다.
 *
 * 가운데를 비운다. 끝을 비우면 빙 도는 미로가 되어 추격이 답답해진다.
 */
const PARTITION_H = 2.4;
const PARTITION_T = 0.6;

const PARTITIONS: [number, number, number, number][] = [
  // [x1, z1, x2, z2] — 축 정렬 선분
  [-19, -6, -13, -6],
  [-7, -6, -1, -6],
  [6, -19, 6, -13],
  [6, -7, 6, -1],
  [19, 6, 13, 6],
  [7, 6, 1, 6],
  [-6, 19, -6, 13],
  [-6, 7, -6, 1],
];

for (const [x1, z1, x2, z2] of PARTITIONS) {
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const w = Math.abs(x2 - x1) || PARTITION_T;
  const d = Math.abs(z2 - z1) || PARTITION_T;
  boxes.push({ p: [cx, PARTITION_H / 2, cz], s: [w, PARTITION_H, d], c: WALL_COLOR });
}
```

- [ ] **Step 4: `check:map` 전체 통과까지 좌표 조정**

Run: `npm run check:map`
Expected: **전부 통과** — 스폰, 슬롯(무리 12개), 패밀리 계단 규칙 3종, 중앙 시선 차단 4개.

시선 검사가 실패하면 칸막이 선분을 늘리거나 옮긴다. 슬롯 도달성이 실패하면 칸막이가 통로를 막은 것이니 가운데 간격을 넓힌다.

- [ ] **Step 5: 스폰 지점 재검토**

배치가 굳었으니 `SPAWN_POINTS`가 여전히 빈자리이고 은신 슬롯 위가 아닌지 확인한다. 옮겼다면 `server/src/rules.ts`의 사본도 **같이** 고치고 `check:sync`로 확인한다.

- [ ] **Step 6: 전체 검사와 빌드**

Run: `npm run check && npx vite build`
Expected: 전부 통과.

- [ ] **Step 7: 브라우저에서 확인**

패널을 띄운 상태로, 네 구역을 걸어다니며 확인한다:
- 각 구역이 자기 팔레트로 읽히는가
- 중앙에서 어느 구역도 들여다보이지 않는가
- 칸막이 통로가 추격에 답답하지 않은가
- 프레임이 유지되는가 (R4 — 박스 90여 개)

- [ ] **Step 8: 커밋**

```bash
git add src/game/arena.ts scripts/check-map.ts server/src/rules.ts
git commit -m "feat: fill out the four zones and the pinwheel partitions"
```

---

### Task 7: 문서 갱신

**Files:**
- Modify: `README.md`, `HANDOFF.md`

- [ ] **Step 1: `README.md`**

- 아레나 설명을 절차적 생성 → 손설계 + 사물 패밀리로 교체
- "서버와 클라이언트에 맵 생성기가 중복" 관련 서술을 스폰 지점 공유로 교체
- 알려진 한계에 **R5(밸런스 미검증)** 추가: 숨기 45초 / 술래 90초는 옛 맵 기준이며 가려진 맵은 하이더에게 유리할 수 있음

- [ ] **Step 2: `HANDOFF.md`**

7차 세션 절을 추가한다. 관문(Task 5) 결과를 **실제로 무엇이 보였는지** 포함해 적는다 — 통과했다면 무엇이 통하게 만들었는지, 실패했다면 어떻게 보였는지. 미미크리는 이 프로젝트에서 처음 시도하는 것이라 다음 세션이 그 판단 근거를 알아야 한다.

- [ ] **Step 3: 커밋**

```bash
git add README.md HANDOFF.md
git commit -m "docs: record the arena redesign and what the mimicry gate showed"
```

---

## Self-Review 결과

**스펙 커버리지**: 설계 문서의 섹션 1(구조)=Task 6 Step 3, 섹션 2(패밀리·팔레트·빈 슬롯)=Task 1·5·6, 섹션 3(코드 구조·서버 축소·검사)=Task 2·3·4, 섹션 4(순서·R1~R6)=태스크 순서와 Task 5 Step 6의 후퇴로. R4(성능)=Task 6 Step 7. R5(밸런스)=Task 7 Step 1. R6(허브 무영향)=Global Constraints.

**설계 문서에서 바뀐 것 하나**: 설계 문서의 작업 순서는 "3. check:map → 6. 서버 슬림화"였으나, `check:sync`가 클라/서버 박스를 대조하므로 서버 슬림화를 **Task 3으로 앞당겼다.** 그러지 않으면 배치를 건드릴 때마다 `check:sync`가 깨져 매 단계를 초록으로 유지할 수 없다.

**미해결로 남긴 것**: 팔레트 높이가 눕기 실루엣 실측값과 `STEP_HEIGHT` 사이에서 충돌할 가능성 — Task 6 Step 1에 판단 기준과 대응을 명시했다.

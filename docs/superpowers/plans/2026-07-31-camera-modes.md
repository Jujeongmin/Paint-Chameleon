# 카메라 모드 (1인칭 술래 + R 자유비행) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 술래는 추적 페이즈 내내 1인칭으로 총을 들고 조준하고, 하이더는 R로 몸을 고정한 동안 카메라를 몸에서 떼어 맵 전체를 날아다닌다.

**Architecture:** 카메라 선택을 순수 함수 하나(`cameraModeFor`)로 뽑아 우선순위를 코드로 못박고, 1인칭은 기존 `updateFollowCamera`에 인자만 다르게 넣어 얻는다(거리 0, 눈높이 피벗, 페이드 없음). 총은 계속 몸의 오른손에 있고, 어깨를 고정 각도로 들어올린 뒤 손 그룹이 그 각도를 정확히 상쇄해 총열을 몸의 전방에 유지한다. 자유비행은 카메라가 자기 월드 좌표를 갖는 유일한 모드이며, 맵 크기에서 파생한 상자 안에 갇힌다.

**Tech Stack:** React 18 + @react-three/fiber 8 + three 0.169, TypeScript, 검사 스크립트는 tsx로 실행.

## Global Constraints

- 설계 문서: [`docs/superpowers/specs/2026-07-31-camera-modes-design.md`](../specs/2026-07-31-camera-modes-design.md). 충돌하면 설계 문서가 이긴다.
- **drei의 `useGLTF`/`useTexture`를 import하지 않는다.** `@react-three/fiber`가 두 번 pre-bundle되어 컴포넌트의 모든 훅이 `Invalid hook call`을 던진다. R3F의 `useLoader`를 쓴다.
- 소스 주석은 영어로, **왜** 그런지를 쓴다. 커밋 제목도 영어. README·HANDOFF·UI 문자열은 한국어.
- 검증 명령은 `npm run check` (tsc + 검사 스크립트 12개 + 서버 테스트 22개)와 `npx vite build`. 테스트 프레임워크는 없다.
- **새 검사는 대상을 일부러 깨뜨려 빨간불을 본 뒤에만 믿는다.** 이 저장소에는 실패할 수 없게 짜인 검사가 다섯 번 있었다.
- 눈높이는 전 체형 공용 상수 `CAMERA.eyeHeight`(1.56)다. 체형별로 다르게 만들지 않는다 — 아바타가 시야 이득을 갖는 순간 `bodies.ts`의 불변식이 깨진다.
- `AIM_ARM_PITCH = -1.75` (rad). 어깨 피치와 총 역회전이 **같은 상수**를 쓴다. 값을 두 번 적지 않는다.
- 카메라 fov는 70(세로), near 0.1, far 200 — `App.tsx:320`.
- master에 직접 커밋한다.

---

### Task 1: 카메라 모드 선택을 순수 함수로 뽑고 검사로 못박기

**Files:**
- Create: `game/src/game/cameraMode.ts`
- Create: `scripts/check-camera.ts`
- Modify: `package.json` (`check:camera` 추가, `check` 체인에 삽입)

**Interfaces:**
- Produces: `type CameraMode = "paint" | "freeFly" | "firstPerson" | "follow"`, `cameraModeFor(input: CameraModeInput): CameraMode`, `interface CameraModeInput { paintMode: boolean; charLocked: boolean; isSeeker: boolean; phase: Phase }`

- [ ] **Step 1: `cameraMode.ts` 작성**

```ts
import type { Phase } from "./constants";

/**
 * Which camera is driving, decided once per frame.
 *
 * Pulled out of LocalPlayer as a pure function because the interesting part is
 * the ORDER, and the order is the one thing a renderer-less check can pin. The
 * modes are mutually exclusive by construction elsewhere — painting is refused
 * during the hunt (App's canPaint = canPose || inCell, and canPose excludes the
 * seeker) and the R toggle refuses the seeker — so this ranking is the safety
 * net for a future change to either of those, not the argument that they hold.
 */
export type CameraMode = "paint" | "freeFly" | "firstPerson" | "follow";

export interface CameraModeInput {
  paintMode: boolean;
  /** R-pinned body; the camera flies free while this is on. */
  charLocked: boolean;
  isSeeker: boolean;
  phase: Phase;
}

export function cameraModeFor({ paintMode, charLocked, isSeeker, phase }: CameraModeInput): CameraMode {
  // Painting wins outright: you cannot paint a body you cannot see, so neither
  // a pinned camera nor first person may take the view away from it.
  if (paintMode) return "paint";
  if (charLocked && !isSeeker) return "freeFly";
  if (isSeeker && phase === "seeking") return "firstPerson";
  return "follow";
}
```

- [ ] **Step 2: `scripts/check-camera.ts` 작성 (모드 절만; 자유비행 클램프는 Task 6에서 추가)**

```ts
/**
 * Camera mode priority. Everything here is a decision table, so it needs no
 * renderer — which is the reason cameraModeFor exists as a pure function.
 */
import { cameraModeFor, type CameraModeInput } from "../game/src/game/cameraMode";

let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const base: CameraModeInput = { paintMode: false, charLocked: false, isSeeker: false, phase: "hiding" };

console.log("camera mode priority\n");

check(cameraModeFor(base) === "follow", "a hider in the hiding phase follows");
check(
  cameraModeFor({ ...base, isSeeker: true, phase: "seeking" }) === "firstPerson",
  "the seeker hunting is first person"
);
check(
  cameraModeFor({ ...base, isSeeker: true, phase: "hiding" }) === "follow",
  "the seeker waiting out the hiding phase is not"
);
check(
  cameraModeFor({ ...base, charLocked: true }) === "freeFly",
  "a pinned hider flies free"
);

// The exclusions the spec relies on. Each of these is currently unreachable
// through the UI; they are here so that a change making one reachable is a
// visible failure rather than a camera that quietly does the wrong thing.
check(
  cameraModeFor({ ...base, isSeeker: true, phase: "seeking", charLocked: true }) === "firstPerson",
  "a seeker cannot fly, whatever charLocked says"
);
check(
  cameraModeFor({ ...base, paintMode: true, isSeeker: true, phase: "seeking" }) === "paint",
  "painting beats first person"
);
check(
  cameraModeFor({ ...base, paintMode: true, charLocked: true }) === "paint",
  "painting beats free flight"
);

console.log(failures ? `\n${failures} failure(s)` : "\nall good");
process.exit(failures ? 1 : 0);
```

- [ ] **Step 3: 검사가 실제로 실패할 수 있는지 확인**

`cameraMode.ts`에서 `if (paintMode) return "paint";` 줄을 맨 아래로 옮기고 실행:

```bash
npx tsx scripts/check-camera.ts
```

Expected: `painting beats first person`과 `painting beats free flight`가 FAIL. 확인했으면 원래대로 되돌리고 다시 실행해 전부 ok인지 본다.

- [ ] **Step 4: `package.json` 배선**

`"check:paint"` 줄 다음에 `"check:camera": "tsx scripts/check-camera.ts",`를 넣고, `check` 체인의 `npm run check:paint` 뒤에 `&& npm run check:camera`를 넣는다.

- [ ] **Step 5: 검증**

```bash
npm run check
```

Expected: 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add game/src/game/cameraMode.ts scripts/check-camera.ts package.json
git commit -m "refactor: make the camera's choice of mode a decision table"
```

---

### Task 2: 조준 자세 상수와 손 위치 파생

**Files:**
- Create: `game/src/game/aim.ts`
- Modify: `scripts/check-bodies.ts`

**Interfaces:**
- Consumes: `BodyProfile`, `derive` (`game/src/game/bodies.ts`)
- Produces: `AIM_ARM_PITCH: number`, `aimHandOffset(profile: BodyProfile): { x: number; y: number; z: number }`

- [ ] **Step 1: `aim.ts` 작성**

```ts
import { derive, type BodyProfile } from "./bodies";

/**
 * How far the shoulder swings the gun arm forward while the seeker is holding
 * the blaster, in radians. Negative pitches the arm forward and up, matching
 * POSES (banzai is -2.85); slightly past horizontal because the shortest arm in
 * the catalogue (bean, 0.47) needs the lift to keep the gun inside the view.
 *
 * The gun hangs off this joint, so rotating the shoulder rotates the gun's own
 * axes with it. Humanoid negates exactly this value on the hand group — one
 * constant used twice, so the two cannot drift apart. Without that negation the
 * barrel points at the sky.
 */
export const AIM_ARM_PITCH = -1.75;

/**
 * Where the gun ends up, in the body's own coordinates: x to the body's right,
 * y above the feet, z forward.
 *
 * This is the same arithmetic three.js does to the arm — the hand hangs one arm
 * length below the shoulder pivot, and the pivot's X rotation carries it round
 * — written out so the tracer and check:bodies can ask where the gun is without
 * a scene graph to measure.
 */
export function aimHandOffset(profile: BodyProfile): { x: number; y: number; z: number } {
  const armLength = derive(profile).armHalf * 2;
  return {
    x: profile.shoulderX,
    y: profile.shoulderY - armLength * Math.cos(AIM_ARM_PITCH),
    z: -armLength * Math.sin(AIM_ARM_PITCH),
  };
}
```

- [ ] **Step 2: `check-bodies.ts`에 실패하는 검사 추가**

파일 맨 위 import에 다음을 더한다:

```ts
import { CAMERA } from "../game/src/game/constants";
import { aimHandOffset } from "../game/src/game/aim";
```

그리고 기존 검사들 뒤에 붙인다:

```ts
/**
 * The gun has to be on screen. The camera is fov 70 vertically (App.tsx), so
 * the view reaches 35 degrees above and below its axis; at 4:3 that is 43
 * degrees left and right (atan(tan 35 * 4/3)). Narrower windows than 4:3 are
 * not covered — bean's gun leaves the frame first, and this check says where.
 */
const HALF_FOV_DOWN = 35;
const HALF_FOV_SIDE = 43;

for (const profile of BODIES) {
  const hand = aimHandOffset(profile);
  const down = (Math.atan2(CAMERA.eyeHeight - hand.y, hand.z) * 180) / Math.PI;
  const side = (Math.atan2(hand.x, hand.z) * 180) / Math.PI;

  check(
    down < HALF_FOV_DOWN,
    `${profile.id}: the gun is below the view axis but inside it`,
    `${down.toFixed(1)} deg (< ${HALF_FOV_DOWN})`
  );
  check(
    side < HALF_FOV_SIDE,
    `${profile.id}: and inside it sideways at 4:3`,
    `${side.toFixed(1)} deg (< ${HALF_FOV_SIDE})`
  );

  // In first person the camera sits at eye height inside the (hidden) head. If
  // a profile's torso reaches up past that, its top cap crosses the 0.1 near
  // plane and looking down slices your own chest open. tank has 0.04 of room;
  // this prints the number rather than hiding the fact.
  const torsoTop = profile.torso.y + profile.torso.l / 2 + profile.torso.r;
  check(
    torsoTop < CAMERA.eyeHeight,
    `${profile.id}: the eye clears the torso`,
    `${(CAMERA.eyeHeight - torsoTop).toFixed(2)}u of room`
  );
}
```

`check` 함수와 `BODIES` import가 이미 있는지 확인하고, 이름이 다르면 그 파일의 것을 따른다.

- [ ] **Step 3: 검사가 실패할 수 있는지 확인**

`aim.ts`의 `AIM_ARM_PITCH`를 잠깐 `-1.2`로 바꾸고:

```bash
npm run check:bodies
```

Expected: bean이 `the gun is below the view axis but inside it`에서 FAIL(약 47도). `-1.75`로 되돌리고 다시 실행해 전부 ok.

- [ ] **Step 4: 커밋**

```bash
git add game/src/game/aim.ts scripts/check-bodies.ts
git commit -m "feat: derive where the aiming hand holds the gun"
```

---

### Task 3: Humanoid — 조준 자세, 총 역회전, 머리 숨김

**Files:**
- Modify: `game/src/game/Humanoid.tsx`

**Interfaces:**
- Consumes: `AIM_ARM_PITCH` (`game/src/game/aim.ts`)
- Produces: `Humanoid`의 새 prop `hideHead?: boolean`

- [ ] **Step 1: import와 prop 추가**

`import { AIM_ARM_PITCH } from "./aim";`를 추가하고, `Props`에 넣는다:

```ts
  /**
   * Drop the head mesh. First person parks the camera inside it, and rendering
   * the inside of your own skull is worse than having no head in your own view
   * — everyone else still sees theirs. The shadow loses its head with it.
   */
  hideHead?: boolean;
```

구조 분해에도 `hideHead`를 더한다.

- [ ] **Step 2: 오른팔을 조준 각도로 고정**

`useFrame` 안, `armPitchR`을 계산하는 줄을 다음으로 바꾼다:

```ts
    // The gun arm holds one angle: no walk swing, no jump override. Humanoid's
    // hand group negates exactly this angle to keep the barrel level, and that
    // negation is only exact while the arm is actually at it.
    const armPitchR = held
      ? AIM_ARM_PITCH
      : THREE.MathUtils.lerp(spec.armPitch - swing, airArm, air);
```

- [ ] **Step 3: 손 그룹에서 역회전, 머리 숨김**

오른쪽 어깨 그룹의 `held` 줄을 바꾼다:

```tsx
        {held && <group position={[0, -armHalf * 2, 0]} rotation={[-AIM_ARM_PITCH, 0, 0]}>{held}</group>}
```

머리 메시는 조건부로 만든다:

```tsx
      {!hideHead && (
        <mesh ref={head} geometry={geoms.head} material={material} position={[0, headY, 0]} castShadow />
      )}
```

`head.current`를 읽는 `useFrame` 블록은 이미 `if (head.current)` 가드가 있으므로 그대로 둔다.

- [ ] **Step 4: 타입체크**

```bash
npx tsc --noEmit
```

Expected: 클린.

- [ ] **Step 5: 커밋**

```bash
git add game/src/game/Humanoid.tsx
git commit -m "feat: hold the blaster level in a fixed aiming pose"
```

---

### Task 4: LocalPlayer — 1인칭 카메라와 손에서 나가는 트레이서

**Files:**
- Modify: `game/src/game/LocalPlayer.tsx`

**Interfaces:**
- Consumes: `cameraModeFor` (Task 1), `aimHandOffset` (Task 2), `hideHead` (Task 3)

- [ ] **Step 1: 모드 계산**

`useFrame` 안, `updateFollowCamera` 호출 직전에 넣는다:

```ts
    const mode = cameraModeFor({
      paintMode,
      charLocked,
      isSeeker: me.role === "seeker",
      phase,
    });
    const firstPerson = mode === "firstPerson";
```

`import { cameraModeFor } from "./cameraMode";`를 추가한다.

- [ ] **Step 2: `updateFollowCamera` 인자를 모드별로**

기존 호출을 다음으로 바꾼다:

```ts
    bodyFade.current = updateFollowCamera(camera, follow.current, {
      pos: motion.current.pos,
      yaw: paintMode ? orbitYaw.current : yaw.current,
      pitch: paintMode ? orbitPitch.current : pitch.current,
      desired: paintMode
        ? THREE.MathUtils.lerp(CAMERA.paintFar, CAMERA.paintNear, zoom / 100)
        : firstPerson
          ? 0
          : CAMERA.playDistance,
      minDistance: paintMode ? CAMERA.paintMinDistance : firstPerson ? 0 : CAMERA.minDistance,
      boxes: inCell ? CELL_BOXES : MAP_BOXES,
      dt: step,
      // First person pivots at the eyes at both ends, so the rig's shoulder-to-
      // eye lerp has nowhere to travel and the view cannot dip to the chest.
      shoulderHeight: paintMode ? 0.95 : firstPerson ? CAMERA.eyeHeight : CAMERA.shoulderHeight,
      eyeHeight: paintMode ? 0.95 : CAMERA.eyeHeight,
      fadeEnd: CAMERA.fadeEnd,
      fadeStart: CAMERA.fadeStart,
      // Fading is what the third-person rig does when a wall forces it into the
      // body. At a deliberate distance of zero it would simply delete the body,
      // and the gun in the hand with it.
      allowFade: !paintMode && !firstPerson,
      floorY: inCell ? CELL_FLOOR_Y : 0,
    });
```

- [ ] **Step 3: 머리와 아웃라인**

`<Humanoid ... />`의 `showOutline`을 바꾸고 `hideHead`를 더한다. `firstPerson`은 `useFrame` 안의 지역 변수이므로, 렌더에서 쓸 수 있도록 같은 식을 렌더 본문에서 한 번 더 계산한다(둘 다 같은 순수 함수를 부르므로 값이 갈릴 수 없다):

컴포넌트 본문 상단(훅들 아래, `return` 위)에 넣는다:

```ts
  // The same call the frame loop makes. cameraModeFor is pure and both callers
  // pass the same four values, so the render and the frame cannot disagree.
  const renderMode = cameraModeFor({
    paintMode,
    charLocked,
    isSeeker: me.role === "seeker",
    phase,
  });
```

그리고:

```tsx
            showOutline={!paintMode && renderMode !== "firstPerson"}
            hideHead={renderMode === "firstPerson"}
```

- [ ] **Step 4: 트레이서를 손에서 시작**

`import { aimHandOffset } from "./aim";`과 `import { profileFor } from "./bodies";`를 추가하고, `onFire` 안의 `setTracer` 줄을 바꾼다:

```ts
      const [px, py, pz] = motion.current.pos;
      // From the gun, not the chest: in first person the chest is below the
      // view and the tracer would appear to come out of the floor. The hand
      // offset is in body coordinates, so it turns with the body's yaw.
      const hand = aimHandOffset(profileFor(body));
      const sin = Math.sin(bodyYaw.current);
      const cos = Math.cos(bodyYaw.current);
      setTracer({
        from: [
          px + hand.x * cos + hand.z * sin,
          py + hand.y,
          pz - hand.x * sin + hand.z * cos,
        ],
        to: result.point,
      });
```

- [ ] **Step 5: 검증**

```bash
npm run check && npx vite build
```

Expected: 검사 전부 통과, 빌드 성공.

- [ ] **Step 6: 커밋**

```bash
git add game/src/game/LocalPlayer.tsx
git commit -m "feat: put the seeker behind their own eyes for the hunt"
```

---

### Task 5: 자유비행 카메라의 상자와 클램프

**Files:**
- Modify: `game/src/game/cameraMode.ts`
- Modify: `scripts/check-camera.ts`

**Interfaces:**
- Consumes: `ARENA` (`game/src/game/arena.ts`), `CAMERA_FLOOR` (`game/src/game/camera.ts`)
- Produces: `FREE_FLY: { speed: number; ceiling: number; floor: number; half: number }`, `clampFreeCamera(x: number, y: number, z: number): [number, number, number]`

- [ ] **Step 1: `cameraMode.ts`에 추가**

```ts
import { ARENA } from "./arena";
import { CAMERA_FLOOR } from "./camera";

/**
 * The box a free-flying camera may move in.
 *
 * The camera does not collide with anything while flying — being stopped by
 * crates is the opposite of the point — so this box is the only thing keeping
 * it out of the void under the map and off past the walls.
 *
 * The ceiling is not a taste value: at ARENA.size / 2 the 16:9 view spans
 * 2 * 44 * tan(35 deg) * 16/9 = 110u horizontally, which already contains the
 * whole 88u arena. Higher would show nothing new, only smaller.
 */
export const FREE_FLY = {
  speed: 18,
  half: ARENA.size / 2,
  floor: CAMERA_FLOOR,
  ceiling: ARENA.size / 2,
};

export function clampFreeCamera(x: number, y: number, z: number): [number, number, number] {
  const limit = FREE_FLY.half;
  return [
    Math.min(limit, Math.max(-limit, x)),
    Math.min(FREE_FLY.ceiling, Math.max(FREE_FLY.floor, y)),
    Math.min(limit, Math.max(-limit, z)),
  ];
}
```

- [ ] **Step 2: `check-camera.ts`에 검사 추가**

import에 `FREE_FLY, clampFreeCamera`를 더하고, `ARENA`도 가져와서 붙인다:

```ts
console.log("\nfree flight box\n");

const far = clampFreeCamera(500, 500, -500);
check(
  far[0] === FREE_FLY.half && far[2] === -FREE_FLY.half && far[1] === FREE_FLY.ceiling,
  "flying at the sky and the corner stops at the box",
  far.map((n) => n.toFixed(1)).join(", ")
);

const under = clampFreeCamera(0, -20, 0);
check(under[1] === FREE_FLY.floor, "and never gets under the floor", `${under[1]}`);

const inside = clampFreeCamera(3, 6, -9);
check(
  inside[0] === 3 && inside[1] === 6 && inside[2] === -9,
  "a position already inside the box is untouched"
);

// The ceiling's whole justification: from up there you can see the whole map.
const HALF_FOV = (35 * Math.PI) / 180;
const spanAt16by9 = 2 * FREE_FLY.ceiling * Math.tan(HALF_FOV) * (16 / 9);
check(
  spanAt16by9 >= ARENA.size,
  "the ceiling is high enough to hold the whole arena in view",
  `${spanAt16by9.toFixed(0)}u across vs ${ARENA.size}u of arena`
);
```

- [ ] **Step 3: 검사가 실패할 수 있는지 확인**

`FREE_FLY.ceiling`을 잠깐 `12`로 바꾸고:

```bash
npx tsx scripts/check-camera.ts
```

Expected: `the ceiling is high enough...`가 FAIL(약 30u < 88u). 되돌리고 다시 실행해 전부 ok.

- [ ] **Step 4: 커밋**

```bash
git add game/src/game/cameraMode.ts scripts/check-camera.ts
git commit -m "feat: bound the free-flying camera to a box the arena derives"
```

---

### Task 6: LocalPlayer — R 고정 중 카메라를 몸에서 떼기

**Files:**
- Modify: `game/src/game/LocalPlayer.tsx`

**Interfaces:**
- Consumes: `FREE_FLY`, `clampFreeCamera` (Task 5), `cameraModeFor` (Task 1)

- [ ] **Step 1: 자유비행 상태**

다른 ref들 옆에 추가한다:

```ts
  /** Where the camera is while it flies on its own; null when it is not. */
  const freeFly = useRef<[number, number, number] | null>(null);
```

- [ ] **Step 2: `useFrame`에서 자유비행 분기**

`updateFollowCamera` 호출 전체를 `if (mode === "freeFly") { ... } else { ...기존 호출... }`로 감싼다. 자유비행 가지는 이렇게 쓴다:

```ts
    if (mode === "freeFly") {
      // Seed from wherever the follow camera left off, so pinning the body does
      // not teleport the view; from then on the camera owns its own position.
      if (!freeFly.current) {
        freeFly.current = [camera.position.x, camera.position.y, camera.position.z];
      }

      // WASD flies the camera along its own view direction. The body is pinned,
      // so these keys are doing nothing else — no new binding is needed.
      const fly = read();
      const forward = new THREE.Vector3(
        Math.sin(yaw.current) * Math.cos(pitch.current),
        -Math.sin(pitch.current),
        Math.cos(yaw.current) * Math.cos(pitch.current)
      );
      const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
      const move = forward
        .multiplyScalar(fly.forward * FREE_FLY.speed * step)
        .addScaledVector(right, fly.strafe * FREE_FLY.speed * step);

      const [fx, fy, fz] = clampFreeCamera(
        freeFly.current[0] + move.x,
        freeFly.current[1] + move.y,
        freeFly.current[2] + move.z
      );
      freeFly.current = [fx, fy, fz];

      camera.position.set(fx, fy, fz);
      camera.lookAt(fx + forward.x, fy + forward.y, fz + forward.z);
      // Solid: the whole point is looking at the world, including your own body
      // from across the map.
      bodyFade.current = 1;
    } else {
      if (freeFly.current) {
        // Cut back rather than interpolate: easing home from the far side of
        // the map sweeps the screen for seconds.
        freeFly.current = null;
        follow.current.distance = CAMERA.playDistance;
      }
      bodyFade.current = updateFollowCamera(/* ...as in Task 4... */);
    }
```

`read()`가 반환하는 필드 이름은 `game/src/game/input.ts`의 `useKeyboard`를 열어 확인하고 그대로 쓴다(위 코드는 `forward`/`strafe`를 가정한다). `forward` 벡터의 y 부호는 `followCamera.ts`의 `back` 벡터가 `Math.sin(pitch)`를 쓰는 것과 반대여야 한다 — `back`은 뒤를 향하고 이건 앞을 향한다.

- [ ] **Step 3: 고정 중에도 시점이 돌아가는지 확인**

`usePointerLook`은 `!paintMode && !frozen`으로 켜지고 `frozen`에 `charLocked`가 없으므로(App.tsx의 `frozen` 식) 이미 돌아간다. 코드를 바꿀 필요는 없고, 이 단계는 **읽어서 확인만** 한다. `frozen`에 `charLocked`가 들어 있으면 자유비행 중 시점이 얼어붙으므로 그때는 여기서 멈추고 보고한다.

- [ ] **Step 4: 검증**

```bash
npm run check && npx vite build
```

Expected: 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add game/src/game/LocalPlayer.tsx
git commit -m "feat: let a pinned hider fly the camera over the map"
```

---

### Task 7: 문서 갱신

**Files:**
- Modify: `README.md` (알려진 한계 13번)
- Modify: `HANDOFF.md` (맨 위에 9차 세션 절 추가)
- Modify: `game/src/game/useShoot.ts` (시야각 거울 주석)

- [ ] **Step 1: `useShoot.ts`의 시야각 주석 정정**

"the follow rig parks CAMERA.playDistance behind the player and aims back through them"로 시작하는 문단은 술래에게 더 이상 사실이 아니다. 1인칭에서는 카메라가 피벗 뒤가 아니라 눈높이에 있으므로 "피벗보다 가까운 히트 = 등 뒤"라는 상황이 생기지 않는다. 문단을 고쳐, 이 `continue`가 이제 **서버 규칙의 거울로서만** 남아 있고 3인칭 경로(자유비행·페인트·하이더)에서는 여전히 실제로 걸린다는 것을 적는다. 코드는 지우지 않는다.

- [ ] **Step 2: README 알려진 한계 13번**

레이 출발점이 카메라에서 눈으로 내려왔으므로 "술래 몸통은 가리지만 높이 뜬 카메라는 못 가리는 상자 뒤 하이더가 그대로 맞는다"는 서술을 지우고, 대신 남은 것을 적는다: 서버는 여전히 거리도 시야도 검사하지 않으며, 위조된 포획을 막는 경계는 네 가지(방의 술래·추적 페이즈·미포획 하이더·700ms)뿐이다.

- [ ] **Step 3: HANDOFF 9차 세션 절**

맨 위에 추가한다. 반드시 포함할 것:

- 이번 세션이 실제로 화면에서 확인한 것과 확인하지 못한 것을 **분리해서** 적는다. 확인하지 않았으면 확인했다고 쓰지 않는다.
- 브러쉬 두 결함(비원형 dab, 부위 넘는 줄)의 원인과 수정, 그리고 `check:paint`의 한계선이 구면 기하에서 유도됐다는 것.
- 남은 것: 붓 크기가 부위마다 물리적으로 다르다(반지름 48텍셀이 classic 머리 0.62u, 팔 0.18u), 이음매에 생기는 틈, tank 체형 1인칭 몸통 절단, bean 체형 총이 세로 종횡비에서 화면 밖.
- 기존 후속 둘(`input.ts:188-191` 포인터 락 재획득, `RemotePlayers`의 `held`)은 여전히 남아 있다.

- [ ] **Step 4: 커밋**

```bash
git add README.md HANDOFF.md game/src/game/useShoot.ts
git commit -m "docs: record what first person changed about cover"
```

---

## 실행 후 반드시 남는 일

**화면 확인.** 이 계획의 어떤 검사도 카메라가 실제로 어디를 보는지, 총이 화면 어디에 있는지 증명하지 못한다. 브라우저 패널이 표시되지 않으면 페이지가 백그라운드 탭이 되어 `requestAnimationFrame`이 초당 0회가 되고 R3F는 마운트조차 하지 않는다(6차 세션). 패널을 띄운 뒤 설계 문서의 "화면으로 확인할 것" 여섯 항목을 순서대로 본다.

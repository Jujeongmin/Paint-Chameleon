# 이동 서버 검증 (Movement Validation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `updateTransform`이 보고받은 위치를 그대로 신뢰하지 않고, 직전 위치·경과시간
기준으로 물리적으로 불가능한 XZ 이동을 서버에서 clamp하게 만든다.

**Architecture:** `server/src/server.ts`의 `updateTransform` 안에서 `$room.getMyState()`로
직전 `pos`/`lastMoveAt`을 읽고, `elapsed × 속도상한 × 여유배수`로 허용 반경을 계산해
XZ만 clamp한다. 서버가 `pos`를 직접 다시 쓰는 지점(`joinGame`, `startRound`의 스폰)마다
`lastMoveAt`도 같이 `now`로 리셋해서, 스폰 이후 첫 리포트가 "오래된 시각 대비 이동"으로
계산돼 허용 반경이 부풀려지는 허점을 막는다.

**Tech Stack:** TypeScript, `@agent8/gameserver-node` (server, isolated-vm), 기존 서버
테스트 하네스(`npx -y @agent8/gameserver-node test`, `describe`/`test`/`expect`/`server.*`
전역 API — 블랙박스, 서버 클래스의 public 메서드만 호출 가능. 내부 헬퍼 함수를 import해서
단위테스트할 수 없다).

## Global Constraints

- 클라이언트 코드(`src/game/*`, `src/net/*` 등)는 이번 계획에서 **전혀 수정하지 않는다.**
- Y축(수직) 이동은 이번 범위에 없다 — XZ 평면 거리만 검증한다.
- 서버 측 물리 재시뮬레이션(`stepMotion`/충돌을 서버에 복제)은 하지 않는다 — 가벼운
  거리-상한 clamp에 그친다.
- 역할별(hider/seeker) 속도 차등은 두지 않는다 — 테스트 하네스로는 `startRound`를 거치지
  않고 "seeker" 역할을 만들 방법이 없어 검증 불가능하기 때문에, 더 빠른 쪽(seeker,
  6.8u/s)을 공통 상한으로 쓴다.
- `npm run check`(타입체크 + `check:sync` + `check:movement` + `check:hub` +
  `server:test`)가 계획의 매 태스크 종료 시점에 계속 통과해야 한다.
- 서버 상수는 `server/src/rules.ts`에 두고 `src/game/constants.ts`와의 동기화를
  `scripts/check-sync.ts`가 검사하게 한다 — 기존 맵/포즈 동기화 가드와 동일한 패턴.
- 관련 설계 문서: [`docs/superpowers/specs/2026-07-24-movement-validation-design.md`](../specs/2026-07-24-movement-validation-design.md)

---

### Task 1: 서버 쪽 이동속도 상수 + 클라/서버 동기화 가드

**Files:**
- Modify: `server/src/rules.ts` (파일 끝 근처, `PAINT_LIMITS` 아래에 추가)
- Modify: `scripts/check-sync.ts`

**Interfaces:**
- Consumes: `src/game/constants.ts`의 기존 `export const MOVE = { hiderSpeed: 6.0, seekerSpeed: 6.8, ... }` (읽기만, 수정 안 함)
- Produces: `server/src/rules.ts`에서 `export const MOVE_SPEED_CAP: number`, `export const SPEED_GRACE: number`, `export const MIN_DT_MS: number` — Task 2에서 `server/src/server.ts`가 이 세 값을 import해서 쓴다.

- [ ] **Step 1: `server/src/rules.ts`에 상수 추가**

`server/src/rules.ts`의 `PAINT_LIMITS` 선언 바로 아래(41번째 줄 근처, `function rng` 앞)에 추가:

```ts
/**
 * src/game/constants.ts의 MOVE.seekerSpeed(둘 중 더 빠른 쪽)와 동기화 유지 —
 * check:sync가 검사. 역할별로 나누지 않고 더 빠른 쪽을 공통 상한으로 쓴다: 이
 * 테스트 하네스는 블랙박스라 실제 라운드 진행 없이는 "seeker" 역할을 만들 방법이
 * 없어 역할별 값을 검증할 수 없고, 통합 상한을 써도 hider가 자기 실제 속도(6.0)
 * 보다 살짝 더 여유(6.8까지)를 갖는 정도의 미미한 손해만 있다.
 */
export const MOVE_SPEED_CAP = 6.8;
/** 네트워크 지터/전송 버스트에 대한 여유 배수. */
export const SPEED_GRACE = 1.5;
/** elapsed 계산의 하한(ms) — 버스트 전송으로 elapsed≈0이 되어 정상 이동까지 clamp되는 것 방지. */
export const MIN_DT_MS = 50;
```

- [ ] **Step 2: `scripts/check-sync.ts`의 import 목록 확장**

`scripts/check-sync.ts` 12번째 줄:

```ts
import { MAP_BOXES as CLIENT_BOXES, ARENA as CLIENT_ARENA } from "../src/game/map";
import { POSES } from "../src/game/constants";
```

를 다음으로 교체(POSES와 함께 MOVE도 가져오기):

```ts
import { MAP_BOXES as CLIENT_BOXES, ARENA as CLIENT_ARENA } from "../src/game/map";
import { POSES, MOVE } from "../src/game/constants";
```

그리고 19번째 줄 `} from "../server/src/rules";` 바로 위의 import 목록:

```ts
import {
  MAP_BOXES as SERVER_BOXES,
  ARENA as SERVER_ARENA,
  POSE_COUNT as SERVER_POSE_COUNT,
  isOpen,
} from "../server/src/rules";
```

을 다음으로 교체:

```ts
import {
  MAP_BOXES as SERVER_BOXES,
  ARENA as SERVER_ARENA,
  POSE_COUNT as SERVER_POSE_COUNT,
  MOVE_SPEED_CAP,
  isOpen,
} from "../server/src/rules";
```

- [ ] **Step 3: `scripts/check-sync.ts`에 검사 섹션 추가**

`scripts/check-sync.ts`의 `console.log("\npose count");` 블록(70~84번째 줄) 바로 뒤,
`console.log("\nspawn safety");` 앞에 새 섹션을 추가:

```ts
console.log("\nmovement speed cap");

// The server clamps reported movement to this speed regardless of role (see
// the movement-validation design doc) — it must never be slower than the
// fastest real role, or legitimate seekers get clamped mid-chase.
const fastestClientSpeed = Math.max(MOVE.hiderSpeed, MOVE.seekerSpeed);
if (MOVE_SPEED_CAP < fastestClientSpeed) {
  fail(
    `server caps movement at ${MOVE_SPEED_CAP}u/s, but the client's fastest role moves at ` +
      `${fastestClientSpeed}u/s — legitimate players would get clamped`
  );
} else {
  pass(`server cap ${MOVE_SPEED_CAP}u/s covers the client's fastest role (${fastestClientSpeed}u/s)`);
}
```

- [ ] **Step 4: `check:sync` 실행해서 통과 확인**

Run: `npm run check:sync`
Expected: 새 "movement speed cap" 섹션에 `✓ server cap 6.8u/s covers the client's fastest role (6.8u/s)`가 출력되고, 마지막에 `✅ client and server agree`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add server/src/rules.ts scripts/check-sync.ts
git commit -m "Add server-side movement speed cap constants, guarded by check:sync"
```

(주의: 이 프로젝트는 현재 git 저장소가 아니다 — `git status`가 "fatal: not a git repository"를 반환하면 이 스텝은 건너뛰고 다음 태스크로 진행한다. 저장소가 있다면 정상 커밋한다.)

---

### Task 2: `updateTransform`에 XZ 이동거리 clamp 적용

**Files:**
- Modify: `server/src/server.ts`
- Test: `server/test/server.test.ts`

**Interfaces:**
- Consumes: Task 1의 `MOVE_SPEED_CAP`, `SPEED_GRACE`, `MIN_DT_MS` (`server/src/rules.ts`에서 import). 기존 `num(v, fallback)` 헬퍼(`server/src/server.ts` 33번째 줄 근처, 이미 존재).
- Produces: `server/src/server.ts`에 새 top-level 함수 `clampMoveXZ(px: number, pz: number, x: number, z: number, maxDist: number): [number, number]`. `updateTransform`이 저장하는 room-user state에 새 필드 `lastMoveAt: number`가 추가됨 — Task 3에서 `joinGame`/`startRound`가 이 필드를 스폰 시점에 리셋한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/server.test.ts`의 `describe("transform", ...)` 블록(125번째 줄) 안,
기존 두 테스트(`updateTransform clamps pose into range`, `updateTransform rejects
non-finite positions`) 뒤에 추가:

```ts
  test("updateTransform keeps a small, plausible move exactly", async (server) => {
    server.connect({ account: "user-ivan" });
    await server.joinGame("ivan");
    const spawn = (await server.getMyState()).pos;

    const target = [spawn[0] + 0.1, 0, spawn[2] + 0.1];
    await server.updateTransform({ pos: target, rotY: 0, pose: 0, moving: true });
    const state = await server.getMyState();

    expect(Math.abs(state.pos[0] - target[0]) < 1e-9).toBe(true);
    expect(Math.abs(state.pos[2] - target[2]) < 1e-9).toBe(true);
  });

  test("updateTransform clamps a physically impossible jump", async (server) => {
    server.connect({ account: "user-judy" });
    await server.joinGame("judy");
    const spawn = (await server.getMyState()).pos;

    // 500 units in one update is impossible at any plausible speed this soon
    // after spawn — no legitimate client could produce this.
    const target = [spawn[0] + 500, 0, spawn[2]];
    await server.updateTransform({ pos: target, rotY: 0, pose: 0, moving: true });
    const state = await server.getMyState();

    const movedDist = Math.hypot(state.pos[0] - spawn[0], state.pos[2] - spawn[2]);
    expect(movedDist < 5).toBe(true);
    expect(state.pos[0] === target[0]).toBe(false);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm run server:test`
Expected: 새 두 테스트 모두 FAIL — `updateTransform`이 아직 clamp를 안 하므로
"updateTransform clamps a physically impossible jump"가 `movedDist < 5`에서 실패
(실제로는 500 그대로 저장됨). 첫 번째 테스트("keeps a small... move exactly")는 이미
통과할 수도 있음(현재도 clamp가 없어 그대로 저장되므로) — 그래도 두 번째가 실패하면
이 스텝의 목적(회귀 방지용 실패 확인)은 달성된 것.

- [ ] **Step 3: `server/src/server.ts` import 목록에 신규 상수 추가**

`server/src/server.ts` 12번째 줄:

```ts
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  HUB_CAPACITY,
  POSE_COUNT,
  PHASE_SECONDS,
  TAG,
  SCORE,
  PAINT_LIMITS,
  randomSpawn,
} from "./rules";
```

를 다음으로 교체:

```ts
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  HUB_CAPACITY,
  POSE_COUNT,
  PHASE_SECONDS,
  TAG,
  SCORE,
  PAINT_LIMITS,
  MOVE_SPEED_CAP,
  SPEED_GRACE,
  MIN_DT_MS,
  randomSpawn,
} from "./rules";
```

- [ ] **Step 4: `clampMoveXZ` 헬퍼 추가**

`server/src/server.ts`의 `clamp01` 함수(37~40번째 줄) 바로 뒤에 추가:

```ts
/** Clamp (x,z) to within maxDist of (px,pz) — the movement speed cap. */
function clampMoveXZ(px: number, pz: number, x: number, z: number, maxDist: number): [number, number] {
  const dx = x - px;
  const dz = z - pz;
  const dist = Math.hypot(dx, dz);
  if (dist <= maxDist || dist === 0) return [x, z];
  const scale = maxDist / dist;
  return [px + dx * scale, pz + dz * scale];
}
```

- [ ] **Step 5: `updateTransform`에 clamp 적용**

`server/src/server.ts`의 기존 `updateTransform`(247~259번째 줄 근처):

```ts
  /**
   * Hot path — called at ~10Hz per client with { throttle }.
   * Kept to a single state write; no reads, no validation round-trips.
   */
  async updateTransform(t: { pos: number[]; rotY: number; pose: number; moving: boolean }): Promise<void> {
    const pos = Array.isArray(t?.pos) ? t.pos : [0, 0, 0];
    await $room.updateMyState({
      pos: [num(pos[0]), num(pos[1]), num(pos[2])],
      rotY: num(t?.rotY),
      pose: Math.max(0, Math.min(POSE_COUNT - 1, Math.floor(num(t?.pose)))),
      moving: !!t?.moving,
    });
  }
```

를 다음으로 교체:

```ts
  /**
   * Hot path — called at ~10Hz per client with { throttle }.
   *
   * Reads the previous state before writing, unlike most of this file's
   * setters: a reported position further than physically possible since the
   * last update gets clamped to the reachable radius instead of trusted
   * outright. The client fully owns its own position otherwise (see
   * README's "known limitations"), and `requestTag`'s distance check reads
   * this same `pos` field, so an unvalidated write is exploitable for both
   * movement and tagging.
   */
  async updateTransform(t: { pos: number[]; rotY: number; pose: number; moving: boolean }): Promise<void> {
    const pos = Array.isArray(t?.pos) ? t.pos : [0, 0, 0];
    const now = Date.now();

    const prev = await $room.getMyState();
    const prevPos = Array.isArray(prev.pos) ? prev.pos : [0, 0, 0];
    const elapsed = Math.max(now - num(prev.lastMoveAt, now), MIN_DT_MS);
    const maxDist = MOVE_SPEED_CAP * SPEED_GRACE * (elapsed / 1000);

    const [x, z] = clampMoveXZ(num(prevPos[0]), num(prevPos[2]), num(pos[0]), num(pos[2]), maxDist);

    await $room.updateMyState({
      pos: [x, num(pos[1]), z],
      rotY: num(t?.rotY),
      pose: Math.max(0, Math.min(POSE_COUNT - 1, Math.floor(num(t?.pose)))),
      moving: !!t?.moving,
      lastMoveAt: now,
    });
  }
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm run server:test`
Expected: `describe("transform", ...)` 아래 모든 테스트 PASS (기존 2개 + 신규 2개, 총
4개). 특히:
```
  ✅ updateTransform keeps a small, plausible move exactly
  ✅ updateTransform clamps a physically impossible jump
```

- [ ] **Step 7: 전체 검증 스위트 확인**

Run: `npm run check`
Expected: 타입체크·check:sync·check:movement·check:hub·server:test 전부 통과, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add server/src/server.ts server/test/server.test.ts
git commit -m "Clamp reported XZ movement to a physically plausible distance"
```

(Task 1과 동일하게, git 저장소가 아니면 이 스텝은 건너뛴다.)

---

### Task 3: 스폰 시점에 `lastMoveAt` 리셋

**Files:**
- Modify: `server/src/server.ts`
- Test: `server/test/server.test.ts`

**Interfaces:**
- Consumes: Task 2에서 도입된 room-user state 필드 `lastMoveAt: number`.
- Produces: 없음(이 태스크가 계획의 마지막 태스크).

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/server.test.ts`의 `describe("transform", ...)` 블록 안, Task 2에서 추가한
두 테스트 뒤에 추가:

```ts
  test("joinGame sets lastMoveAt so movement math has a real baseline", async (server) => {
    server.connect({ account: "user-mallory" });
    const before = Date.now();
    await server.joinGame("mallory");
    const after = Date.now();

    const state = await server.getMyState();
    expect(typeof state.lastMoveAt === "number").toBe(true);
    expect(state.lastMoveAt >= before && state.lastMoveAt <= after).toBe(true);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm run server:test`
Expected: FAIL — `joinGame`이 아직 `lastMoveAt`을 쓰지 않으므로
`typeof state.lastMoveAt === "number"`가 `false`(값이 `undefined`).

- [ ] **Step 3: `joinGame`에 `lastMoveAt` 추가**

`server/src/server.ts`의 `joinGame` 안, `updateRoomUserState` 호출(현재 201~212번째
줄 근처):

```ts
    await $global.updateRoomUserState(roomId, $sender.account, {
      nick: sanitizeNick(nick),
      ready: false,
      role: "hider",
      caught: false,
      caughtAt: null,
      pos: randomSpawn(),
      rotY: 0,
      pose: 0,
      moving: false,
      lastTagAt: 0,
    });
```

를 다음으로 교체(`lastMoveAt: Date.now()` 한 줄 추가):

```ts
    await $global.updateRoomUserState(roomId, $sender.account, {
      nick: sanitizeNick(nick),
      ready: false,
      role: "hider",
      caught: false,
      caughtAt: null,
      pos: randomSpawn(),
      rotY: 0,
      pose: 0,
      moving: false,
      lastTagAt: 0,
      lastMoveAt: Date.now(),
    });
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run server:test`
Expected: `joinGame sets lastMoveAt so movement math has a real baseline` PASS.

- [ ] **Step 5: `startRound`의 스폰에도 동일하게 적용**

이 스텝엔 전용 자동 테스트가 없다 — 기존 테스트 스위트가 `$roomTick`/`startRound`를
직접 틱하지 않는 관례를 따른다(설계 문서의 "테스트" 절 참고). `updateTransform`이
이미 clamp를 하므로 여기서 안 고쳐도 즉시 깨지는 건 아니지만, 고쳐두지 않으면 라운드가
바뀔 때마다 "리스폰 직후 첫 리포트의 허용 반경이 부풀려지는" 허점이 열려 있는 채로
남는다.

`server/src/server.ts`의 `startRound` 함수(현재 59~89번째 줄) 안, 유저 루프:

```ts
  for (const u of users) {
    const isSeeker = u.account === seeker;
    await $global.updateRoomUserState(roomId, u.account, {
      role: isSeeker ? "seeker" : "hider",
      caught: false,
      caughtAt: null,
      pose: 0,
      ready: false,
      pos: isSeeker ? [0, 0, 0] : randomSpawn(),
      rotY: 0,
      lastTagAt: 0,
    });
  }
```

를 다음으로 교체(이미 함수 상단에 있는 `const now = Date.now();`를 재사용):

```ts
  for (const u of users) {
    const isSeeker = u.account === seeker;
    await $global.updateRoomUserState(roomId, u.account, {
      role: isSeeker ? "seeker" : "hider",
      caught: false,
      caughtAt: null,
      pose: 0,
      ready: false,
      pos: isSeeker ? [0, 0, 0] : randomSpawn(),
      rotY: 0,
      lastTagAt: 0,
      lastMoveAt: now,
    });
  }
```

- [ ] **Step 6: 전체 검증 스위트 확인**

Run: `npm run check`
Expected: 타입체크·check:sync·check:movement·check:hub·server:test 전부 통과, exit code 0.
`server:test` 요약에 이번 계획으로 추가된 테스트 3개(Task 2에서 2개 + Task 3에서 1개)를
포함해 총 16개(기존 13개 + 신규 3개) 테스트가 전부 PASS로 나와야 한다.

- [ ] **Step 7: 프로덕션 빌드 확인**

Run: `npx tsc --noEmit && npx vite build`
Expected: 둘 다 성공(이번 계획은 클라이언트 코드를 안 건드리므로 빌드 산출물 크기는
변하지 않아야 한다).

- [ ] **Step 8: Commit**

```bash
git add server/src/server.ts server/test/server.test.ts
git commit -m "Reset lastMoveAt on every server-driven spawn to close the respawn window"
```

(Task 1/2와 동일하게, git 저장소가 아니면 이 스텝은 건너뛴다.)

---

## 완료 후 확인

- [ ] `README.md`의 "알려진 한계" 2번 항목("이동이 서버 검증되지 않습니다")을 갱신하거나
      제거할지 사용자와 상의 — 이 계획 범위 밖(README 정리는 별도 작업으로 취급).

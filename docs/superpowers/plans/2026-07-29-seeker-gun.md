# 술래의 총 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 술래가 하이더에게 2.6u까지 붙어 클릭하던 태그를, 무제한 사거리 히트스캔 사격으로 교체한다.

**Architecture:** 명중 판정은 클라이언트가 한다 — 조준선을 씬 전체에 레이캐스트해 **가장 가까운 실체**를 보고, 그게 하이더의 몸이면 명중, 맵이면 빗나감이다. 벽 판정이 여기서 공짜로 나온다. 서버는 거리를 보지 않고 페이즈·역할·대상·쿨다운·시선만 검사하며, 그 결정표는 `server/src/rules.ts`의 순수 함수로 뽑아 검사 스크립트가 덮는다. 총소리는 방 전체에 브로드캐스트되고 각 클라이언트가 거리로 음량을 정한다.

**Tech Stack:** TypeScript, React Three Fiber, Web Audio(합성), tsx 스크립트 기반 검사(테스트 프레임워크 없음)

**설계 문서:** [`docs/superpowers/specs/2026-07-29-seeker-gun-design.md`](../specs/2026-07-29-seeker-gun-design.md)

## Global Constraints

- 이 저장소는 테스트 프레임워크가 없다. 검증은 `scripts/check-*.ts`를 `tsx`로 돌리는 방식이며, 실패 시 `process.exit(1)`. 새 검사도 이 패턴을 그대로 따른다.
- `npm run check` = `tsc --noEmit` + check:sync + check:bodies + check:shop + check:movement + check:hub + check:map + check:cell + check:audio + check:leaderboard + server:test. **모든 태스크가 끝날 때 전부 통과해야 한다.**
- 서버(`server/src/`)는 격리된 VM에서 돌아 `src/`를 import할 수 없다. 공유가 필요한 값은 복제하고 `check:sync`가 대조한다.
- 소스 주석은 영어, 왜 그런지를 적는다. 커밋 제목도 영어.
- 기존 상수는 바꾸지 않는다: `MOVE.playerRadius` 0.45, `MOVE.jumpSpeed` 7.4, `MOVE.gravity` 22, `STEP_HEIGHT` 0.45, `TOP_Y` 1.86.
- `game/src/game/arena.ts`, `game/src/hub/hubMap.ts`, `game/src/game/cell.ts`는 건드리지 않는다. `check:map`·`check:cell`·`check:hub`는 계속 통과해야 한다.
- 명령은 저장소 루트에서 돌린다. PowerShell 작업 디렉터리가 밀렸으면 `Set-Location`으로 되돌린다.
- **PowerShell은 `git commit -m` 안의 큰따옴표에서 인자를 쪼갠다.** 본문에 따옴표가 들어가면 메시지를 파일에 쓰고 `git commit -F <파일>`.
- 총 모델은 `public/models/blaster/`에 이미 있다 (Kenney Blaster Kit 2.1, GLB 40개 + 자기 `Textures/colormap.png`). **다른 킷 폴더와 섞지 않는다** — GLB가 colormap을 상대경로로 참조하므로 섞으면 팔레트가 뒤집힌다.

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `server/src/rules.ts` (수정) | `SHOT` 상수, `facingDot()`, `canShoot()` — 순수 | 1 |
| `scripts/check-shot.ts` (신규) | `canShoot` 결정표 전수 | 1 |
| `game/src/game/constants.ts` (수정) | `TAG` → `SHOT`, `maxDistance` 삭제 | 2 |
| `server/src/server.ts` (수정) | `requestShot` 배선 + 발사 브로드캐스트 | 2 |
| `game/src/net/useGame.ts`·`offline.ts`·`types.ts` (수정) | `requestTag` → `requestShot` | 2 |
| `server/test/server.test.ts` (수정) | 사격 거절 테스트 이름·호출 갱신 | 2 |
| `game/src/audio/sound.ts` (수정) | `shotGainFor()` 순수 + `playShot()` | 3 |
| `scripts/check-audio.ts` (수정) | 감쇠 곡선 검사 | 3 |
| `game/src/game/RemotePlayers.tsx` (수정) | 몸 그룹에 `userData.account` | 4 |
| `game/src/game/useShoot.ts` (신규) | 조준·레이캐스트·명중 판정 | 4 |
| `game/src/game/LocalPlayer.tsx` (수정) | 클릭-태그 제거, `useShoot` 연결 | 4 |
| `game/src/App.tsx` (수정) | `onTag` → `onShoot` | 4 |
| `game/src/game/Gun.tsx` (신규) | 블래스터 모델 + 트레이서 + 머즐 플래시 | 5 |
| `game/src/game/Humanoid.tsx` (수정) | `held?: ReactNode` 슬롯 | 5 |
| `README.md`·`HANDOFF.md` (수정) | 안티치트 약화 기록 | 6 |

---

### Task 1: canShoot — 서버 결정을 순수 함수로

테스트 하네스가 라운드를 페이즈 전환까지 못 돌리므로(리더보드·코인 적립·셀 순간이동이 같은 벽에 막혀 있다), 결정이 `server.ts`에 인라인으로 있으면 **거절 사유 여섯 개 중 하나도 검증할 수 없다.** 순수 함수로 뽑는 유일한 이유가 이것이다.

**Files:**
- Modify: `server/src/rules.ts`
- Create: `scripts/check-shot.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `export const SHOT = { minFacingDot: 0.55, cooldownMs: 700 }`
  - `export type ShotFailure = "not_seeking" | "not_seeker" | "missing" | "invalid_target" | "cooldown" | "not_facing"`
  - `export function facingDot(from: number[], to: number[], rotY: number): number`
  - `export interface ShotRequest { phase: string; senderIsSeeker: boolean; target: { role?: string; caught?: boolean; pos?: number[] } | null; seekerPos: number[]; seekerRotY: number; now: number; lastShotAt: number }`
  - `export function canShoot(o: ShotRequest): { ok: true } | { ok: false; reason: ShotFailure }`

- [ ] **Step 1: 실패하는 검사부터 — `scripts/check-shot.ts` 작성**

```ts
/**
 * The seeker's shot decision.
 *
 * This is the only coverage the shot will ever have. The gameserver test
 * harness cannot advance a room into the seeking phase — the same wall the
 * leaderboard write, the coin award and the cell teleport all sit behind — so
 * every refusal reason is unreachable from a server test. Pulling the decision
 * out as a pure function is what makes it checkable at all.
 *
 * Run: npm run check:shot
 */

import { SHOT, canShoot, facingDot, type ShotRequest } from "../server/src/rules";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

/** A request that succeeds, so each case below can spoil exactly one thing. */
function valid(): ShotRequest {
  return {
    phase: "seeking",
    senderIsSeeker: true,
    target: { role: "hider", caught: false, pos: [0, 0, 10] },
    seekerPos: [0, 0, 0],
    seekerRotY: 0, // yaw 0 faces +Z, straight at the target
    now: 10_000,
    lastShotAt: 0,
  };
}

console.log("\nfacing maths");
{
  // yaw 0 faces +Z. Getting this backwards is the bug that would let a seeker
  // shoot whatever is behind them, and it is invisible from the call site.
  check("dead ahead is 1", Math.abs(facingDot([0, 0, 0], [0, 0, 5], 0) - 1) < 1e-9);
  check("directly behind is -1", Math.abs(facingDot([0, 0, 0], [0, 0, -5], 0) + 1) < 1e-9);
  check("square to the right is 0", Math.abs(facingDot([0, 0, 0], [5, 0, 0], 0)) < 1e-9);
  check("turning to face it restores 1", Math.abs(facingDot([0, 0, 0], [5, 0, 0], Math.PI / 2) - 1) < 1e-9);
  // Height must not enter it: shooting up or down at someone is still facing them.
  check("y is ignored", Math.abs(facingDot([0, 0, 0], [0, 99, 5], 0) - 1) < 1e-9);
  // A target standing exactly on the shooter has no direction; it must not be NaN.
  check("a zero-length direction is finite", Number.isFinite(facingDot([0, 0, 0], [0, 0, 0], 0)));
}

console.log("\nthe shot is allowed");
{
  check("a valid request passes", canShoot(valid()).ok);

  // Distance is deliberately not a factor any more — see the design doc's first
  // section. A target across the whole 88x88 arena is a legal shot.
  const far = valid();
  far.target = { role: "hider", caught: false, pos: [0, 0, 120] };
  check("distance no longer refuses anything", canShoot(far).ok);
}

console.log("\nevery refusal reason");
{
  const cases: [string, ShotRequest, string][] = [];

  const hiding = valid();
  hiding.phase = "hiding";
  cases.push(["shooting during the hiding phase", hiding, "not_seeking"]);

  const lobby = valid();
  lobby.phase = "lobby";
  cases.push(["shooting in the lobby", lobby, "not_seeking"]);

  const hider = valid();
  hider.senderIsSeeker = false;
  cases.push(["a hider pulling the trigger", hider, "not_seeker"]);

  const gone = valid();
  gone.target = null;
  cases.push(["shooting someone who left", gone, "missing"]);

  const seeker = valid();
  seeker.target = { role: "seeker", caught: false, pos: [0, 0, 10] };
  cases.push(["shooting the seeker", seeker, "invalid_target"]);

  const already = valid();
  already.target = { role: "hider", caught: true, pos: [0, 0, 10] };
  cases.push(["shooting someone already caught", already, "invalid_target"]);

  const fast = valid();
  fast.lastShotAt = fast.now - (SHOT.cooldownMs - 1);
  cases.push(["firing one millisecond early", fast, "cooldown"]);

  const behind = valid();
  behind.target = { role: "hider", caught: false, pos: [0, 0, -10] };
  cases.push(["shooting backwards", behind, "not_facing"]);

  for (const [label, request, reason] of cases) {
    const result = canShoot(request);
    check(
      `${label} is refused with ${reason}`,
      !result.ok && result.reason === reason,
      result.ok ? "it was allowed" : `got ${result.reason}`
    );
  }
}

console.log("\nthe cooldown's exact edge");
{
  // Both sides of the boundary, off the constant rather than a literal, so
  // changing SHOT.cooldownMs cannot quietly pass.
  const ready = valid();
  ready.lastShotAt = ready.now - SHOT.cooldownMs;
  check(`exactly ${SHOT.cooldownMs}ms after the last shot is allowed`, canShoot(ready).ok);

  const early = valid();
  early.lastShotAt = early.now - (SHOT.cooldownMs - 1);
  check("one millisecond earlier is not", !canShoot(early).ok);
}

console.log("\nthe facing cone's exact edge");
{
  // A target placed at exactly the cone's edge, derived from the constant.
  const angle = Math.acos(SHOT.minFacingDot);
  const onEdge = valid();
  onEdge.target = { role: "hider", caught: false, pos: [Math.sin(angle) * 10, 0, Math.cos(angle) * 10] };
  check(`a target on the cone's edge (dot ${SHOT.minFacingDot}) is allowed`, canShoot(onEdge).ok);

  const outside = valid();
  const wider = angle + 0.05;
  outside.target = { role: "hider", caught: false, pos: [Math.sin(wider) * 10, 0, Math.cos(wider) * 10] };
  check("just outside it is not", !canShoot(outside).ok);
}

console.log("\nrubbish input is refused, not trusted");
{
  const nanPos = valid();
  nanPos.target = { role: "hider", caught: false, pos: [NaN, 0, NaN] };
  check("a non-finite target position cannot pass the facing test", !canShoot(nanPos).ok);

  const noPos = valid();
  noPos.target = { role: "hider", caught: false };
  check("a target with no position at all is refused", !canShoot(noPos).ok);
}

if (failures === 0) {
  console.log("\n✅ the shot decision is consistent\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
```

- [ ] **Step 2: `package.json`에 스크립트 추가**

`"check:shop"` 줄 다음에 넣고, `"check"` 체인의 `npm run check:shop` 뒤에 `&& npm run check:shot`을 넣는다.

```json
"check:shot": "tsx scripts/check-shot.ts",
```

- [ ] **Step 3: 실패 확인**

Run: `npm run check:shot`
Expected: FAIL — `canShoot`/`facingDot`/`SHOT`이 없어 import가 깨진다.

- [ ] **Step 4: `server/src/rules.ts`에 구현 추가**

`CELL_SPAWN`/`HUNT_START` 블록 다음, `// ---- avatar shop` 구분선 앞에 넣는다. **기존 `TAG` 상수는 아직 지우지 않는다** — Task 2에서 호출부와 함께 옮긴다.

```ts
// ------------------------------------------------------------ the seeker's shot

/**
 * The seeker's gun.
 *
 * There is no maxDistance any more: the shot is a hitscan with unlimited range
 * and the client decides whether the line of sight was clear, because the
 * server has no map to check it against. That trade, and what it costs, is the
 * first section of the design doc — read it before adding a distance limit
 * back, because any number chosen here would be arbitrary.
 *
 * KEEP IN SYNC WITH SHOT in game/src/game/constants.ts — check:sync compares them.
 */
export const SHOT = {
  /** The seeker's forward vector must have at least this dot with the direction to the target. */
  minFacingDot: 0.55,
  cooldownMs: 700,
};

export type ShotFailure =
  | "not_seeking"
  | "not_seeker"
  | "missing"
  | "invalid_target"
  | "cooldown"
  | "not_facing";

export interface ShotRequest {
  phase: string;
  senderIsSeeker: boolean;
  /** null when the account named is not in the room any more. */
  target: { role?: string; caught?: boolean; pos?: number[] } | null;
  seekerPos: number[];
  seekerRotY: number;
  now: number;
  lastShotAt: number;
}

/** Coerce anything off the wire to a real number. */
function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * How much of the seeker's facing points at the target, on the horizontal plane.
 * 1 is dead ahead, 0 is square to the side, -1 is directly behind.
 *
 * Height is deliberately excluded — shooting up at someone on a crate is still
 * facing them, and folding y in would refuse it.
 *
 * yaw 0 faces +Z (see game/src/game/movement.ts). Inverting that would let the
 * seeker shoot whatever is behind them, which is why check:shot pins all four
 * cardinal directions rather than just the forward case.
 */
export function facingDot(from: number[], to: number[], rotY: number): number {
  const dx = n(to?.[0]) - n(from?.[0]);
  const dz = n(to?.[2]) - n(from?.[2]);
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) return 1; // standing on top of each other counts as facing
  return (dx / length) * Math.sin(n(rotY)) + (dz / length) * Math.cos(n(rotY));
}

/**
 * Pure so it can be checked: the harness cannot drive a room into the seeking
 * phase, so this decision is unreachable from a server test.
 *
 * Order matters. Cheap state checks come before the geometry, and "is this even
 * a legal target" before the cooldown, so a player poking at the remote
 * function learns nothing about who is still uncaught from the timing.
 */
export function canShoot(o: ShotRequest): { ok: true } | { ok: false; reason: ShotFailure } {
  if (o.phase !== "seeking") return { ok: false, reason: "not_seeking" };
  if (!o.senderIsSeeker) return { ok: false, reason: "not_seeker" };
  if (!o.target) return { ok: false, reason: "missing" };
  if (o.target.role !== "hider" || o.target.caught) return { ok: false, reason: "invalid_target" };
  if (n(o.now) - n(o.lastShotAt) < SHOT.cooldownMs) return { ok: false, reason: "cooldown" };

  // A target with no position, or a corrupted one, must not read as "in front
  // of me": n() turns it into the origin, which for a seeker also at the
  // origin would otherwise pass as facing.
  const pos = o.target.pos;
  const usable = Array.isArray(pos) && Number.isFinite(pos[0]) && Number.isFinite(pos[2]);
  if (!usable) return { ok: false, reason: "not_facing" };

  if (facingDot(o.seekerPos, pos, o.seekerRotY) < SHOT.minFacingDot) {
    return { ok: false, reason: "not_facing" };
  }
  return { ok: true };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run check:shot`
Expected: PASS — 전부 통과.

**실패하면**: `facingDot`의 부호가 뒤집혔다면 `game/src/game/movement.ts`의 규약을 다시 본다 — `forward = (sin yaw, cos yaw)`이고, 이 프로젝트는 예전에 이 부호를 한 번 틀린 이력이 있다(`check:movement` 상단 주석).

- [ ] **Step 6: 전체 검사**

Run: `npx tsc --noEmit && npm run check`
Expected: 전부 통과. 아직 호출부가 없으므로 기존 동작은 그대로다.

- [ ] **Step 7: 커밋**

```bash
git add server/src/rules.ts scripts/check-shot.ts package.json
git commit -m "test: state the shot decision as pure logic before wiring it"
```

---

### Task 2: 서버 배선 — 태그를 사격으로 바꾸고 거리 검사를 버린다

**Files:**
- Modify: `game/src/game/constants.ts`, `server/src/server.ts`, `server/test/server.test.ts`, `game/src/net/types.ts`, `game/src/net/useGame.ts`, `game/src/net/offline.ts`, `scripts/check-sync.ts`

**Interfaces:**
- Consumes: `SHOT`, `canShoot`, `facingDot` (`server/src/rules.ts`)
- Produces:
  - 클라이언트 `SHOT = { minFacingDot: 0.55, cooldownMs: 700 }` (`game/src/game/constants.ts`)
  - 게임 뷰의 `requestShot(target: string): Promise<{ ok: boolean }>`
  - 방 브로드캐스트 `"shot"` — `{ account: string; from: [number, number, number]; hit: string | null }`

- [ ] **Step 1: `game/src/game/constants.ts` — `TAG`를 `SHOT`으로**

기존 블록을 지우고 다음을 넣는다. 이름을 바꾸는 이유는 정직함이다 — 이제 태그가 아니다.

```ts
/**
 * The seeker's shot. Server-authoritative for everything except the line of
 * sight, which only the client can judge: the server has no map.
 *
 * There is no maxDistance. See the gun design doc's first section before
 * adding one back — the server cannot check what it cannot see, so any limit
 * here would be a number with no reasoning behind it.
 *
 * KEEP IN SYNC WITH SHOT in server/src/rules.ts — check:sync compares them.
 */
export const SHOT = {
  minFacingDot: 0.55,
  cooldownMs: 700,
};
```

`npx tsc --noEmit`으로 `TAG`를 쓰던 곳을 찾는다 — `game/src/game/LocalPlayer.tsx`가 `TAG.maxDistance`와 `TAG.minFacingDot`으로 자기 쪽 후보를 고르고 있다. **그 블록은 Task 4에서 통째로 사라지므로**, 여기서는 컴파일이 되게만 최소 수정하고(`TAG` → `SHOT`, `maxDistance` 참조는 잠시 상수 `2.6` 리터럴로) Task 4에서 지운다. 그 리터럴 옆에 `// removed in the shooting task` 주석을 남긴다.

- [ ] **Step 2: `scripts/check-sync.ts`에 `SHOT` 대조 추가**

import에 양쪽 `SHOT`을 별칭으로 추가하고, `movement speed cap` 블록 다음에 넣는다.

```ts
console.log("\nshot rules");

// The client refuses a shot locally before asking, so a drift shows up as the
// client blocking shots the server would have allowed, or asking for ones it
// always refuses.
if (
  CLIENT_SHOT.minFacingDot !== SERVER_SHOT.minFacingDot ||
  CLIENT_SHOT.cooldownMs !== SERVER_SHOT.cooldownMs
) {
  fail(
    `shot rules differ: client ${JSON.stringify(CLIENT_SHOT)}, server ${JSON.stringify(SERVER_SHOT)}`
  );
} else {
  pass(`shot rules match (dot ${CLIENT_SHOT.minFacingDot}, cooldown ${CLIENT_SHOT.cooldownMs}ms)`);
}
```

- [ ] **Step 3: `server/src/server.ts` — `requestTag`를 `requestShot`으로**

`requestTag` 메서드 전체를 교체한다. import에 `SHOT`, `canShoot`를 더하고 `TAG`를 뺀다. `rules.ts`의 기존 `TAG` 상수도 이 시점에 삭제한다(`SHOT`이 대체).

```ts
  /**
   * The seeker fires. The client decides whether the shot connected, because
   * only it can see the geometry between the two of them; the server decides
   * whether the shot was legal at all.
   *
   * The decision itself is canShoot() in rules.ts, pure, so check:shot can
   * cover every refusal — the test harness cannot drive a room into the
   * seeking phase to reach any of them from here.
   */
  async requestShot(targetAccount: string): Promise<{ ok: boolean; reason?: ShotFailure }> {
    const state = await $room.getState();
    const users = await $room.getAllUserStates();
    const me = users.find((u) => u.account === $sender.account);
    const target = users.find((u) => u.account === targetAccount) ?? null;
    const now = Date.now();

    const verdict = canShoot({
      phase: String(state.phase ?? "lobby"),
      senderIsSeeker: state.seeker === $sender.account,
      target,
      seekerPos: (me?.pos as number[]) ?? [0, 0, 0],
      seekerRotY: num(me?.rotY),
      now,
      lastShotAt: num(me?.lastShotAt),
    });

    // Everyone hears the gun, hit or miss — see below. So the shot is recorded
    // and broadcast before the hit is applied, and a refused request makes no
    // noise at all.
    if (!verdict.ok) return { ok: false, reason: verdict.reason };

    await $room.updateMyState({ lastShotAt: now });
    await $room.broadcastToRoom("shot", {
      account: $sender.account,
      from: (me?.pos as number[]) ?? [0, 0, 0],
      hit: targetAccount,
    });

    await $global.updateRoomUserState(await $room.getRoomId(), targetAccount, {
      caught: true,
      caughtAt: now,
    });

    return { ok: true };
  }
```

**주의**: 기존 `requestTag`가 `caught`를 어떻게 썼는지 그대로 따른다 — 위 코드의 마지막 write는 기존 구현의 방식으로 맞춰야 한다. `requestTag`의 원래 본문을 읽고 catch 적용·점수 배선을 그대로 옮긴다. 실제 API가 `$room.updateUserState`인지 `$global.updateRoomUserState(roomId, …)`인지 원본을 따르고, roomId를 얻는 방식도 원본과 같게 한다. **추측하지 말고 원본을 복사한다.**

`lastTagAt` 필드는 `lastShotAt`으로 바꾼다. `startRound`가 `lastTagAt: 0`으로 초기화하고 있으므로 거기도 같이 고친다.

- [ ] **Step 4: 클라이언트 원격 함수 이름 변경**

- `game/src/net/useGame.ts` — `requestTag` → `requestShot`, `server.remoteFunction("requestShot", [target])`
- `game/src/net/types.ts` — 게임 뷰 타입에 있으면 같이
- `game/src/net/offline.ts` — `requestTag` → `requestShot`, 주석도 갱신:

```ts
    requestShot: async (_target: string) => {
      // Solo rehearsal: nobody else is ever in the room, so there is never
      // anything to shoot.
      return { ok: false };
    },
```

- `game/src/App.tsx` — `onTag`는 Task 4에서 이름을 바꾸므로 여기서는 `game.requestShot`만 부르게 고친다.

- [ ] **Step 5: 서버 테스트 갱신**

`server/test/server.test.ts`의 `tag is refused outside the seeking phase`를 찾아 `requestShot`을 부르도록 고치고 이름을 `shot is refused outside the seeking phase`로 바꾼다. 단언은 그대로 — 로비에서 거절되는 것이 여전히 요점이다.

- [ ] **Step 6: 전체 검사**

Run: `npx tsc --noEmit && npm run check && npx vite build`
Expected: 전부 통과. 서버 테스트 22개.

- [ ] **Step 7: 커밋**

```bash
git add game/src/game/constants.ts server/src/rules.ts server/src/server.ts server/test/server.test.ts game/src/net scripts/check-sync.ts game/src/App.tsx
git commit -m "feat: replace the close-range tag with a shot the server no longer measures"
```

---

### Task 3: 총소리 — 거리 감쇠를 순수 함수로

**Files:**
- Modify: `game/src/audio/sound.ts`, `scripts/check-audio.ts`

**Interfaces:**
- Produces:
  - `export const SHOT_AUDIO = { audibleDistance: 60, maxGain: 0.3 }`
  - `export function shotGainFor(distance: number): number`
  - `export function playShot(gain: number): void`

- [ ] **Step 1: 실패하는 검사부터 — `scripts/check-audio.ts`에 추가**

import 줄에 `SHOT_AUDIO, shotGainFor, playShot`을 더하고, 파일 끝의 `if (failures === 0)` 직전에 넣는다.

```ts
console.log("\nshot loudness falls off with distance");
{
  // The gun has unlimited range and kills in one shot, so this curve is the
  // only thing a hider has to go on. Too flat and every shot sounds adjacent;
  // too steep and it may as well be silent.
  check("your own shot is loudest", shotGainFor(0) === SHOT_AUDIO.maxGain);
  check("nothing exceeds the ceiling", shotGainFor(0) <= SHOT_AUDIO.maxGain);
  check(
    `beyond ${SHOT_AUDIO.audibleDistance}u it is silent`,
    shotGainFor(SHOT_AUDIO.audibleDistance) === 0 && shotGainFor(999) === 0
  );

  let monotonic = true;
  let previous = Infinity;
  for (let d = 0; d <= SHOT_AUDIO.audibleDistance + 10; d += 0.5) {
    const g = shotGainFor(d);
    if (g > previous + 1e-12 || g < 0) monotonic = false;
    previous = g;
  }
  check("it never rises with distance and never goes negative", monotonic);

  // A mid-range shot has to be audibly there — a curve that collapses to
  // nothing by 10u would make the whole broadcast pointless.
  const mid = shotGainFor(SHOT_AUDIO.audibleDistance / 3);
  check(
    `a shot a third of the way out is still audible (${mid.toFixed(3)})`,
    mid > SHOT_AUDIO.maxGain * 0.1
  );

  // Rubbish in must not become a burst of noise at full volume.
  check("NaN is silent", shotGainFor(NaN) === 0);
  check("a negative distance is silent", shotGainFor(-5) === 0);
}

console.log("\nthe shot can be played without an AudioContext");
{
  // Same contract as every other cue here: muted or headless, it no-ops rather
  // than throwing. A sound that crashes the render loop is worse than silence.
  let threw = false;
  try {
    playShot(shotGainFor(12));
    playShot(0);
  } catch {
    threw = true;
  }
  check("playShot does not throw without a real AudioContext", !threw);
}
```

- [ ] **Step 2: 실패 확인**

Run: `npm run check:audio`
Expected: FAIL — `shotGainFor` 등이 없어 import가 깨진다.

- [ ] **Step 3: `game/src/audio/sound.ts`에 구현 추가**

`playCatch` 앞에 넣는다.

```ts
/**
 * How far a gunshot carries, and how loud it is at the muzzle.
 *
 * 60u is a little under half the arena's 124u diagonal: far enough that a shot
 * tells a hider roughly which quarter of the map the seeker is in, close enough
 * that it does not tell them the seeker fired at all from across the arena.
 */
export const SHOT_AUDIO = { audibleDistance: 60, maxGain: 0.3 };

/**
 * Gain for a shot heard `distance` away. Pure so check:audio can pin the curve
 * — there is no AudioContext under Node.
 *
 * Quadratic rather than linear: linear falloff sounds wrong, because loudness
 * is perceived roughly logarithmically and a straight ramp reads as a shot that
 * stays loud and then stops abruptly.
 */
export function shotGainFor(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (distance >= SHOT_AUDIO.audibleDistance) return 0;
  const t = distance / SHOT_AUDIO.audibleDistance;
  return SHOT_AUDIO.maxGain * (1 - t) * (1 - t);
}

/**
 * A gunshot: a filtered noise crack with a short low thump under it.
 *
 * `gain` comes from shotGainFor, so the same broadcast is loud for the shooter
 * and faint for a hider two zones away.
 */
export function playShot(gain: number): void {
  if (gain <= 0) return;
  noiseBurst(0.08, gain, 2600);
  tone(90, 0.12, gain * 0.6, "square");
}
```

`noiseBurst`와 `tone`은 이미 `ctx`가 없으면 조용히 반환하는 구조인지 확인한다. 아니라면 `playShot` 앞에서 막지 말고, **그 두 헬퍼가 이미 하는 방식을 따른다** — 다른 큐들도 같은 계약이다.

- [ ] **Step 4: 통과 확인**

Run: `npm run check:audio`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add game/src/audio/sound.ts scripts/check-audio.ts
git commit -m "feat: give the gunshot a distance falloff a hider can navigate by"
```

---

### Task 4: 클라이언트 명중 판정

**Files:**
- Modify: `game/src/game/RemotePlayers.tsx`, `game/src/game/LocalPlayer.tsx`, `game/src/App.tsx`
- Create: `game/src/game/useShoot.ts`

**Interfaces:**
- Consumes: `SHOT` (`game/src/game/constants.ts`)
- Produces:
  - `export interface ShotResult { account: string | null; point: [number, number, number] }`
  - `export function useShoot(o: { active: boolean; selfAccount: string; onFire: (result: ShotResult) => void }): void`

- [ ] **Step 1: `game/src/game/RemotePlayers.tsx` — 몸이 자기 정체를 들고 있게 한다**

`RemotePlayer`의 반환 `<group ref={group}>`에 `userData`를 추가한다.

```tsx
    <group ref={group} userData={{ account: player.account }}>
```

주석을 위에 남긴다:

```tsx
  // The shot's raycast hits a mesh several levels down inside Humanoid, so the
  // body has to say whose it is somewhere an ancestor walk can find it.
```

- [ ] **Step 2: `game/src/game/useShoot.ts` 작성**

```ts
import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * The seeker's aim.
 *
 * The client decides whether a shot connected, because the server has no map
 * and so cannot tell whether a wall was in the way. The whole judgement is one
 * raycast: whatever the ray reaches FIRST is what was shot. A hider's body
 * means a hit; a crate, a partition or the floor means the shot stopped there.
 * Cover works because cover is nearer than what is behind it — there is no
 * separate line-of-sight test to get wrong.
 *
 * Modelled on useBrush: one raycaster, listeners on the canvas, and a ref that
 * carries the latest props so the handlers never go stale.
 */

export interface ShotResult {
  /** Whose body was hit, or null for a miss. */
  account: string | null;
  /** Where the ray stopped, for the tracer to end at. */
  point: [number, number, number];
}

interface Options {
  /** Only the seeker, only during the hunt. */
  active: boolean;
  selfAccount: string;
  onFire: (result: ShotResult) => void;
}

/** How far a tracer runs when the ray hits nothing at all. */
const MISS_DISTANCE = 200;

/** Walk up from a hit mesh looking for the account a body group carries. */
function accountOf(object: THREE.Object3D): string | null {
  let node: THREE.Object3D | null = object;
  while (node) {
    const account = node.userData?.account;
    if (typeof account === "string" && account.length > 0) return account;
    node = node.parent;
  }
  return null;
}

export function useShoot({ active, selfAccount, onFire }: Options): void {
  const { camera, scene, gl } = useThree();
  const latest = useRef({ selfAccount, onFire });
  latest.current = { selfAccount, onFire };

  useEffect(() => {
    if (!active) return;
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const centre = new THREE.Vector2();

    const fire = (clientX: number, clientY: number) => {
      // Under pointer lock the cursor is pinned, so the shot goes through the
      // crosshair at the centre. Without it, aim where the cursor actually is.
      if (document.pointerLockElement === canvas) {
        centre.set(0, 0);
      } else {
        const r = canvas.getBoundingClientRect();
        centre.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
      }
      raycaster.setFromCamera(centre, camera);

      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        const mesh = hit.object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) continue;

        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        // The self-locate wireframe is not a surface, and neither is a body
        // faded out by the camera pulling in.
        if ((material as THREE.Material & { wireframe?: boolean })?.wireframe) continue;

        const account = accountOf(mesh);
        // Our own body is between the camera and the world in third person; it
        // must not eat every shot.
        if (account === latest.current.selfAccount) continue;

        latest.current.onFire({
          account,
          point: [hit.point.x, hit.point.y, hit.point.z],
        });
        return;
      }

      // Nothing at all — fire into the distance so the tracer still reads.
      const direction = raycaster.ray.direction.clone().multiplyScalar(MISS_DISTANCE);
      const end = raycaster.ray.origin.clone().add(direction);
      latest.current.onFire({ account: null, point: [end.x, end.y, end.z] });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      fire(e.clientX, e.clientY);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    return () => canvas.removeEventListener("pointerdown", onPointerDown);
  }, [active, camera, scene, gl]);
}
```

**왜 pointerdown이고 드리프트를 안 보는가**: 기존 태그는 "6px 이하로 움직인 클릭"만 태그로 셌다 — 자유 시점에서 시점을 끄는 드래그와 구분하려고. 사격은 그럴 이유가 없다. 쏘면서 조준을 옮기는 건 정상 행동이고, 발사 시점의 조준선만 중요하다.

- [ ] **Step 3: `game/src/game/LocalPlayer.tsx` — 클릭-태그를 버리고 `useShoot`을 붙인다**

`onTag` prop을 `onShoot: (result: ShotResult) => void`로 바꾸고, `me.role === "seeker" && phase === "seeking"`을 감시하던 **pointerdown/pointerup 태그 effect 전체를 삭제한다** (거리·시선으로 후보를 고르던 `tryTag` 포함). Task 2에서 남긴 `2.6` 리터럴도 여기서 사라진다.

그 자리에:

```tsx
  // Aim and fire. The candidate search this replaced picked the nearest hider
  // inside a 2.6u cone; a hitscan has no candidates — whatever the crosshair
  // is on is the answer, and the server no longer measures distance at all.
  useShoot({
    active: me.role === "seeker" && phase === "seeking" && !frozen,
    selfAccount: me.account,
    onShoot: onShoot,
  });
```

주의: `useShoot`의 옵션 이름은 `onFire`다. 위 호출을 `onFire: onShoot`으로 맞춘다.

import를 더한다:

```tsx
import { useShoot, type ShotResult } from "./useShoot";
```

`TAG`/`SHOT` import가 더 이상 쓰이지 않으면 지운다.

- [ ] **Step 4: `game/src/App.tsx` — `onTag`를 `onShoot`으로**

```tsx
  const onShoot = useCallback(
    (result: ShotResult) => {
      // A miss is a legitimate outcome and costs nothing to send — but there is
      // nobody to send it about, so it stops here. The tracer and the report are
      // Task 5's job.
      if (!result.account) return;
      game.requestShot(result.account).catch(() => {});
    },
    [game]
  );
```

`<LocalPlayer onTag={onTag} …>`을 `onShoot={onShoot}`으로 바꾸고, `ShotResult` 타입을 import한다.

- [ ] **Step 5: 전체 검사와 빌드**

Run: `npx tsc --noEmit && npm run check && npx vite build`
Expected: 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add game/src/game/useShoot.ts game/src/game/RemotePlayers.tsx game/src/game/LocalPlayer.tsx game/src/App.tsx
git commit -m "feat: decide the hit with one raycast, so cover works for free"
```

---

### Task 5: 총, 트레이서, 총소리

**Files:**
- Create: `game/src/game/Gun.tsx`
- Modify: `game/src/game/Humanoid.tsx`, `game/src/game/LocalPlayer.tsx`, `game/src/App.tsx`, `game/src/net/useGame.ts`

**Interfaces:**
- Consumes: `ShotResult` (`game/src/game/useShoot.ts`), `playShot`/`shotGainFor` (`game/src/audio/sound.ts`)
- Produces: `<Gun />`, `<Tracer from to />`; `Humanoid`의 `held?: ReactNode`

- [ ] **Step 1: 모델 치수를 실측한다**

Run: `npm run glb:size -- public/models/blaster/blaster-a.glb public/models/blaster/blaster-j.glb public/models/blaster/blaster-r.glb`

`blaster-j`가 0.155 × 0.362 × 0.610으로 가장 짧아 손에 쥐는 크기에 가깝다. 실제 선택은 화면에서 정한다.

- [ ] **Step 2: `game/src/game/Humanoid.tsx`에 `held` 슬롯 추가**

`Props`에 더한다:

```tsx
  /**
   * Something carried in the right hand — the seeker's gun. Rendered inside the
   * shoulder group so it inherits the arm's rotation from the pose and the walk
   * cycle for free.
   */
  held?: React.ReactNode;
```

구조 분해에 `held`를 추가하고, 오른쪽 어깨 그룹의 팔 메시 다음에 넣는다:

```tsx
      <group ref={shoulderR} position={[profile.shoulderX, profile.shoulderY, 0]}>
        <mesh geometry={geoms.armR} material={material} position={[0, -armHalf, 0]} castShadow />
        {held && <group position={[0, -armHalf * 2, 0]}>{held}</group>}
      </group>
```

`armHalf * 2`는 팔의 끝, 즉 손이 있을 자리다.

- [ ] **Step 3: `game/src/game/Gun.tsx` 작성**

```tsx
import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";

/**
 * The seeker's blaster, and the tracer it leaves.
 *
 * Loaded through R3F's useLoader rather than drei's useGLTF: importing drei
 * pulls a second pre-bundled copy of @react-three/fiber into the dev server and
 * every hook in the component throws "Invalid hook call" — a failure that
 * points at this file and is really about module resolution. See HANDOFF.
 */

const GUN_URL = "/models/blaster/blaster-j.glb";

/** Native height of the model, from `npm run glb:size`. */
const GUN_NATIVE_LENGTH = 0.61;
/** How long the gun should be in the hand. A forearm is about 0.3. */
const GUN_LENGTH = 0.42;

export function Gun() {
  const gltf = useLoader(GLTFLoader, GUN_URL);

  const model = useMemo(() => {
    const clone = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const centre = new THREE.Vector3();
    box.getCenter(centre);

    const holder = new THREE.Group();
    clone.position.set(-centre.x, -centre.y, -centre.z);
    holder.add(clone);
    holder.scale.setScalar(GUN_LENGTH / GUN_NATIVE_LENGTH);
    holder.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
    return holder;
  }, [gltf]);

  // Rotated to point along the body's forward (+Z) rather than down the arm.
  return <primitive object={model} rotation={[Math.PI / 2, 0, 0]} />;
}

interface TracerProps {
  from: [number, number, number];
  to: [number, number, number];
}

/**
 * A thin bar between the muzzle and wherever the shot stopped.
 *
 * A cylinder rather than a THREE.Line: line width above 1 is ignored on every
 * platform this runs on, and a one-pixel tracer is invisible at the distances
 * this gun works at.
 */
export function Tracer({ from, to }: TracerProps) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    const len = direction.length() || 0.001;
    const mid = a.clone().add(direction.clone().multiplyScalar(0.5));
    // A cylinder is built along +Y, so rotate that onto the shot's direction.
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.clone().normalize()
    );
    return { position: mid, quaternion: q, length: len };
  }, [from, to]);

  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[0.02, 0.02, length, 6]} />
      <meshBasicMaterial color="#ffe6a0" transparent opacity={0.75} />
    </mesh>
  );
}
```

- [ ] **Step 4: `game/src/game/LocalPlayer.tsx` — 총을 쥐고 트레이서를 그린다**

술래이고 추적 페이즈일 때만 `held`를 넘긴다. `Humanoid`를 렌더하는 곳을 찾아:

```tsx
        held={me.role === "seeker" && phase === "seeking" ? <Gun /> : undefined}
```

트레이서는 마지막 발사를 짧게 들고 있어야 한다. `useShoot`의 `onFire`에서 로컬 상태에 넣고 타이머로 지운다:

```tsx
  /** The last shot, held just long enough to see. */
  const [tracer, setTracer] = useState<{ from: [number, number, number]; to: [number, number, number] } | null>(null);

  useShoot({
    active: me.role === "seeker" && phase === "seeking" && !frozen,
    selfAccount: me.account,
    onFire: (result) => {
      const [px, py, pz] = motion.current.pos;
      // From roughly the chest rather than the feet, so the tracer does not
      // appear to come out of the floor.
      setTracer({ from: [px, py + CAMERA.shoulderHeight, pz], to: result.point });
      onShoot(result);
    },
  });

  // 80ms is long enough to register and short enough not to become a laser.
  useEffect(() => {
    if (!tracer) return;
    const id = setTimeout(() => setTracer(null), 80);
    return () => clearTimeout(id);
  }, [tracer]);
```

그리고 렌더에 `{tracer && <Tracer from={tracer.from} to={tracer.to} />}`를 더한다. `Tracer`는 플레이어 그룹 **밖**에 있어야 한다 — 그룹은 플레이어와 함께 움직이고 회전하는데, 트레이서의 좌표는 월드 좌표다.

- [ ] **Step 5: 자기 발사음**

`onFire` 안에서 `playShot(shotGainFor(0))`을 부른다 — 자기 총은 거리 0이다.

- [ ] **Step 6: `game/src/net/useGame.ts` — 남의 총소리를 듣는다**

기존 `"paint"`/`"paintFill"` 구독 옆에 더한다. `me.pos`가 이 스코프에 없으므로, 거리를 재려면 자기 위치가 필요하다 — `rawMine?.pos`를 쓴다.

```ts
    const offShot = server.onRoomMessage(roomId, "shot", (msg: any) => {
      if (!msg || msg.account === account) return; // our own shot already sounded locally
      const from = Array.isArray(msg.from) ? msg.from : [0, 0, 0];
      const mine = Array.isArray(rawMine?.pos) ? rawMine.pos : [0, 0, 0];
      const distance = Math.hypot(Number(from[0]) - Number(mine[0]), Number(from[2]) - Number(mine[2]));
      playShot(shotGainFor(distance));
    });
```

`return`의 정리 목록에 `offShot?.()`을 더하고, effect 의존성에 `rawMine?.pos`를 **넣지 않는다** — 위치는 매 틱 바뀌므로 구독이 계속 재설정된다. 대신 최신 위치를 ref로 읽는다:

```ts
  const myPosRef = useRef<number[]>([0, 0, 0]);
  myPosRef.current = Array.isArray(rawMine?.pos) ? (rawMine.pos as number[]) : [0, 0, 0];
```

핸들러에서 `myPosRef.current`를 쓴다. **이건 이 프로젝트가 이미 아는 함정이다** — HANDOFF 6차 세션의 "`game`에서 꺼낸 값을 effect 의존성에 넣지 말라"와 같은 실패 모드고, 그때는 메인 스레드가 굶어 화면이 멈췄다.

import에 `playShot`, `shotGainFor`를 더한다.

- [ ] **Step 7: 전체 검사와 빌드**

Run: `npx tsc --noEmit && npm run check && npx vite build`
Expected: 전부 통과.

- [ ] **Step 8: 커밋**

```bash
git add game/src/game/Gun.tsx game/src/game/Humanoid.tsx game/src/game/LocalPlayer.tsx game/src/App.tsx game/src/net/useGame.ts
git commit -m "feat: put the blaster in the seeker's hand and let everyone hear it"
```

---

### Task 6: 문서 — 무엇을 대가로 치렀는지 적는다

**Files:**
- Modify: `README.md`, `HANDOFF.md`

- [ ] **Step 1: `README.md` 알려진 한계에 추가**

기존 항목들과 같은 형식으로:

- **사격 요청의 상한이 없어졌다.** 이전에는 `TAG.maxDistance` 2.6u가 조작된 클라이언트가 주장할 수 있는 범위의 상한이었다. 사거리가 무제한이 되면서 서버에 남은 검사는 페이즈·역할·대상·쿨다운·시선뿐이고, **맵 어디의 누구든 이름만 알면 잡았다고 주장할 수 있다.** 서버가 맵을 갖지 않는 한 되찾을 수 없다 — 벽 판정을 못 하니 어떤 거리 상한도 임의값이다.
- **밸런스 미검증.** 무제한 사거리 + 한 발에 잡힘이 하이더에게 얼마나 불리한지 모른다. 완화책은 맵에 이미 있다(풍차 칸막이, 산개물 440개). 손잡이는 사거리 상한·쿨다운·한 발/여러 발.

아레나·태그 관련 서술에서 "2.6u까지 접근해 클릭"으로 읽히는 부분을 사격으로 고친다.

- [ ] **Step 2: `HANDOFF.md`에 절 추가**

최신이 위. 담을 것:

- 태그 → 사격으로 바뀐 이유: 아레나가 88×88이 되면서 찾는 것과 잡는 것이 별개의 노동이 됐다.
- **명중 판정이 클라이언트인 이유와 그 대가** — 서버가 맵을 안 갖고 있고(이번 세션에 지웠다), 그래서 벽 판정을 못 하며, 따라서 거리 상한이 무의미하다. 위 README 항목과 같은 내용.
- 벽 판정을 별도 계산 없이 얻는 방법: 가장 가까운 히트 하나만 본다.
- `canShoot`을 순수 함수로 뽑은 이유: 하네스가 페이즈 전환을 못 돌려 거절 사유 6개가 서버 테스트로 도달 불가능하다.
- **화면으로 확인 못 한 것** — 명중·빗나감·벽 뒤 안전·트레이서·총소리 감쇠 전부. 셀도 여전히 미확인이다. **확인했다고 쓰지 않는다.** 다음 세션이 할 일을 구체적으로 적는다: 계정 2개, 한쪽이 술래, 엄폐물 뒤 하이더를 쏴서 안 맞는지 / 열린 곳에서 맞는지 / 트레이서가 보이는지 / 멀리서 쏜 소리가 작게 들리는지.

- [ ] **Step 3: 커밋**

```bash
git add README.md HANDOFF.md
git commit -m "docs: record what unlimited range cost"
```

---

## Self-Review 결과

**스펙 커버리지**: 섹션 1(대가) = Task 6. 섹션 2(클라이언트 명중) = Task 4. 섹션 3(서버 + 순수 함수) = Task 1·2. 섹션 4(총 렌더) = Task 5 Step 2·3·4. 섹션 5(트레이서·머즐·소리) = Task 3·5. 섹션 6(없어지는 것) = Task 2 Step 1, Task 4 Step 3. 섹션 7(검증) = Task 1 Step 1, Task 3 Step 1, Task 2 Step 5. R1·R3 = Task 6. R5(GLB 유무) = 해소됨, Blaster Kit에 GLB 40개 있음.

**머즐 플래시는 트레이서로 갈음했다.** 설계 문서가 둘을 따로 적었지만, 총구에서 시작하는 트레이서가 이미 발사 위치를 알려주고, 별도 발광은 같은 정보를 두 번 그린다. 화면 확인에서 부족하면 그때 더한다 — YAGNI.

**타입 일관성**: `ShotResult`는 Task 4가 정의하고 Task 5가 쓴다. `useShoot`의 콜백 이름은 `onFire`이며 Task 4 Step 3에 그 주의를 명시했다. 서버 `SHOT`과 클라이언트 `SHOT`은 필드가 같고 `check:sync`가 대조한다.

**미해결로 남긴 것**: Task 2 Step 3의 catch 적용 코드는 원본 `requestTag`를 읽고 그대로 옮겨야 한다 — 원본의 API 사용법(방 id를 얻는 방식, 점수 배선)을 추측으로 재작성하면 안 된다. 그 지시를 해당 스텝에 굵게 적었다.

# 아바타 상점 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 허브에서 코인으로 체형이 다른 아바타를 사고 장착한다. 게임플레이 판정은 전혀 바뀌지 않는다.

**Architecture:** `Humanoid.tsx`의 하드코딩된 체형 숫자를 `BodyProfile`로 뽑아내고, 정수리/발바닥/최대폭을 파생 또는 검사로 고정해 모든 아바타가 동일한 충돌·카메라 봉투 안에 갇히게 한다. 코인·소유는 리더보드와 별개인 `wallets` 콜렉션에 두고, 모든 판단 로직은 서버 테스트 하네스가 라운드를 진행시키지 못하므로 `server/src/rules.ts`의 순수 함수로 뽑는다.

**Tech Stack:** TypeScript, React 18, three.js / @react-three/fiber, @agent8/gameserver(클라) + @agent8/gameserver-node(서버), tsx 스크립트 기반 검사.

**설계 문서:** [`docs/superpowers/specs/2026-07-27-avatar-shop-design.md`](../specs/2026-07-27-avatar-shop-design.md) — 수치의 근거와 대안 검토는 전부 여기 있다.

## Global Constraints

- **총 키 `TOP_Y = 1.86`, 발바닥 `FOOT_Y = 0.13`은 모든 프로필에서 고정.** 파생시켜 위반을 불가능하게 만든다.
- **최대 반폭 ≤ `MOVE.playerRadius`(0.45).** 현재 체형이 이미 정확히 0.45라 더 넓힐 여지가 없다.
- **부동소수점 비교는 전부 허용 오차 `1e-6`.** `1.86 - 0.34 === 1.52`는 거짓이다.
- **`MOVE` / `CAMERA` / `TAG` / `MOVE_SPEED_CAP` 등 이동·카메라·태그 상수는 한 글자도 수정하지 않는다.** 수정이 필요해 보이면 프로필 수치가 잘못된 것이다.
- **코인을 지급하거나 잔액을 설정하는 원격 메서드를 만들지 않는다.** 리더보드 설계가 점수 주입 메서드를 거부한 것과 같은 이유(누구나 자기 잔액 조작 가능). 오프라인 모드의 시작 잔액은 서버가 없는 순수 클라이언트 리그이므로 해당 없음.
- **지갑 쓰기 실패가 라운드 진행을 막아서는 안 된다.** 커밋 `88d005c`의 규율 — 페이즈 전환이 먼저 끝난 뒤 `try/catch`로 감싼다.
- 주석·UI 문구는 기존 코드와 같은 톤(주석은 영어, 사용자 대면 문구는 한국어).
- 각 태스크 종료 시 `npx tsc --noEmit`이 클린해야 한다.

---

### Task 1: `BodyProfile` — 카탈로그와 불변식 검사기

체형 데이터와 그 유효성 규칙만 만든다. 아직 아무것도 렌더링하지 않는다.

**Files:**
- Create: `src/game/bodies.ts`
- Create: `scripts/check-bodies.ts`
- Modify: `package.json:11-16` (스크립트 등록)

**Interfaces:**
- Consumes: `MOVE.playerRadius` from `src/game/constants.ts`
- Produces:
  - `interface BodyProfile { id, name, price, head:{r}, torso:{r,l,y}, arm:{r,l}, leg:{r,l}, shoulderX, shoulderY, hipX }`
  - `interface DerivedBody { headY, hipY, armHalf, legHalf }`
  - `TOP_Y = 1.86`, `FOOT_Y = 0.13`, `EPS = 1e-6`
  - `BODIES: BodyProfile[]`, `DEFAULT_BODY_ID = "classic"`
  - `derive(p: BodyProfile): DerivedBody`
  - `profileFor(id: string | undefined): BodyProfile` — 모르는 id는 `classic`
  - `validateProfile(p: BodyProfile): string[]` — 위반 사유 목록, 빈 배열이면 통과

- [ ] **Step 1: Write the failing check script**

Create `scripts/check-bodies.ts`:

```ts
/**
 * Body profile invariants.
 *
 * Avatars are cosmetic by construction, not by promise: every profile must sit
 * inside the exact collision and camera envelope the original body defined, or
 * buying one would buy an advantage in a hide-and-seek game.
 *
 * Run: npm run check:bodies
 */

import { MOVE } from "../src/game/constants";
import {
  BODIES,
  DEFAULT_BODY_ID,
  EPS,
  FOOT_Y,
  TOP_Y,
  derive,
  profileFor,
  validateProfile,
  type BodyProfile,
} from "../src/game/bodies";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

console.log("\ncatalog");
{
  check("catalog is not empty", BODIES.length > 0);

  const ids = BODIES.map((b) => b.id);
  check("ids are unique", new Set(ids).size === ids.length, ids.join(", "));

  const def = BODIES.find((b) => b.id === DEFAULT_BODY_ID);
  check("the default profile exists", !!def, `looking for ${DEFAULT_BODY_ID}`);
  check("the default profile is free", def?.price === 0);
  check(
    "every other profile costs something",
    BODIES.every((b) => b.id === DEFAULT_BODY_ID || b.price > 0)
  );
  check("every profile has a display name", BODIES.every((b) => b.name.trim().length > 0));
}

console.log("\ninvariants");
for (const b of BODIES) {
  const problems = validateProfile(b);
  check(`${b.id} satisfies every invariant`, problems.length === 0, problems.join("; "));
}

console.log("\nderived values");
for (const b of BODIES) {
  const d = derive(b);
  check(
    `${b.id} crown lands exactly on TOP_Y`,
    Math.abs(d.headY + b.head.r - TOP_Y) < EPS,
    `got ${d.headY + b.head.r}`
  );
  check(
    `${b.id} feet land exactly on FOOT_Y`,
    Math.abs(d.hipY - 2 * d.legHalf - FOOT_Y) < EPS,
    `got ${d.hipY - 2 * d.legHalf}`
  );
}

console.log("\nclassic is a pixel-for-pixel match for the pre-refactor body");
{
  // These four numbers were hardcoded in Humanoid.tsx before the refactor
  // (1.52 head, 0.70 hip, ARM_HALF 0.27, LEG_HALF 0.285). If the derivation
  // drifts, every existing player silently changes shape.
  const d = derive(profileFor("classic"));
  check("head sits at 1.52", Math.abs(d.headY - 1.52) < EPS, `got ${d.headY}`);
  check("hip sits at 0.70", Math.abs(d.hipY - 0.7) < EPS, `got ${d.hipY}`);
  check("arm half-length is 0.27", Math.abs(d.armHalf - 0.27) < EPS, `got ${d.armHalf}`);
  check("leg half-length is 0.285", Math.abs(d.legHalf - 0.285) < EPS, `got ${d.legHalf}`);
}

console.log("\nunknown ids fall back rather than throwing");
{
  // This id arrives over the network from another client, so it is untrusted.
  check("an unknown id resolves to the default", profileFor("../../etc/passwd").id === DEFAULT_BODY_ID);
  check("undefined resolves to the default", profileFor(undefined).id === DEFAULT_BODY_ID);
  check("an empty string resolves to the default", profileFor("").id === DEFAULT_BODY_ID);
}

console.log("\nthe validator actually rejects bad profiles");
{
  const base = profileFor("classic");
  const bend = (patch: Partial<BodyProfile>): BodyProfile => ({ ...base, ...patch });

  check(
    "rejects a body wider than the collision radius",
    validateProfile(bend({ shoulderX: MOVE.playerRadius })).length > 0
  );
  check(
    "rejects a torso wider than the collision radius",
    validateProfile(bend({ torso: { ...base.torso, r: MOVE.playerRadius + 0.1 } })).length > 0
  );
  check("rejects shoulders too low for the camera pivot", validateProfile(bend({ shoulderY: 0.9 })).length > 0);
  check("rejects shoulders too high for the camera pivot", validateProfile(bend({ shoulderY: 1.8 })).length > 0);
  check(
    "rejects a shoulder pivot floating outside the torso",
    validateProfile(bend({ shoulderY: 1.44, torso: { r: 0.1, l: 0.1, y: 0.6 } })).length > 0
  );
}

if (failures === 0) {
  console.log(`\n✅ ${BODIES.length} body profiles are cosmetic-only\n`);
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
```

- [ ] **Step 2: Register the script and run it to verify it fails**

In `package.json`, add `check:bodies` and chain it into `check`:

```json
    "check:bodies": "tsx scripts/check-bodies.ts",
    "check": "tsc --noEmit && npm run check:sync && npm run check:bodies && npm run check:movement && npm run check:hub && npm run check:audio && npm run check:leaderboard && npm run server:test",
```

Run: `npm run check:bodies`
Expected: FAIL — `Cannot find module '../src/game/bodies'`

- [ ] **Step 3: Write `src/game/bodies.ts`**

```ts
/**
 * Body profiles.
 *
 * An avatar changes proportions only. Total height, foot level and maximum
 * half-width are identical across every profile, so a purchased body is never
 * easier to hide — which in a hide-and-seek game is the difference between a
 * cosmetic shop and a pay-to-win one.
 *
 * Height and foot level are DERIVED rather than stored, so a profile cannot
 * express a violation of them at all. Width and pivot placement can't be
 * derived away, so validateProfile() checks those and check:bodies runs it
 * over the whole catalogue.
 */

import { MOVE } from "./constants";

/** Crown of the head. Taken from the original body: 1.52 + 0.34. */
export const TOP_Y = 1.86;
/** Sole of the foot. Taken from the original body: 0.70 - 2 * 0.285. */
export const FOOT_Y = 0.13;
/** Shared tolerance — 1.86 - 0.34 is not exactly 1.52 in binary floating point. */
export const EPS = 1e-6;

/** Camera pivots at CAMERA.shoulderHeight (1.35); shoulders must stay near it. */
const SHOULDER_RANGE = { min: 1.16, max: 1.4 };

export interface BodyProfile {
  id: string;
  /** Shown in the shop. */
  name: string;
  /** 0 marks the profile everyone starts with. */
  price: number;
  head: { r: number };
  torso: { r: number; l: number; y: number };
  arm: { r: number; l: number };
  leg: { r: number; l: number };
  shoulderX: number;
  shoulderY: number;
  hipX: number;
}

export interface DerivedBody {
  headY: number;
  hipY: number;
  /** Half the capsule's total length — where the mesh hangs below its pivot. */
  armHalf: number;
  legHalf: number;
}

/** Half the total length of a capsule: the cylinder plus one end cap. */
function capsuleHalf(radius: number, length: number): number {
  return length / 2 + radius;
}

export function derive(p: BodyProfile): DerivedBody {
  const armHalf = capsuleHalf(p.arm.r, p.arm.l);
  const legHalf = capsuleHalf(p.leg.r, p.leg.l);
  return {
    headY: TOP_Y - p.head.r,
    hipY: FOOT_Y + legHalf * 2,
    armHalf,
    legHalf,
  };
}

/** Widest point of the body, measured from the centre line. */
export function maxHalfWidth(p: BodyProfile): number {
  return Math.max(p.shoulderX + p.arm.r, p.torso.r, p.hipX + p.leg.r);
}

/** Empty means the profile is safe to ship. */
export function validateProfile(p: BodyProfile): string[] {
  const problems: string[] = [];
  const d = derive(p);

  const width = maxHalfWidth(p);
  if (width > MOVE.playerRadius + EPS) {
    problems.push(
      `half-width ${width.toFixed(3)} exceeds MOVE.playerRadius ${MOVE.playerRadius} — the body would poke out of its own collision cylinder`
    );
  }

  if (p.shoulderY < SHOULDER_RANGE.min - EPS || p.shoulderY > SHOULDER_RANGE.max + EPS) {
    problems.push(
      `shoulderY ${p.shoulderY} is outside ${SHOULDER_RANGE.min}..${SHOULDER_RANGE.max} — the camera would stop pivoting at anything recognisable as a shoulder`
    );
  }

  // Limbs hang off pivots; a pivot outside the torso leaves them visibly detached.
  const torsoHalf = capsuleHalf(p.torso.r, p.torso.l);
  if (p.shoulderY > p.torso.y + torsoHalf + EPS) {
    problems.push(`shoulder pivot ${p.shoulderY} floats above the torso (top ${p.torso.y + torsoHalf})`);
  }
  if (d.hipY < p.torso.y - torsoHalf - EPS) {
    problems.push(`hip pivot ${d.hipY} hangs below the torso (bottom ${p.torso.y - torsoHalf})`);
  }

  return problems;
}

export const DEFAULT_BODY_ID = "classic";

export const BODIES: BodyProfile[] = [
  {
    id: "classic",
    name: "클래식",
    price: 0,
    head: { r: 0.34 },
    torso: { r: 0.26, l: 0.34, y: 0.98 },
    arm: { r: 0.1, l: 0.34 },
    leg: { r: 0.125, l: 0.32 },
    shoulderX: 0.35,
    shoulderY: 1.28,
    hipX: 0.16,
  },
  {
    id: "bean",
    name: "콩이",
    price: 40,
    head: { r: 0.4 },
    torso: { r: 0.32, l: 0.3, y: 0.95 },
    arm: { r: 0.115, l: 0.24 },
    leg: { r: 0.145, l: 0.2 },
    shoulderX: 0.335,
    shoulderY: 1.18,
    hipX: 0.15,
  },
  {
    id: "stick",
    name: "막대",
    price: 60,
    head: { r: 0.26 },
    torso: { r: 0.2, l: 0.36, y: 1.06 },
    arm: { r: 0.075, l: 0.46 },
    leg: { r: 0.095, l: 0.5 },
    shoulderX: 0.375,
    shoulderY: 1.38,
    hipX: 0.13,
  },
  {
    id: "tank",
    name: "떡대",
    price: 90,
    head: { r: 0.29 },
    torso: { r: 0.3, l: 0.4, y: 1.02 },
    arm: { r: 0.14, l: 0.3 },
    leg: { r: 0.16, l: 0.26 },
    shoulderX: 0.31,
    shoulderY: 1.3,
    hipX: 0.18,
  },
];

const BY_ID = new Map(BODIES.map((b) => [b.id, b]));

/**
 * Never throws: ids arrive over the wire from other clients, and one bad value
 * must not take down everyone's renderer.
 */
export function profileFor(id: string | undefined): BodyProfile {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_BODY_ID)!;
}
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `npm run check:bodies`
Expected: PASS — `✅ 4 body profiles are cosmetic-only`

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add src/game/bodies.ts scripts/check-bodies.ts package.json
git commit -m "Add body profiles with invariants that keep avatars cosmetic

Height and foot level are derived from shared constants so a profile cannot
express a body that stands taller or shorter than the original. Width and
pivot placement can't be derived away, so validateProfile checks them and
check:bodies runs it over the catalogue."
```

---

### Task 2: `Humanoid`이 프로필을 소비하도록 리팩터 (화면은 그대로)

**이 태스크는 의도적으로 시각적 변화가 0이다.** `classic`만 쓰이므로 리팩터 전후 화면이 픽셀 단위로 같아야 한다. 나중에 체형이 이상해 보일 때 리팩터 탓인지 새 수치 탓인지 구분하려면 이 경계가 필요하다.

**Files:**
- Modify: `src/game/Humanoid.tsx` (전반)

**Interfaces:**
- Consumes: `profileFor`, `derive`, `type BodyProfile` from `src/game/bodies.ts`
- Produces: `Humanoid`의 새 optional prop `body?: string`. 미지정 시 `classic`.

- [ ] **Step 1: Replace the module constants with a resolved profile**

`src/game/Humanoid.tsx:20-23`의 네 상수를 삭제한다:

```ts
const SHOULDER_Y = 1.28;
const ARM_HALF = 0.27;
const HIP_Y = 0.7;
const LEG_HALF = 0.285;
```

import에 추가:

```ts
import { derive, profileFor } from "./bodies";
```

`Props`에 추가:

```ts
  /** Body profile id. Unknown or missing values fall back to the default. */
  body?: string;
```

시그니처(57행)와 본문 상단:

```ts
export function Humanoid({ account, pose, motionRef, dimmed, showOutline, fadeRef, body }: Props) {
```

`const surface = surfaceFor(account);` 바로 아래에:

```ts
  const profile = profileFor(body);
  const { headY, hipY, armHalf, legHalf } = useMemo(() => derive(profile), [profile]);
```

- [ ] **Step 2: Make the geometry follow the profile**

`geoms` useMemo(74-87행)를 교체한다. **deps에 `profile`을 넣는 것이 핵심** — 없으면 아바타를 바꿔도 예전 몸이 그대로 남는다.

```ts
  const geoms = useMemo(() => {
    const make = (geometry: THREE.BufferGeometry, part: BodyPart) => {
      packUVs(geometry, part);
      return geometry;
    };
    return {
      head: make(new THREE.SphereGeometry(profile.head.r, 24, 18), "head"),
      torso: make(new THREE.CapsuleGeometry(profile.torso.r, profile.torso.l, 6, 18), "torso"),
      armL: make(new THREE.CapsuleGeometry(profile.arm.r, profile.arm.l, 4, 12), "armL"),
      armR: make(new THREE.CapsuleGeometry(profile.arm.r, profile.arm.l, 4, 12), "armR"),
      legL: make(new THREE.CapsuleGeometry(profile.leg.r, profile.leg.l, 4, 12), "legL"),
      legR: make(new THREE.CapsuleGeometry(profile.leg.r, profile.leg.l, 4, 12), "legR"),
    };
  }, [profile]);
```

기존 정리 `useEffect`(99-104행)는 그대로 둔다 — deps가 `[geoms, material]`이라 프로필이 바뀔 때 옛 지오메트리를 이미 올바르게 dispose한다.

- [ ] **Step 3: Make the animation targets follow the profile**

`useFrame` 안에서 세 군데를 바꾼다.

163행, 머리 높이:

```ts
      head.current.position.y += (headY + nod - head.current.position.y) * k;
```

188-189행 및 193-194행, 엉덩이 좌우 간격과 높이:

```ts
    if (hipL.current) {
      hipL.current.rotation.x += (legPitchL - hipL.current.rotation.x) * k;
      hipL.current.position.x += (-profile.hipX * spec.legSpread - hipL.current.position.x) * k;
      hipL.current.position.y += (hipY + liftL - hipL.current.position.y) * k;
    }
    if (hipR.current) {
      hipR.current.rotation.x += (legPitchR - hipR.current.rotation.x) * k;
      hipR.current.position.x += (profile.hipX * spec.legSpread - hipR.current.position.x) * k;
      hipR.current.position.y += (hipY + liftR - hipR.current.position.y) * k;
    }
```

걷기·점프·착지 스쿼시·포즈 로직은 전부 피벗 회전이라 **다른 줄은 건드리지 않는다.**

- [ ] **Step 4: Make the JSX follow the profile**

198-216행의 `<group ref={root}>` 내부를 교체한다:

```tsx
      <mesh ref={head} geometry={geoms.head} material={material} position={[0, headY, 0]} castShadow />
      <mesh
        ref={torso}
        geometry={geoms.torso}
        material={material}
        position={[0, profile.torso.y, 0]}
        castShadow
      />

      <group ref={shoulderL} position={[-profile.shoulderX, profile.shoulderY, 0]}>
        <mesh geometry={geoms.armL} material={material} position={[0, -armHalf, 0]} castShadow />
      </group>
      <group ref={shoulderR} position={[profile.shoulderX, profile.shoulderY, 0]}>
        <mesh geometry={geoms.armR} material={material} position={[0, -armHalf, 0]} castShadow />
      </group>

      <group ref={hipL} position={[-profile.hipX, hipY, 0]}>
        <mesh geometry={geoms.legL} material={material} position={[0, -legHalf, 0]} castShadow />
      </group>
      <group ref={hipR} position={[profile.hipX, hipY, 0]}>
        <mesh geometry={geoms.legR} material={material} position={[0, -legHalf, 0]} castShadow />
      </group>
```

`showOutline`의 와이어프레임 타원체(217-222행)는 **그대로 둔다.** 총 키와 최대 반폭이 모든 프로필에서 같으므로 고정 타원체가 네 체형 모두를 여전히 감싼다.

- [ ] **Step 5: Verify nothing changed**

Run: `npm run check`
Expected: 전부 통과 (기존 검사 + 새 `check:bodies`)

브라우저로 확인한다 (프로젝트에 `.claude/launch.json`이 이미 있다):
1. `paint-chameleon` 프리뷰를 띄운다
2. 게임 참가 → 허브에 들어간다
3. 자기 몸과 봇 2명(`미나`/`준`)이 **리팩터 전과 똑같이** 보이는지 확인한다 — 팔다리가 몸에서 떨어지거나 바닥에 잠기거나 공중에 뜨지 않아야 한다
4. 걸어보고 점프해서 걷기 사이클과 착지 스쿼시가 정상인지 확인한다
5. 콘솔에 에러가 없는지 확인한다

- [ ] **Step 6: Commit**

```bash
git add src/game/Humanoid.tsx
git commit -m "Drive Humanoid from a body profile instead of module constants

Deliberately a visual no-op: only the classic profile is in use, and its
derived values reproduce the four constants this removes exactly. Keeping the
refactor separate from the new shapes means a later 'that looks wrong' has
only one possible cause."
```

---

### Task 3: 서버 지갑 순수 로직

원격 메서드도, 콜렉션 I/O도 아직 없다. 하네스가 라운드를 진행시키지 못하고 코인 지급 메서드도 만들지 않으므로, **결정 로직 전부가 여기서 검증된다.**

**Files:**
- Modify: `server/src/rules.ts` (파일 끝에 추가)
- Create: `scripts/check-shop.ts`
- Modify: `scripts/check-sync.ts` (카탈로그 대조 추가)
- Modify: `package.json` (스크립트 등록)

**Interfaces:**
- Produces (전부 `server/src/rules.ts`에서 export):
  - `WALLET_COLLECTION = "wallets"`
  - `COINS = { perRound: 5, survived: 5, perCatch: 2 }`
  - `AVATAR_PRICES: Record<string, number>`
  - `interface WalletState { coins: number; owned: string[]; equipped: string }`
  - `DEFAULT_WALLET: WalletState`
  - `parseOwned(s: string): string[]` / `serializeOwned(ids: string[]): string`
  - `coinsFor(o: { seeker: boolean; caught: boolean; catches: number }): number`
  - `type PurchaseFailure = "unknown" | "owned" | "broke"`
  - `applyPurchase(w, id): { ok: true; wallet: WalletState } | { ok: false; reason: PurchaseFailure }`
  - `applyEquip(w, id): { ok: true; wallet: WalletState } | { ok: false }`

- [ ] **Step 1: Write the failing check script**

Create `scripts/check-shop.ts`:

```ts
/**
 * Avatar shop decision logic.
 *
 * Everything that decides anything lives in pure functions, because the server
 * test harness cannot drive a round to completion and we deliberately ship no
 * remote method that grants coins — so a successful purchase is unreachable on
 * a live server in tests. Same wall the leaderboard hit; same answer.
 *
 * Run: npm run check:shop
 */

import {
  AVATAR_PRICES,
  COINS,
  DEFAULT_WALLET,
  applyEquip,
  applyPurchase,
  coinsFor,
  parseOwned,
  serializeOwned,
  type WalletState,
} from "../server/src/rules";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

console.log("\ncoinsFor");
{
  check(
    "a hider who survived earns the round fee plus the survival bonus",
    coinsFor({ seeker: false, caught: false, catches: 0 }) === COINS.perRound + COINS.survived
  );
  check(
    "a hider who was caught earns only the round fee",
    coinsFor({ seeker: false, caught: true, catches: 0 }) === COINS.perRound
  );
  check(
    "a seeker with three catches earns the fee plus three bounties",
    coinsFor({ seeker: true, caught: false, catches: 3 }) === COINS.perRound + COINS.perCatch * 3
  );
  check(
    "a seeker who caught nobody still earns the round fee",
    coinsFor({ seeker: true, caught: false, catches: 0 }) === COINS.perRound
  );
  check("nobody ever earns a negative amount", coinsFor({ seeker: true, caught: true, catches: -5 }) >= 0);
}

console.log("\nowned round-trip");
{
  check("an empty string parses to no items", parseOwned("").length === 0);
  check("whitespace-only parses to no items", parseOwned("   ").length === 0);
  check("a single id parses to one item", parseOwned("classic").join() === "classic");
  check("round-trips a list", serializeOwned(parseOwned("classic,bean")) === "classic,bean");
  check("drops empty segments", parseOwned("classic,,bean").length === 2);
}

console.log("\ndefault wallet");
{
  check("starts with no coins", DEFAULT_WALLET.coins === 0);
  check("owns the free profile", DEFAULT_WALLET.owned.includes("classic"));
  check("has the free profile equipped", DEFAULT_WALLET.equipped === "classic");
  check("owns nothing else", DEFAULT_WALLET.owned.length === 1);
}

console.log("\napplyPurchase");
{
  const rich = (): WalletState => ({ coins: 1000, owned: ["classic"], equipped: "classic" });

  const unknown = applyPurchase(rich(), "does-not-exist");
  check("rejects an id that is not for sale", unknown.ok === false);
  check("...with reason 'unknown'", unknown.ok === false && unknown.reason === "unknown");

  const already = applyPurchase(rich(), "classic");
  check("rejects something already owned", already.ok === false);
  check("...with reason 'owned'", already.ok === false && already.reason === "owned");

  const broke = applyPurchase({ coins: 0, owned: ["classic"], equipped: "classic" }, "bean");
  check("rejects when the balance is short", broke.ok === false);
  check("...with reason 'broke'", broke.ok === false && broke.reason === "broke");

  // Exactly the price, not a coin more or less.
  const before = rich();
  const bought = applyPurchase(before, "bean");
  check("accepts an affordable, unowned avatar", bought.ok === true);
  check(
    "deducts exactly the listed price",
    bought.ok === true && bought.wallet.coins === before.coins - AVATAR_PRICES.bean
  );
  check("adds the avatar to owned", bought.ok === true && bought.wallet.owned.includes("bean"));
  check(
    "adds it exactly once",
    bought.ok === true && bought.wallet.owned.filter((i) => i === "bean").length === 1
  );
  check(
    "does not auto-equip the purchase",
    bought.ok === true && bought.wallet.equipped === "classic"
  );

  // A rejected purchase that mutated the input would leak coins on the way out.
  const untouched = rich();
  applyPurchase(untouched, "bean");
  check("leaves the input wallet untouched on success", untouched.coins === 1000 && untouched.owned.length === 1);
  const untouched2 = rich();
  applyPurchase(untouched2, "does-not-exist");
  check("leaves the input wallet untouched on failure", untouched2.coins === 1000);

  // Affording it exactly must work — an off-by-one here would be invisible
  // until someone saved up the precise amount.
  const exact = applyPurchase({ coins: AVATAR_PRICES.tank, owned: ["classic"], equipped: "classic" }, "tank");
  check("affording the exact price is enough", exact.ok === true);
  check("...and lands on a zero balance", exact.ok === true && exact.wallet.coins === 0);
}

console.log("\napplyEquip");
{
  const w: WalletState = { coins: 0, owned: ["classic", "bean"], equipped: "classic" };

  const notOwned = applyEquip(w, "tank");
  check("refuses to equip something not owned", notOwned.ok === false);

  const unknown = applyEquip(w, "does-not-exist");
  check("refuses to equip an unknown id", unknown.ok === false);

  const equipped = applyEquip(w, "bean");
  check("equips an owned avatar", equipped.ok === true);
  check("...and changes nothing else", equipped.ok === true && equipped.wallet.coins === w.coins);
  check("leaves the input wallet untouched", w.equipped === "classic");
}

if (failures === 0) {
  console.log("\n✅ shop logic is consistent\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
```

- [ ] **Step 2: Register the script and run it to verify it fails**

In `package.json` add `check:shop` and chain it after `check:bodies`:

```json
    "check:shop": "tsx scripts/check-shop.ts",
```

`check` 체인: `... && npm run check:bodies && npm run check:shop && npm run check:movement && ...`

Run: `npm run check:shop`
Expected: FAIL — `AVATAR_PRICES` 등이 `server/src/rules`에 없다는 에러

- [ ] **Step 3: Add the wallet logic to `server/src/rules.ts`**

파일 끝에 추가한다:

```ts
// ------------------------------------------------------------ avatar shop

/** Collection name for per-account coins and owned avatars. */
export const WALLET_COLLECTION = "wallets";

/** Coins earned per round. Deliberately a small, readable scale next to SCORE. */
export const COINS = { perRound: 5, survived: 5, perCatch: 2 };

/**
 * Prices, keyed by body profile id.
 * KEEP IN SYNC WITH src/game/bodies.ts BODIES — check:sync enforces it. The
 * server is the only authority on what a purchase costs; the client catalogue
 * is display only.
 */
export const AVATAR_PRICES: Record<string, number> = {
  classic: 0,
  bean: 40,
  stick: 60,
  tank: 90,
};

/** The profile every account owns for free. */
export const DEFAULT_AVATAR = "classic";

export interface WalletState {
  coins: number;
  owned: string[];
  equipped: string;
}

/** What an account looks like before it has ever finished a round. */
export const DEFAULT_WALLET: WalletState = {
  coins: 0,
  owned: [DEFAULT_AVATAR],
  equipped: DEFAULT_AVATAR,
};

/**
 * Owned avatars travel as one comma-separated string rather than an array:
 * whether this SDK's collections filter and sort array fields correctly isn't
 * documented anywhere we can check, and avatar ids are lowercase ASCII, so a
 * comma can never appear inside one.
 */
export function parseOwned(s: string): string[] {
  return String(s || "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function serializeOwned(ids: string[]): string {
  return ids.join(",");
}

export function coinsFor(o: { seeker: boolean; caught: boolean; catches: number }): number {
  const catches = Math.max(0, Math.floor(o.catches || 0));
  if (o.seeker) return COINS.perRound + catches * COINS.perCatch;
  return COINS.perRound + (o.caught ? 0 : COINS.survived);
}

export type PurchaseFailure = "unknown" | "owned" | "broke";

/**
 * Pure: returns a NEW wallet and never touches the input, so a rejected
 * purchase can't leave a half-applied balance behind.
 */
export function applyPurchase(
  w: WalletState,
  id: string
): { ok: true; wallet: WalletState } | { ok: false; reason: PurchaseFailure } {
  const price = AVATAR_PRICES[id];
  if (price === undefined) return { ok: false, reason: "unknown" };
  if (w.owned.includes(id)) return { ok: false, reason: "owned" };
  if (w.coins < price) return { ok: false, reason: "broke" };

  return {
    ok: true,
    wallet: { coins: w.coins - price, owned: [...w.owned, id], equipped: w.equipped },
  };
}

export function applyEquip(
  w: WalletState,
  id: string
): { ok: true; wallet: WalletState } | { ok: false } {
  if (AVATAR_PRICES[id] === undefined) return { ok: false };
  if (!w.owned.includes(id)) return { ok: false };
  return { ok: true, wallet: { coins: w.coins, owned: [...w.owned], equipped: id } };
}
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `npm run check:shop`
Expected: PASS — `✅ shop logic is consistent`

- [ ] **Step 5: Extend `check:sync` to guard the price table**

`scripts/check-sync.ts`의 import에 추가:

```ts
import { BODIES } from "../src/game/bodies";
import { MAP_BOXES as SERVER_BOXES, /* ...기존... */ AVATAR_PRICES } from "../server/src/rules";
```

`movement speed cap` 블록 뒤에 추가:

```ts
console.log("\navatar catalogue");

// The client shows a price; the server charges one. If they drift, a player is
// billed an amount the shop never displayed — and the server always wins.
{
  const clientIds = BODIES.map((b) => b.id).sort();
  const serverIds = Object.keys(AVATAR_PRICES).sort();

  if (clientIds.join(",") !== serverIds.join(",")) {
    fail(`avatar ids differ: client [${clientIds.join(", ")}], server [${serverIds.join(", ")}]`);
  } else {
    pass(`both sides offer the same ${clientIds.length} avatars`);

    const mismatched = BODIES.filter((b) => AVATAR_PRICES[b.id] !== b.price);
    if (mismatched.length) {
      for (const b of mismatched) {
        fail(`${b.id} costs ${b.price} on the client but ${AVATAR_PRICES[b.id]} on the server`);
      }
    } else {
      pass("every price matches");
    }
  }
}
```

- [ ] **Step 6: Run the full check suite**

Run: `npm run check`
Expected: 전부 통과

- [ ] **Step 7: Commit**

```bash
git add server/src/rules.ts scripts/check-shop.ts scripts/check-sync.ts package.json
git commit -m "Add pure wallet logic for the avatar shop

Every decision — pricing, affordability, ownership, coin accrual — is a pure
function here rather than inline in a remote method. The test harness cannot
finish a round, and we ship no method that grants coins, so a successful
purchase is unreachable on a live test server; pure functions are the only
place this logic can actually be covered. check:sync now guards the price
table against drifting from the client catalogue."
```

---

### Task 4: 지갑 원격 메서드

**Files:**
- Modify: `server/src/server.ts` (import 25행 부근, `Server` 클래스에 메서드 추가)
- Modify: `server/test/server.test.ts` (파일 끝에 `describe` 추가)

**Interfaces:**
- Consumes: Task 3의 `WALLET_COLLECTION`, `DEFAULT_WALLET`, `applyPurchase`, `applyEquip`, `parseOwned`, `serializeOwned`, `WalletState`
- Produces:
  - `getWallet(): Promise<WalletState>`
  - `buyAvatar(id): Promise<{ ok: true; wallet: WalletState } | { ok: false; reason: PurchaseFailure }>`
  - `equipAvatar(id): Promise<{ ok: boolean }>`
  - 내부 헬퍼 `readWallet(account)` / `writeWallet(account, wallet)`

- [ ] **Step 1: Write the failing server tests**

`server/test/server.test.ts` 끝에 추가:

```ts
describe("avatar shop", () => {
  test("a brand new account gets the default wallet", async (server) => {
    server.connect({ account: "user-shop-fresh" });
    await server.joinHub("fresh");

    const w = await server.getWallet();
    expect(w.coins).toBe(0);
    expect(w.equipped).toBe("classic");
    expect(w.owned.includes("classic")).toBe(true);
  });

  test("buying with an empty balance is refused", async (server) => {
    server.connect({ account: "user-shop-broke" });
    await server.joinHub("broke");

    const res = await server.buyAvatar("bean");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("broke");
  });

  test("buying something that is not for sale is refused", async (server) => {
    server.connect({ account: "user-shop-unknown" });
    await server.joinHub("unknown");

    const res = await server.buyAvatar("not-a-real-avatar");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unknown");
  });

  test("equipping an avatar you do not own is refused", async (server) => {
    server.connect({ account: "user-shop-cheat" });
    await server.joinHub("cheat");

    const res = await server.equipAvatar("tank");
    expect(res.ok).toBe(false);

    // ...and the refusal must not have quietly changed anything.
    const w = await server.getWallet();
    expect(w.equipped).toBe("classic");
  });

  test("equipping the free avatar works", async (server) => {
    server.connect({ account: "user-shop-default" });
    await server.joinHub("default");

    const res = await server.equipAvatar("classic");
    expect(res.ok).toBe(true);
  });

  test("a refused purchase leaves the balance alone", async (server) => {
    server.connect({ account: "user-shop-intact" });
    await server.joinHub("intact");

    await server.buyAvatar("tank");
    await server.buyAvatar("nope");

    const w = await server.getWallet();
    expect(w.coins).toBe(0);
    expect(w.owned.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run server:test`
Expected: FAIL — `server.getWallet is not a function`

- [ ] **Step 3: Implement the wallet I/O and remote methods**

`server/src/server.ts:25` 부근의 import에 추가:

```ts
  WALLET_COLLECTION,
  DEFAULT_WALLET,
  applyPurchase,
  applyEquip,
  parseOwned,
  serializeOwned,
  coinsFor,
  type WalletState,
```

`upsertLeaderboard` 함수 바로 뒤(179행 부근)에 헬퍼를 추가한다:

```ts
/**
 * An account with no row yet reads back as the default wallet rather than
 * nothing, so the shop works before a player has finished their first round.
 */
async function readWallet(account: string): Promise<{ wallet: WalletState; __id: string | null }> {
  const rows = (await $global.getCollectionItems(WALLET_COLLECTION, {
    filters: [{ field: "account", operator: "==", value: account }],
  })) as any[];

  if (!rows.length) return { wallet: { ...DEFAULT_WALLET, owned: [...DEFAULT_WALLET.owned] }, __id: null };

  const row = rows[0];
  const owned = parseOwned(row.owned);
  return {
    wallet: {
      coins: num(row.coins),
      // A row written before this account owned anything must still include
      // the free avatar, or the player loses the body they're standing in.
      owned: owned.length ? owned : [...DEFAULT_WALLET.owned],
      equipped: row.equipped || DEFAULT_WALLET.equipped,
    },
    __id: row.__id,
  };
}

async function writeWallet(account: string, __id: string | null, wallet: WalletState) {
  const fields = {
    coins: wallet.coins,
    owned: serializeOwned(wallet.owned),
    equipped: wallet.equipped,
  };
  if (__id) await $global.updateCollectionItem(WALLET_COLLECTION, { __id, ...fields });
  else await $global.addCollectionItem(WALLET_COLLECTION, { account, ...fields });
}
```

`Server` 클래스 안, `getLeaderboard` 바로 뒤에 추가한다:

```ts
  async getWallet(): Promise<WalletState> {
    const { wallet } = await readWallet($sender.account);
    return wallet;
  }

  /**
   * Server-authoritative: the client's catalogue is display only, and every
   * price, balance and ownership check happens here.
   *
   * The whole read-decide-write runs under a lock. Without it a double-click
   * sends two requests that both read the same balance and both succeed,
   * handing out two avatars for the price of one.
   */
  async buyAvatar(id: string) {
    const account = $sender.account;
    return await $lock("wallet:" + account, async () => {
      const { wallet, __id } = await readWallet(account);
      const result = applyPurchase(wallet, String(id ?? ""));
      if (!result.ok) return result;

      await writeWallet(account, __id, result.wallet);
      return { ok: true as const, wallet: result.wallet };
    });
  }

  async equipAvatar(id: string): Promise<{ ok: boolean }> {
    const account = $sender.account;
    const equipped = await $lock("wallet:" + account, async () => {
      const { wallet, __id } = await readWallet(account);
      const result = applyEquip(wallet, String(id ?? ""));
      if (!result.ok) return null;

      await writeWallet(account, __id, result.wallet);
      return result.wallet.equipped;
    });

    if (!equipped) return { ok: false };

    // Peers render each other from room state, so the new body has to land
    // there too — the wallet alone is invisible to everyone else.
    await $room.updateMyState({ body: equipped });
    return { ok: true };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run server:test`
Expected: PASS — 기존 16개 + 새 6개

- [ ] **Step 5: Commit**

```bash
git add server/src/server.ts server/test/server.test.ts
git commit -m "Add server-authoritative wallet reads, purchases and equips

The read-decide-write runs under a per-account lock: without it a double-click
sends two requests that read the same balance and both succeed, handing out
two avatars for one price. Accounts with no row read back as the default
wallet so the shop works before a player's first round ends."
```

---

### Task 5: 라운드 종료 시 코인 적립

**Files:**
- Modify: `server/src/server.ts:109-161` (`endRound`)

**Interfaces:**
- Consumes: Task 3의 `coinsFor`, Task 4의 `readWallet`/`writeWallet`

- [ ] **Step 1: Add coin accrual to `endRound`**

`endRound`의 결과 순회 루프(152-160행)를 교체한다. **기존 리더보드 upsert의 위치와 규율을 그대로 유지한다** — 페이즈 전환은 이미 위에서 끝났고, 실패는 절대 밖으로 새지 않는다.

```ts
  for (const r of results) {
    const nick = r.seeker ? users.find((u) => u.account === r.account)?.nick ?? "" : r.nick;
    try {
      await upsertLeaderboard(r.account, nick, r.gained);
    } catch {
      // Best-effort — a transient collection-write failure must not corrupt
      // or re-trigger this round's results, which have already been published.
    }
    try {
      await grantCoins(r.account, coinsFor({ seeker: !!r.seeker, caught: !!r.caught, catches }));
    } catch {
      // Same contract as the leaderboard write above. A round's coins are
      // dropped rather than retried: retrying would double-pay whoever the
      // partial failure already credited.
    }
  }
```

`writeWallet` 뒤에 헬퍼를 추가한다:

```ts
/** Add a round's earnings to an account's balance. */
async function grantCoins(account: string, amount: number) {
  if (amount <= 0) return;
  await $lock("wallet:" + account, async () => {
    const { wallet, __id } = await readWallet(account);
    await writeWallet(account, __id, { ...wallet, coins: wallet.coins + amount });
  });
}
```

`catches`는 이미 `endRound` 안에 있는 지역 변수다(115행에서 선언, hider 순회 중 증가). seeker 결과 항목에만 의미가 있고 hider에게는 `coinsFor`가 무시한다.

- [ ] **Step 2: Verify the existing tests still pass**

Run: `npm run server:test`
Expected: PASS — 기존 테스트 전부 통과 (적립 자체는 하네스가 라운드를 못 끝내서 직접 검증 불가, `coinsFor`는 `check:shop`이 이미 커버)

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add server/src/server.ts
git commit -m "Grant coins when a round ends

Sits beside the leaderboard upsert and inherits its contract: the phase has
already flipped to results before either runs, and a write failure is swallowed
rather than retried. Retrying would double-pay whoever a partial failure had
already credited."
```

---

### Task 6: 클라이언트 지갑 (온라인 + 오프라인)

**Files:**
- Modify: `src/net/types.ts` (지갑 타입 추가)
- Modify: `src/net/useGame.ts` (온라인 위임)
- Modify: `src/net/offline.ts` (인메모리 지갑)

**Interfaces:**
- Consumes: Task 4의 원격 메서드, Task 1의 `BODIES`/`DEFAULT_BODY_ID`
- Produces: `useGame()` 반환에 세 개 추가
  - `fetchWallet: () => Promise<WalletView>`
  - `buyAvatar: (id: string) => Promise<BuyResult>`
  - `equipAvatar: (id: string) => Promise<{ ok: boolean }>`

- [ ] **Step 1: Add the shared types**

`src/net/types.ts`의 `PlayerState`에 추가:

```ts
  /** Equipped body profile id; unknown values fall back to the default. */
  body?: string;
```

파일 끝에 추가:

```ts
export interface WalletView {
  coins: number;
  owned: string[];
  equipped: string;
}

export type BuyFailure = "unknown" | "owned" | "broke";

export type BuyResult =
  | { ok: true; wallet: WalletView }
  | { ok: false; reason: BuyFailure };
```

`src/net/useGame.ts:13`의 re-export에 추가:

```ts
export type { LeaderboardResult, PlayerState, RoomInfo, RankedLeaderboardEntry, WireDab, WalletView, BuyResult, BuyFailure } from "./types";
```

- [ ] **Step 2: Delegate in the online hook**

`useGame.ts`의 `useOnlineGame`에서 `fetchLeaderboard`를 만드는 자리 옆에 세 개를 추가한다(같은 `useCallback` 패턴을 따른다):

```ts
  const fetchWallet = useCallback(
    async (): Promise<WalletView> => await server.remoteFunction("getWallet", []),
    [server]
  );

  const buyAvatar = useCallback(
    async (id: string): Promise<BuyResult> => await server.remoteFunction("buyAvatar", [id]),
    [server]
  );

  const equipAvatar = useCallback(
    async (id: string): Promise<{ ok: boolean }> => await server.remoteFunction("equipAvatar", [id]),
    [server]
  );
```

반환 객체에 `fetchWallet, buyAvatar, equipAvatar`를 추가한다.

- [ ] **Step 3: Add the in-memory wallet to offline mode**

`src/net/offline.ts` 상단 import에 추가:

```ts
import { BODIES, DEFAULT_BODY_ID } from "../game/bodies";
import type { BuyResult, WalletView } from "./types";
```

훅 본문의 다른 `useState` 옆에 추가:

```ts
  /**
   * Rehearsal-only wallet. 100 coins is chosen, not arbitrary: it buys the two
   * cheapest avatars exactly and leaves the most expensive out of reach, so
   * both the successful purchase and the insufficient-funds refusal can be
   * exercised without a server. Resets on reload — offline mode is a rig, not
   * a save file. Nothing here exists on the server: granting coins over the
   * wire would let anyone set their own balance.
   */
  const [wallet, setWallet] = useState<WalletView>({
    coins: 100,
    owned: [DEFAULT_BODY_ID],
    equipped: DEFAULT_BODY_ID,
  });
```

반환 객체(`fetchLeaderboard` 옆)에 추가:

```ts
    fetchWallet: async (): Promise<WalletView> => wallet,

    buyAvatar: async (id: string): Promise<BuyResult> => {
      const profile = BODIES.find((b) => b.id === id);
      if (!profile) return { ok: false, reason: "unknown" };
      if (wallet.owned.includes(id)) return { ok: false, reason: "owned" };
      if (wallet.coins < profile.price) return { ok: false, reason: "broke" };

      const next: WalletView = {
        coins: wallet.coins - profile.price,
        owned: [...wallet.owned, id],
        equipped: wallet.equipped,
      };
      setWallet(next);
      return { ok: true, wallet: next };
    },

    equipAvatar: async (id: string): Promise<{ ok: boolean }> => {
      if (!wallet.owned.includes(id)) return { ok: false };
      setWallet((w) => ({ ...w, equipped: id }));
      return { ok: true };
    },
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no output

Run: `npm run check`
Expected: 전부 통과

- [ ] **Step 5: Commit**

```bash
git add src/net/types.ts src/net/useGame.ts src/net/offline.ts
git commit -m "Expose wallet reads, purchases and equips to the client

Offline mode gets an in-memory wallet seeded with 100 coins so the shop can be
rehearsed without a server: that buys the two cheapest avatars exactly and
leaves the dearest out of reach, exercising both the success and the
insufficient-funds path. It exists only in the client rig — the server still
ships no way to grant coins."
```

---

### Task 7: 장착한 체형을 네트워크로 흘리기

지갑이 아는 `equipped`가 실제로 화면에 나타나게 한다. 아직 상점이 없으므로 확인은 오프라인 지갑의 초기값을 잠깐 바꿔서 한다.

**Files:**
- Modify: `server/src/server.ts` (`joinHub` 207행 부근, `joinGame` 254행 부근)
- Modify: `src/game/RemotePlayers.tsx:76-81`
- Modify: `src/game/LocalPlayer.tsx:292` 부근
- Modify: `src/hub/HubPlayer.tsx:142`
- Modify: `src/hub/Hub.tsx`, `src/App.tsx` (prop 전달)

**Interfaces:**
- Consumes: Task 2의 `Humanoid`의 `body` prop, Task 6의 `fetchWallet`
- Produces: `PlayerState.body`가 룸 상태에 채워지고 모든 `Humanoid` 호출부가 넘긴다

- [ ] **Step 1: Seed `body` from the wallet when joining**

`server/src/server.ts`의 `joinHub`에서 `updateRoomUserState` 호출(207행) 앞에 지갑을 읽고, 상태에 `body`를 포함시킨다:

```ts
    const { wallet } = await readWallet($sender.account);

    await $global.updateRoomUserState(roomId, $sender.account, {
      nick: sanitizeNick(nick),
      body: wallet.equipped,
      pos: [(Math.random() - 0.5) * 6, 0, 8 + Math.random() * 3],
      rotY: Math.PI,
      pose: 0,
      moving: false,
      lastMoveAt: Date.now(),
    });
```

`joinGame`의 `updateRoomUserState`(254행 부근)에도 같은 방식으로 `body: wallet.equipped`를 추가한다.

- [ ] **Step 2: Pass `body` through every `Humanoid` call site**

`src/game/RemotePlayers.tsx:76-81`:

```tsx
      <Humanoid
        account={player.account}
        pose={player.pose ?? 0}
        motionRef={motion}
        dimmed={!!player.caught}
        body={player.body}
      />
```

`src/game/LocalPlayer.tsx:292` 부근의 `<Humanoid ... />`에 `body={body}`를 추가하고, `Props`에 `body?: string`를 더한 뒤 시그니처에서 구조분해한다.

`src/hub/HubPlayer.tsx:142`:

```tsx
      <Humanoid account={account} pose={0} body={body} motionRef={bodyMotion} showOutline fadeRef={bodyFade} />
```

`HubPlayer`의 `Props`에도 `body?: string`를 추가한다.

- [ ] **Step 3: Thread the equipped id down from `App.tsx`**

`App.tsx`에서 지갑을 한 번 읽어 상태로 들고, 허브와 매치 양쪽에 넘긴다. `useGame()` 구조분해에 `fetchWallet`을 추가하고:

```tsx
  const [equipped, setEquipped] = useState<string>(DEFAULT_BODY_ID);

  // The equipped body is needed to render the local player before any shop
  // interaction happens, so read it once on connect.
  useEffect(() => {
    let cancelled = false;
    fetchWallet()
      .then((w) => {
        if (!cancelled) setEquipped(w.equipped);
      })
      .catch(() => {
        // Cosmetic: the default body is a fine thing to stand in.
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWallet]);
```

`DEFAULT_BODY_ID`를 `src/game/bodies`에서 import한다. `<Hub ... body={equipped} />`와 매치 화면의 `<LocalPlayer ... body={equipped} />`로 넘기고, `Hub`는 그대로 `HubPlayer`에 전달한다.

- [ ] **Step 4: Verify end to end**

Run: `npx tsc --noEmit`
Expected: no output

오프라인 지갑의 초기 `equipped`를 `"tank"`로 **임시** 변경한 뒤(`src/net/offline.ts`), 프리뷰를 띄우고:
1. 허브에서 내 몸이 떡대 체형으로 보이는지 확인
2. 걷기·점프가 정상인지 확인
3. 벽·상자에 붙어봐서 몸이 충돌체 밖으로 튀어나오지 않는지 확인
4. `"stick"`으로도 바꿔 같은 확인을 반복 (가장 마른 체형이라 반대 방향 오류가 드러난다)
5. **확인이 끝나면 `DEFAULT_BODY_ID`로 되돌린다**

Run: `npm run check`
Expected: 전부 통과

- [ ] **Step 5: Commit**

```bash
git add server/src/server.ts src/game/RemotePlayers.tsx src/game/LocalPlayer.tsx src/hub/HubPlayer.tsx src/hub/Hub.tsx src/App.tsx
git commit -m "Render each player with the body they have equipped

Joining seeds the room state from the wallet so peers see the right shape
immediately, rather than everyone starting as classic and popping."
```

---

### Task 8: 허브 상점 구조물과 마네킹

**Files:**
- Modify: `src/hub/hubMap.ts` (키오스크 지오메트리와 `atShop`)
- Modify: `src/hub/Hub.tsx` (키오스크 + 마네킹 렌더)
- Modify: `src/hub/HubPlayer.tsx` (근접 감지 보고)

**Interfaces:**
- Consumes: Task 1의 `BODIES`, Task 2의 `Humanoid`의 `body` prop
- Produces:
  - `SHOP = { x: -9.5, z: 4, triggerRadius: 3.0 }` from `src/hub/hubMap.ts`
  - `atShop(x: number, z: number): boolean`
  - `HubPlayer`의 새 prop `onShopProximity: (inside: boolean) => void`

- [ ] **Step 1: Add the kiosk to the hub map**

`src/hub/hubMap.ts`의 `PORTALS` 뒤에 추가:

```ts
/**
 * The avatar shop. Sits beside the carpet between the spawn point and the
 * portals, so it's passed on the way to a match rather than hunted for.
 */
export const SHOP = {
  x: -9.5,
  z: 4,
  /** Wider than a portal's: this opens a panel, not an irreversible match join. */
  triggerRadius: 3.0,
  color: 0x2f6fae,
};

/** True while the player is close enough for the shop panel to be open. */
export function atShop(x: number, z: number): boolean {
  return Math.hypot(x - SHOP.x, z - SHOP.z) <= SHOP.triggerRadius;
}
```

`buildHub()`의 `props` 루프 뒤에 카운터 박스를 추가한다:

```ts
  // Shop counter — a desk with a back wall, left open at the front so the
  // trigger circle stays walkable.
  boxes.push({ p: [SHOP.x, 0.5, SHOP.z - 0.9], s: [3.4, 1.0, 0.7], c: SHOP.color });
  boxes.push({ p: [SHOP.x, 1.6, SHOP.z - 1.8], s: [3.4, 3.2, 0.4], c: SHOP.color });
```

- [ ] **Step 2: Render the kiosk and the rotating mannequins**

`src/hub/Hub.tsx`의 import에 추가:

```ts
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Humanoid, IDLE_MOTION } from "../game/Humanoid";
import { BODIES, DEFAULT_BODY_ID } from "../game/bodies";
import { HUB, HUB_BOXES, PORTALS, SHOP, type Portal } from "./hubMap";
```

`PortalArch` 뒤에 추가:

```tsx
/**
 * One avatar on a turntable. Full size and beside the counter, so the preview
 * is the same body you'd be walking around in — no separate preview canvas to
 * keep in sync with the real renderer.
 */
function Mannequin({ body, x, z }: { body: string; x: number; z: number }) {
  const group = useRef<THREE.Group>(null);
  const motion = useRef({ ...IDLE_MOTION });

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.5;
  });

  return (
    <group position={[x, 0.3, z]}>
      {/* Plinth, so they read as display pieces rather than idle players. */}
      <mesh position={[0, -0.15, 0]} receiveShadow>
        <cylinderGeometry args={[0.62, 0.62, 0.3, 20]} />
        <meshStandardMaterial color={hex(SHOP.color)} roughness={0.7} />
      </mesh>
      <group ref={group}>
        {/* A reserved surface key: real accounts never contain a colon. */}
        <Humanoid account={`__shop:${body}`} pose={0} body={body} motionRef={motion} />
      </group>
      <NameTag text={BODIES.find((b) => b.id === body)?.name ?? body} y={2.3} height={0.4} color="#ffffff" />
    </group>
  );
}

function ShopStand() {
  const paid = BODIES.filter((b) => b.id !== DEFAULT_BODY_ID);

  return (
    <group>
      <NameTag text="아바타 상점" y={3.6} height={0.52} color={hex(SHOP.color)} />
      {paid.map((b, i) => (
        <Mannequin key={b.id} body={b.id} x={SHOP.x - 1.2 + i * 1.2} z={SHOP.z - 0.2} />
      ))}
    </group>
  );
}
```

`NameTag`의 위치는 그룹 기준이므로 `ShopStand`를 `<group position={[SHOP.x, 0, SHOP.z]}>`로 감싸지 말고 마네킹에 절대 좌표를 넘긴다(위 코드가 그렇게 되어 있다). `NameTag`가 `y`와 `height`만 받는다면 상점 간판은 `<group position={[SHOP.x, 0, SHOP.z]}>`로 감싸고 마네킹만 그 안에서 상대 좌표를 쓰도록 조정한다 — 구현 시 `src/game/NameTag.tsx`의 실제 시그니처를 확인하고 둘 중 맞는 쪽을 택한다.

`Hub` 컴포넌트의 `{PORTALS.map(...)}` 뒤에 `<ShopStand />`를 추가한다. `three`를 `import * as THREE from "three"`로 들여온다(`useRef<THREE.Group>` 때문).

- [ ] **Step 3: Report shop proximity from the player controller**

`src/hub/HubPlayer.tsx`의 `Props`에 추가:

```ts
  onShopProximity: (inside: boolean) => void;
```

108행 부근, `portalAt` 호출 옆에 추가한다. **`frozen`일 때 false로 보고하지 않는다** — 패널이 열려서 frozen이 된 순간 즉시 닫히는 자기 무효화 루프가 된다:

```ts
    const standing = frozen ? null : portalAt(px, pz);
    onShopProximity(atShop(px, pz));
```

`atShop`을 `./hubMap` import에 추가한다.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no output

프리뷰에서:
1. 스폰 지점에서 왼쪽 앞으로 걸어가면 파란 상점 카운터와 마네킹 3개가 보인다
2. 세 마네킹이 각각 콩이·막대·떡대 체형으로 **뚜렷이 달라 보인다**
3. 천천히 회전한다
4. 카운터를 통과해 걸어 들어갈 수 없다(충돌 확인)
5. 마네킹이 서로 겹치거나 카운터에 박혀 있지 않다 — 겹치면 `x` 간격 1.2를 넓힌다

- [ ] **Step 5: Commit**

```bash
git add src/hub/hubMap.ts src/hub/Hub.tsx src/hub/HubPlayer.tsx
git commit -m "Put an avatar shop stand in the hub

The paid bodies stand full-size on turntables beside the counter, so the
preview is literally the renderer that draws them in a match — there's no
second preview path to drift."
```

---

### Task 9: 상점 패널

**Files:**
- Create: `src/ui/Shop.tsx`
- Modify: `src/ui/HubHud.tsx`
- Modify: `src/ui/ui.css` (파일 끝에 추가)
- Modify: `src/App.tsx` (`shopOpen` 상태와 `frozen` 연결)
- Modify: `src/hub/Hub.tsx` (`frozen` prop 전달)

**Interfaces:**
- Consumes: Task 1의 `BODIES`, Task 6의 `fetchWallet`/`buyAvatar`/`equipAvatar`, Task 8의 `onShopProximity`
- Produces: `<Shop />` 컴포넌트

- [ ] **Step 1: Write the panel**

Create `src/ui/Shop.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { BODIES, DEFAULT_BODY_ID } from "../game/bodies";
import type { BuyFailure, WalletView } from "../net/types";

interface Props {
  fetchWallet: () => Promise<WalletView>;
  buyAvatar: (id: string) => Promise<
    { ok: true; wallet: WalletView } | { ok: false; reason: BuyFailure }
  >;
  equipAvatar: (id: string) => Promise<{ ok: boolean }>;
  /** Called whenever the equipped body changes, so the world can re-render it. */
  onEquipped: (id: string) => void;
  onClose: () => void;
}

const REFUSAL: Record<BuyFailure, string> = {
  unknown: "판매하지 않는 아바타입니다",
  owned: "이미 가지고 있습니다",
  broke: "코인이 부족합니다",
};

export function Shop({ fetchWallet, buyAvatar, equipAvatar, onEquipped, onClose }: Props) {
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    fetchWallet()
      .then(setWallet)
      .catch(() => {
        // Keep whatever we last read — a shop that blanks out on one failed
        // poll is worse than a slightly stale balance.
      });
  }, [fetchWallet]);

  useEffect(reload, [reload]);

  // Escape is the only way out that doesn't need the cursor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onBuy = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await buyAvatar(id);
      if (res.ok) {
        setWallet(res.wallet);
        setMessage("구매했습니다");
      } else {
        setMessage(REFUSAL[res.reason]);
      }
    } catch {
      setMessage("잠시 후 다시 시도해주세요");
    } finally {
      setBusy(false);
    }
  };

  const onEquip = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await equipAvatar(id);
      if (res.ok) {
        setWallet((w) => (w ? { ...w, equipped: id } : w));
        onEquipped(id);
      } else {
        setMessage("장착할 수 없습니다");
      }
    } catch {
      setMessage("잠시 후 다시 시도해주세요");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shop-backdrop" onClick={onClose}>
      <div className="shop" onClick={(e) => e.stopPropagation()}>
        <div className="shop-head">
          <span className="shop-title">아바타 상점</span>
          <span className="shop-coins">{wallet ? `${wallet.coins} 코인` : "…"}</span>
        </div>

        <div className="shop-grid">
          {BODIES.map((b) => {
            const owned = !!wallet?.owned.includes(b.id);
            const equipped = wallet?.equipped === b.id;
            return (
              <div key={b.id} className={"shop-card" + (equipped ? " equipped" : "")}>
                <div className="shop-name">{b.name}</div>
                <div className="shop-price">
                  {b.id === DEFAULT_BODY_ID ? "기본 지급" : `${b.price} 코인`}
                </div>
                {equipped ? (
                  <span className="shop-state">장착 중</span>
                ) : owned ? (
                  <button className="shop-btn" disabled={busy} onClick={() => onEquip(b.id)}>
                    장착
                  </button>
                ) : (
                  <button
                    className="shop-btn buy"
                    disabled={busy || !wallet || wallet.coins < b.price}
                    onClick={() => onBuy(b.id)}
                  >
                    구매
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {message && <div className="shop-message">{message}</div>}

        <div className="shop-foot">
          <span className="shop-hint">옆에 서 있는 마네킹이 실제 크기입니다</span>
          <button className="shop-close" onClick={onClose}>
            닫기 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the styles**

`src/ui/ui.css` 끝에 추가한다. 기존 `.pose-menu-backdrop` / `.pose-menu` 규칙을 먼저 읽고 색·반경·그림자를 그대로 맞춘다.

```css
.shop-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(12, 14, 20, 0.55);
  pointer-events: auto;
  z-index: 40;
}

.shop {
  min-width: 460px;
  padding: 20px 22px;
  border-radius: 14px;
  background: rgba(22, 25, 33, 0.96);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
  color: #f2f3f6;
}

.shop-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 14px;
}

.shop-title { font-size: 17px; font-weight: 700; letter-spacing: 0.02em; }
.shop-coins { font-size: 15px; font-weight: 700; color: #e0a13a; }

.shop-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.shop-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid transparent;
}

.shop-card.equipped { border-color: #2f8f8a; background: rgba(47, 143, 138, 0.16); }
.shop-name { font-size: 14px; font-weight: 600; }
.shop-price { font-size: 12px; opacity: 0.72; }
.shop-state { font-size: 12px; color: #49b3ad; font-weight: 600; padding: 5px 0; }

.shop-btn {
  padding: 5px 14px;
  border: 0;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.16);
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.shop-btn.buy { background: #e0a13a; color: #1a1c22; font-weight: 700; }
.shop-btn:disabled { opacity: 0.38; cursor: default; }

.shop-message {
  margin-top: 12px;
  text-align: center;
  font-size: 13px;
  color: #f0c674;
}

.shop-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
}

.shop-hint { font-size: 12px; opacity: 0.6; }

.shop-close {
  padding: 6px 16px;
  border: 0;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.12);
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
```

- [ ] **Step 3: Mount it from `HubHud` and wire the open/close state**

`src/ui/HubHud.tsx`의 `Props`에 추가:

```ts
  shopOpen: boolean;
  onCloseShop: () => void;
  fetchWallet: () => Promise<WalletView>;
  buyAvatar: (id: string) => Promise<{ ok: true; wallet: WalletView } | { ok: false; reason: BuyFailure }>;
  equipAvatar: (id: string) => Promise<{ ok: boolean }>;
  onEquipped: (id: string) => void;
```

`<Leaderboard ... />` 뒤에 추가:

```tsx
      {shopOpen && (
        <Shop
          fetchWallet={fetchWallet}
          buyAvatar={buyAvatar}
          equipAvatar={equipAvatar}
          onEquipped={onEquipped}
          onClose={onCloseShop}
        />
      )}
```

`src/App.tsx`에서 근접·닫힘 상태를 관리한다:

```tsx
  const [nearShop, setNearShop] = useState(false);
  /**
   * Closing while still standing in the trigger would re-open on the next
   * frame. Stay dismissed until the player actually walks out of range.
   */
  const [shopDismissed, setShopDismissed] = useState(false);
  const shopOpen = nearShop && !shopDismissed && !joining;

  const onShopProximity = useCallback((inside: boolean) => {
    setNearShop(inside);
    if (!inside) setShopDismissed(false);
  }, []);
```

`<Hub ... />`에 `frozen={joining || shopOpen}` 대신 기존 `joining` prop을 유지하되, `Hub`가 `frozen`을 계산하도록 `shopOpen`을 넘긴다. `src/hub/Hub.tsx`의 `Props`에 `shopOpen: boolean`을 추가하고:

```tsx
        frozen={joining || shopOpen}
```

`onShopProximity`는 `Hub`를 통해 `HubPlayer`로 전달한다.

`HubHud`에는 `shopOpen={shopOpen}`과 `onCloseShop={() => setShopDismissed(true)}`, 그리고 Task 6의 세 함수와 `onEquipped={setEquipped}`를 넘긴다.

- [ ] **Step 4: Verify the whole flow**

Run: `npx tsc --noEmit`
Expected: no output

프리뷰에서 (오프라인이므로 100코인으로 시작한다):
1. 상점 카운터로 걸어가면 패널이 자동으로 열린다
2. 패널이 열린 동안 WASD로 움직이거나 마우스로 시점이 돌아가지 **않는다**
3. `콩이`(40) 구매 → 잔액 60
4. `막대`(60) 구매 → 잔액 0
5. `떡대`(90) 구매 버튼이 비활성이다
6. `콩이` 장착 → **패널 뒤의 내 몸이 즉시 바뀐다**
7. 닫기(또는 Esc) → 패널이 닫히고 **다시 열리지 않는다**
8. 반경 밖으로 걸어나갔다가 돌아오면 다시 열린다
9. 포털로 매치에 입장하면 장착한 체형으로 플레이된다
10. 콘솔에 에러가 없다

- [ ] **Step 5: Commit**

```bash
git add src/ui/Shop.tsx src/ui/HubHud.tsx src/ui/ui.css src/App.tsx src/hub/Hub.tsx
git commit -m "Add the avatar shop panel

Opening reuses the hub's existing frozen flag, which already stops movement,
mouselook and portal dwell in one place — so shopping can't walk you into a
match by accident. Closing sets a dismissed flag that only clears once the
player leaves the trigger, or the panel would reopen on the very next frame."
```

---

### Task 10: 문서 갱신

**Files:**
- Modify: `README.md` (알려진 한계)
- Modify: `HANDOFF.md` (전면 갱신)

- [ ] **Step 1: Update the README's known limitations**

아바타 상점 항목을 추가한다:

- 라운드 종료 시 코인 적립은 자동 검증되지 않는다 — 테스트 하네스가 라운드를 끝까지 진행시키지 못한다(리더보드와 같은 제약). `coinsFor`의 순수 로직은 `check:shop`이 커버한다.
- `wallets` 콜렉션의 실제 배포 환경 영속성 미확인 — 리더보드 콜렉션과 같은 항목.
- 아바타는 순수 외형이며 총 키·충돌 반지름·태그 거리가 전부 동일하다는 점을 명시(설계 의도이지 우연이 아님).

기존 1번 항목("3D 로비 허브 미구현")이 이미 사실과 다르다는 것이 인수인계 문서에 적혀 있다 — 이 태스크에서 함께 고친다.

- [ ] **Step 2: Rewrite `HANDOFF.md` for the next session**

다음을 담는다: 아바타 상점 완료 상태, 이 계획과 설계 문서 링크, 실제 네트워크 멀티플레이어가 **여전히** 미검증이라는 점(4세션 연속), `.env`/`VITE_AGENT8_VERSE` 부재로 오프라인 모드가 기본이라는 점, 검증 명령 목록에 `check:bodies`와 `check:shop` 추가.

- [ ] **Step 3: Run the full suite one last time**

Run: `npm run check`
Expected: 전부 통과

Run: `npx vite build`
Expected: 성공

- [ ] **Step 4: Commit**

```bash
git add README.md HANDOFF.md
git commit -m "Update docs for the avatar shop"
```

---

## Self-Review

**1. Spec coverage**

| 스펙 항목 | 태스크 |
|---|---|
| `BodyProfile`, 파생, 불변식, 카탈로그 | 1 |
| `Humanoid` 수정 지점 | 2 |
| `validateProfile` / `check-bodies` | 1 |
| 지갑 콜렉션, `owned` 문자열 저장, 기본값 | 3, 4 |
| `COINS` 적립 + `88d005c` 규율 | 5 |
| `buyAvatar`/`equipAvatar`/`getWallet` + `$lock` | 4 |
| `AVATAR_PRICES` + `check:sync` | 3 |
| `PlayerState.body`, join 시 시드, `RemotePlayers` 전달 | 6, 7 |
| 클라 훅 3종, 오프라인 인메모리 지갑 100코인 | 6 |
| 키오스크 + `atShop` 반경 3.0 + 마네킹 | 8 |
| `Shop.tsx`, `frozen`, `dismissed` | 9 |
| 에러 처리(조용한 재시도, 인라인 사유, 알 수 없는 id 폴백) | 1, 9 |
| 테스트 전체 | 1, 3, 4 |
| 문서 | 10 |

**2. Placeholder scan** — Task 8 Step 2에 `NameTag` 시그니처에 따라 두 갈래 중 하나를 고르라는 조건부 지시가 남아 있다. 이건 플랜 실패가 아니라 실제 분기이며 판단 기준과 확인할 파일(`src/game/NameTag.tsx`)을 명시했으므로 그대로 둔다. 그 외 TBD/TODO 없음.

**3. Type consistency**

- `WalletState`(서버) ↔ `WalletView`(클라)는 필드가 동일한 별개 타입이다. 서버는 `src/`에서 import할 수 없으므로 의도된 중복이고, 형태 드리프트는 `buyAvatar`의 반환 타입을 통해 `tsc`가 잡는다.
- `PurchaseFailure`(서버) ↔ `BuyFailure`(클라) — 같은 이유의 쌍. 값 3개(`unknown`/`owned`/`broke`)가 `REFUSAL` 맵의 키와 정확히 일치한다.
- `profileFor` / `derive` / `validateProfile` / `maxHalfWidth` — Task 1에서 정의, 2·8에서 사용, 이름 일치 확인.
- `applyPurchase` / `applyEquip` / `coinsFor` / `parseOwned` / `serializeOwned` — Task 3 정의, 4·5 사용, 이름 일치 확인.
- `atShop` / `SHOP` — Task 8 정의 및 사용.
- `onShopProximity` — Task 8에서 `HubPlayer` prop으로 정의, Task 9에서 `App.tsx`가 구현.

# 사운드 이펙트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 술래 캐치, 페인트 브러시, 라운드 전환(시작/결과)에 코드 합성 효과음을 붙이고,
HUD에 음소거 토글을 추가한다.

**Architecture:** `src/audio/sound.ts` 한 모듈이 Web Audio API로 모든 효과음을 그때그때
합성한다(외부 파일 없음). 기존 컴포넌트(`App.tsx`, `LocalPlayer.tsx`, `Screens.tsx`)에
훅 포인트 몇 줄을 추가해 이 모듈의 `play*` 함수를 호출하고, 새 `MuteToggle` 컴포넌트를
`App.tsx`에 상시 마운트한다.

**Tech Stack:** TypeScript, React, 브라우저 내장 `Web Audio API`(`AudioContext`,
`OscillatorNode`, `AudioBufferSourceNode`, `BiquadFilterNode`) — 신규 의존성 없음.

## Global Constraints

- 외부 음향 파일(라이선스 필요한 것이든 CC0든) 전혀 사용하지 않는다 — 전부
  `src/audio/sound.ts` 안에서 오실레이터/노이즈로 합성한다.
- 점프/착지 사운드는 범위 밖 — 넣지 않는다.
- 캐치/브러시/라운드 전환 세 이벤트 모두 항상 풀볼륨(음소거 여부만 적용) — 거리 기반
  음량 감쇠나 3D 공간음향(`PannerNode`/`AudioListener`)은 만들지 않는다.
- `AudioContext`는 유저 제스처(닉네임 입력 후 "게임 참가" 버튼 클릭) 안에서만
  생성/resume한다 — 브라우저 autoplay 정책 때문에 그 전에 만들면 소용없다.
- `AudioContext`가 없거나 아직 `unlockAudio()`가 호출 안 된 상태에서 `play*`가 호출돼도
  절대 throw하지 않는다 — 사운드 실패가 게임 진행에 영향을 주면 안 된다.
- 서버 코드(`server/*`)는 이번 계획에서 전혀 수정하지 않는다.
- `npm run check`가 매 태스크 종료 시점에 계속 통과해야 한다.
- 관련 설계 문서: [`docs/superpowers/specs/2026-07-24-sound-effects-design.md`](../specs/2026-07-24-sound-effects-design.md)

---

### Task 1: 오디오 합성 모듈 + 순수 로직 검증 스크립트

**Files:**
- Create: `src/audio/sound.ts`
- Create: `scripts/check-audio.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `src/audio/sound.ts`가 다음을 export — Task 2/3에서 그대로 import해서 쓴다.
  ```ts
  export function unlockAudio(): void;
  export function isMuted(): boolean;
  export function toggleMuted(): boolean; // 토글 후의 새 상태(true=음소거)를 반환
  export function shouldPlayBrushTick(now: number, lastPlayedAt: number, throttleMs?: number): boolean;
  export function playCatch(): void;
  export function playBrushTick(): void;
  export function playRoundStart(): void;
  export function playResults(won: boolean): void;
  ```

- [ ] **Step 1: `src/audio/sound.ts` 작성**

```ts
/**
 * All effects here are synthesized at play time with the Web Audio API, not
 * loaded from files — this project keeps every asset procedurally generated
 * to avoid the licensing questions external audio/3D assets would raise (see
 * the copyright note at the top of README.md).
 */

let ctx: AudioContext | null = null;
let lastBrushTickAt = 0;

const MUTE_KEY = "pc-muted";
const BRUSH_TICK_THROTTLE_MS = 100;

/** Call from inside a user gesture (a click handler) — autoplay policy requires it. */
export function unlockAudio(): void {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return;
  }
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Flips the stored mute flag and returns the new state (true = now muted). */
export function toggleMuted(): boolean {
  const next = !isMuted();
  try {
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    // Storage unavailable (private mode, etc.) — the in-memory toggle still
    // works for this page load, it just won't persist.
  }
  return next;
}

/** Pure so the throttle timing can be tested without a real clock or AudioContext. */
export function shouldPlayBrushTick(now: number, lastPlayedAt: number, throttleMs = BRUSH_TICK_THROTTLE_MS): boolean {
  return now - lastPlayedAt >= throttleMs;
}

function tone(freq: number, duration: number, startGain: number, type: OscillatorType = "sine", delay = 0): void {
  if (!ctx || isMuted()) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(startGain, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration);
}

function noiseBurst(duration: number, gainValue: number, filterFreq: number): void {
  if (!ctx || isMuted()) return;
  const t0 = ctx.currentTime;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(filterFreq, t0);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainValue, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(t0);
  source.stop(t0 + duration);
}

/** Short, bright two-note stinger — a hider or seeker was just caught. */
export function playCatch(): void {
  tone(440, 0.2, 0.3, "square");
  tone(330, 0.18, 0.2, "square", 0.05);
}

/** Soft filtered noise tick, throttled internally so a fast drag doesn't spam it. */
export function playBrushTick(): void {
  const now = performance.now();
  if (!shouldPlayBrushTick(now, lastBrushTickAt)) return;
  lastBrushTickAt = now;
  noiseBurst(0.03, 0.08, 1200);
}

/** Rising two-note cue — the hiding phase just started. */
export function playRoundStart(): void {
  tone(392, 0.15, 0.25, "sine");
  tone(523.25, 0.25, 0.25, "sine", 0.12);
}

/** Bright major arpeggio on a win, a single low tone on a loss. */
export function playResults(won: boolean): void {
  if (won) {
    tone(523.25, 0.18, 0.25, "triangle");
    tone(659.25, 0.18, 0.25, "triangle", 0.1);
    tone(783.99, 0.3, 0.25, "triangle", 0.2);
  } else {
    tone(220, 0.5, 0.25, "sawtooth");
  }
}
```

- [ ] **Step 2: `scripts/check-audio.ts` 작성**

```ts
/**
 * Sound module's testable logic — the actual Web Audio synthesis can't run
 * headless (no AudioContext in Node), so this covers the throttle math and
 * mute-state persistence instead.
 *
 * Run: npm run check:audio
 */

// A minimal in-memory localStorage so isMuted()/toggleMuted() have something
// real to read and write — there's no browser storage under Node.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}
(globalThis as any).localStorage = new MemoryStorage();

import { isMuted, shouldPlayBrushTick, toggleMuted } from "../src/audio/sound";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

console.log("\nmute state");
{
  check("starts unmuted by default", isMuted() === false);
  const afterFirstToggle = toggleMuted();
  check("toggling once mutes", afterFirstToggle === true && isMuted() === true);
  const afterSecondToggle = toggleMuted();
  check("toggling again unmutes", afterSecondToggle === false && isMuted() === false);
}

console.log("\nbrush tick throttle");
{
  check("first tick always plays (lastPlayedAt far in the past)", shouldPlayBrushTick(1000, 0));
  check("a tick 50ms after the last one is suppressed", !shouldPlayBrushTick(1050, 1000, 100));
  check("a tick exactly at the throttle boundary plays", shouldPlayBrushTick(1100, 1000, 100));
  check("a tick well after the throttle window plays", shouldPlayBrushTick(5000, 1000, 100));
}

if (failures === 0) {
  console.log("\n✅ audio logic is consistent\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
```

- [ ] **Step 3: `package.json`에 `check:audio` 스크립트 추가**

`package.json`의 `scripts` 블록:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "server:test": "cd server && npx -y @agent8/gameserver-node test",
    "check:sync": "tsx scripts/check-sync.ts",
    "check:movement": "tsx scripts/check-movement.ts",
    "check:hub": "tsx scripts/check-hub.ts",
    "check": "tsc --noEmit && npm run check:sync && npm run check:movement && npm run check:hub && npm run server:test",
    "deploy": "npx -y @agent8/deploy"
  },
```

를 다음으로 교체(`check:audio` 스크립트 추가 + `check` 체인에 편입):

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "server:test": "cd server && npx -y @agent8/gameserver-node test",
    "check:sync": "tsx scripts/check-sync.ts",
    "check:movement": "tsx scripts/check-movement.ts",
    "check:hub": "tsx scripts/check-hub.ts",
    "check:audio": "tsx scripts/check-audio.ts",
    "check": "tsc --noEmit && npm run check:sync && npm run check:movement && npm run check:hub && npm run check:audio && npm run server:test",
    "deploy": "npx -y @agent8/deploy"
  },
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run check:audio`
Expected: "mute state"와 "brush tick throttle" 섹션 전부 `✓`, 마지막에
`✅ audio logic is consistent`, exit code 0.

- [ ] **Step 5: 전체 검증 스위트 확인**

Run: `npm run check`
Expected: 타입체크·check:sync·check:movement·check:hub·**check:audio**·server:test 전부
통과, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/audio/sound.ts scripts/check-audio.ts package.json
git commit -m "Add procedurally-synthesized sound module with mute/throttle logic tests"
```

---

### Task 2: 캐치 · 라운드 전환 사운드 연결

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/ui/Screens.tsx`

**Interfaces:**
- Consumes: Task 1의 `unlockAudio`, `playCatch`, `playRoundStart`, `playResults`.
- Produces: 없음(다음 태스크가 참고할 새 export 없음).

- [ ] **Step 1: `src/ui/Screens.tsx`에서 첫 유저 제스처에 `unlockAudio()` 연결**

`src/ui/Screens.tsx` 상단 import 목록:

```ts
import { useState } from "react";
import type { PlayerState, RoomInfo } from "../net/types";
```

를 다음으로 교체:

```ts
import { useState } from "react";
import type { PlayerState, RoomInfo } from "../net/types";
import { unlockAudio } from "../audio/sound";
```

그리고 `NickScreen`의 `submit` 함수(18~29번째 줄 근처):

```ts
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onJoin(nick.trim() || "카멜레온");
  };
```

를 다음으로 교체:

```ts
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio();
    onJoin(nick.trim() || "카멜레온");
  };
```

- [ ] **Step 2: `src/App.tsx`에 캐치/라운드 전환 사운드 연결**

`src/App.tsx` 상단 import 목록에 한 줄 추가(예: `import "./ui/ui.css";` 바로 위):

```ts
import { playCatch, playResults, playRoundStart } from "./audio/sound";
```

`App` 함수 안, `const portalRef = useRef<PortalProgress>({ portal: null, progress: 0 });`
바로 뒤에 사운드 상태 추적용 ref 두 개 추가:

```ts
  /** Sound: last phase seen, so a transition sound fires exactly once. */
  const prevPhase = useRef<string | null>(null);
  /** Sound: last known caught flag per account, so a catch sound fires once per catch. */
  const prevCaught = useRef<Map<string, boolean>>(new Map());
```

`// A new round wipes everyone's paint and resets the pose.` 로 시작하는 기존
`useEffect` 바로 뒤에 새 `useEffect` 두 개 추가:

```ts
  // Round-transition stingers. Skipped in the hub, which has no rounds.
  useEffect(() => {
    if (inHub) return;
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (prev === phase) return;

    if (phase === "hiding") {
      playRoundStart();
    } else if (phase === "results") {
      const won = isSeeker
        ? (room?.lastResults ?? []).some((r: any) => r.account === account && r.gained > 0)
        : !me?.caught;
      playResults(won);
    }
  }, [phase, inHub, isSeeker, room?.lastResults, account, me?.caught]);

  // Catch stinger: your own catch, and everyone else's.
  useEffect(() => {
    if (inHub) return;
    if (me?.caught && !prevCaught.current.get(account)) playCatch();
    if (typeof me?.caught === "boolean") prevCaught.current.set(account, me.caught);

    for (const p of players) {
      if (p.account === account) continue;
      if (p.caught && !prevCaught.current.get(p.account)) playCatch();
      prevCaught.current.set(p.account, !!p.caught);
    }
  }, [me?.caught, players, inHub, account]);
```

- [ ] **Step 3: 타입체크 확인**

Run: `npx tsc --noEmit`
Expected: 클린(에러 없음).

- [ ] **Step 4: 브라우저에서 수동 확인**

`npm run dev`로 다음을 직접 들어본다(자동 테스트 불가 — Web Audio는 헤드리스로 검증
못 함):
- 닉네임 입력 후 "게임 참가" 클릭 시 이후 소리가 실제로 나는지(언락 확인용으로,
  이 시점 자체는 무음이어도 됨 — 다음 항목에서 확인)
- 매치의 숨는 시간이 시작될 때 상승음이 나는지
- 잡혔을 때(숨는 쪽) 또는 누군가를 잡았을 때(술래) 캐치음이 나는지
- 라운드 결과 화면 진입 시 승/패에 맞는 소리가 나는지

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/ui/Screens.tsx
git commit -m "Play catch and round-transition sounds at their trigger points"
```

---

### Task 3: 브러시 사운드 + 음소거 토글 UI

**Files:**
- Modify: `src/game/LocalPlayer.tsx`
- Create: `src/ui/MuteToggle.tsx`
- Modify: `src/App.tsx`
- Modify: `src/ui/ui.css`

**Interfaces:**
- Consumes: Task 1의 `playBrushTick`, `isMuted`, `toggleMuted`.
- Produces: `src/ui/MuteToggle.tsx`가 `export function MuteToggle(): JSX.Element`를 제공
  — `App.tsx`가 마운트한다.

- [ ] **Step 1: `src/game/LocalPlayer.tsx`에 브러시 틱 연결**

`src/game/LocalPlayer.tsx` 상단 import 목록에 한 줄 추가(예: `import { surfaceFor, type PaintDab } from "./paint";` 바로 아래):

```ts
import { playBrushTick } from "../audio/sound";
```

기존 `handleDab`(111~120번째 줄 근처):

```ts
  const handleDab = useCallback(
    (dab: PaintDab, join: boolean) => {
      const surface = surfaceFor(me.account);
      if (join && lastLocalUV.current) surface.stroke(lastLocalUV.current, dab);
      else surface.dab(dab);
      lastLocalUV.current = { u: dab.u, v: dab.v };
      onDab(dab, join);
    },
    [me.account, onDab]
  );
```

를 다음으로 교체(`playBrushTick()` 한 줄 추가 — 스로틀은 함수 내부에서 처리하므로
매 dab마다 그냥 호출하면 됨):

```ts
  const handleDab = useCallback(
    (dab: PaintDab, join: boolean) => {
      const surface = surfaceFor(me.account);
      if (join && lastLocalUV.current) surface.stroke(lastLocalUV.current, dab);
      else surface.dab(dab);
      lastLocalUV.current = { u: dab.u, v: dab.v };
      playBrushTick();
      onDab(dab, join);
    },
    [me.account, onDab]
  );
```

- [ ] **Step 2: `src/ui/MuteToggle.tsx` 작성**

```tsx
import { useState } from "react";
import { isMuted, toggleMuted } from "../audio/sound";

/** Tiny persistent mute switch, visible in both the hub and a match. */
export function MuteToggle() {
  const [muted, setMuted] = useState(() => isMuted());

  return (
    <button
      className="mute-toggle"
      onClick={() => setMuted(toggleMuted())}
      aria-label={muted ? "소리 켜기" : "소리 끄기"}
      title={muted ? "소리 켜기" : "소리 끄기"}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
```

- [ ] **Step 3: `src/ui/ui.css`에 스타일 추가**

파일 끝에 추가:

```css
.mute-toggle {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 40;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
  font-size: 18px;
  cursor: pointer;
  backdrop-filter: blur(8px);
}

.mute-toggle:hover {
  border-color: var(--accent);
}
```

- [ ] **Step 4: `src/App.tsx`에 `MuteToggle` 마운트**

import 목록에 추가(`import { PaintTools } from "./ui/PaintTools";` 근처):

```ts
import { MuteToggle } from "./ui/MuteToggle";
```

`App` 함수의 반환 JSX에서, `</Canvas>` 바로 뒤(허브/매치 조건부 블록보다 앞, 항상
렌더되도록)에 추가:

```tsx
      </Canvas>

      <MuteToggle />

      {inHub ? (
```

- [ ] **Step 5: 타입체크 확인**

Run: `npx tsc --noEmit`
Expected: 클린.

- [ ] **Step 6: 전체 검증 스위트 확인**

Run: `npm run check`
Expected: 전부 통과.

- [ ] **Step 7: 프로덕션 빌드 확인**

Run: `npx vite build`
Expected: 성공.

- [ ] **Step 8: 브라우저에서 수동 확인**

`npm run dev`로:
- 페인트 모드에서 몸을 드래그해 칠할 때 "사각" 소리가 계속 나지 않고 적당히
  끊겨서 나는지(스로틀 확인)
- 우하단 스피커 아이콘 클릭 시 음소거되고, 새로고침해도 음소거 상태가 유지되는지
  (localStorage 영속 확인)

- [ ] **Step 9: Commit**

```bash
git add src/game/LocalPlayer.tsx src/ui/MuteToggle.tsx src/App.tsx src/ui/ui.css
git commit -m "Add brush-tick sound and a persistent mute toggle"
```

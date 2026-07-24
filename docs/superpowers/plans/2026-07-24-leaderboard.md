# 로비 리더보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로비에 누적 총점수 기준 상위 10명 리더보드를 추가하고, 라운드가 끝날 때마다
계정별 영구 기록을 쌓는다.

**Architecture:** 서버가 `$global` 콜렉션(방과 무관한 영구 저장소, SDK 기본 제공)에
계정별 `{account, nick, total}`을 쌓는다. `endRound`가 그 라운드 결과를 확정하는
시점에 같이 갱신한다. 새 remote function `getLeaderboard()`가 상위 10명 + 호출자
본인의 순위(10위 밖일 때만)를 반환한다. 클라이언트는 허브에서만 이걸 주기적으로
불러와 표시한다.

**Tech Stack:** TypeScript, `@agent8/gameserver-node`의 전역 콜렉션 API
(`$global.getCollectionItems`/`addCollectionItem`/`updateCollectionItem`/
`countCollectionItems` — 필터·정렬·limit 지원, 신규 의존성 없음), React.

## Global Constraints

- "아바타 구매"는 완전히 별개 작업 — 이번 계획 범위 밖.
- 순위는 누적 총점수만 — 승률/포착 횟수 등 다른 지표 없음.
- 리더보드는 허브에서만 보임 — 매치 화면에는 안 넣는다.
- 상위 10명 고정 + 본인이 10위 밖일 때만 별도로 본인 순위 표시.
- 갱신은 라운드 종료 시점(서버의 `endRound`)에만 — 실시간 스트리밍 없음.
- 오프라인 모드는 로컬 `scores`로 그 자리에서 계산 — 실제 영속 저장소를 만들지
  않는다(오프라인은 리허설 rig).
- **테스트 하네스 제약(기존 계획들에서 이미 확인된 사실)**: 이 프로�트의 서버
  테스트 하네스는 `Server` 클래스의 공개 remote 메서드만 블랙박스로 호출 가능하고,
  `$roomTick`/`startRound`/`endRound`는 직접 트리거할 방법이 없다. 그래서 라운드를
  실제로 완주시켜 리더보드가 갱신되는 전체 플로우는 자동 테스트로 못 만든다.
  **리더보드에 쓰기 가능한 진단용(diagnostic) remote 메서드를 새로 만들지 않는다** —
  기존 `__rooms()`(읽기 전용)와 달리, 점수를 임의로 주입하는 쓰기 메서드는 어떤
  클라이언트든 자기 점수를 조작할 수 있는 실제 보안 구멍이 된다. 대신 (a) 순위
  번호를 매기는 순수 로직만 따로 뽑아 헤드리스로 테스트하고, (b) `getLeaderboard()`
  자체는 빈 상태에서의 동작만 자동 테스트하고, (c) 라운드 종료 → 리더보드 갱신 →
  화면 표시로 이어지는 전체 흐름은 브라우저에서 실제로 라운드를 몇 번 플레이해
  수동으로 확인한다(Task 1 마지막 스텝에 명시).
- `npm run check`가 매 태스크 종료 시점에 계속 통과해야 한다.
- 관련 설계 문서: [`docs/superpowers/specs/2026-07-24-leaderboard-design.md`](../specs/2026-07-24-leaderboard-design.md)

---

### Task 1: 서버 — 콜렉션 갱신 + `getLeaderboard`

**Files:**
- Modify: `server/src/rules.ts`
- Modify: `server/src/server.ts`
- Modify: `server/test/server.test.ts`

**Interfaces:**
- Produces: `server/src/rules.ts`가 `export const LEADERBOARD_COLLECTION`,
  `export interface LeaderboardEntry { account: string; nick: string; total: number }`,
  `export interface RankedLeaderboardEntry extends LeaderboardEntry { rank: number }`,
  `export function attachRanks(sorted: LeaderboardEntry[]): RankedLeaderboardEntry[]`을
  export — Task 2에서 클라이언트 타입(`src/net/types.ts`)이 같은 shape을 그대로
  복사해서 쓴다(서버는 isolated-vm이라 클라이언트가 서버 타입을 import 못 함, 기존
  프로젝트 관례와 동일).
- Produces: `Server` 클래스에 새 remote function `getLeaderboard(): Promise<{ top: RankedLeaderboardEntry[]; me: RankedLeaderboardEntry | null }>` — Task 2가 `server.remoteFunction("getLeaderboard", [])`로 호출.

- [ ] **Step 1: `server/src/rules.ts`에 콜렉션 상수 + 순수 랭킹 헬퍼 추가**

`server/src/rules.ts`의 `export const MAX_DT_MS = 1000;` 바로 뒤, `function rng`
앞에 추가:

```ts
/** Collection name for the cross-room, persistent leaderboard. */
export const LEADERBOARD_COLLECTION = "leaderboard";

export interface LeaderboardEntry {
  account: string;
  nick: string;
  total: number;
}
export interface RankedLeaderboardEntry extends LeaderboardEntry {
  rank: number;
}

/**
 * Attach 1-based ranks to an already sorted-desc, already-limited list. Pure
 * and side-effect-free so the numbering can be unit tested without a live
 * collection — it does NOT sort; callers must pass pre-sorted input.
 */
export function attachRanks(sorted: LeaderboardEntry[]): RankedLeaderboardEntry[] {
  return sorted.map((e, i) => ({ ...e, rank: i + 1 }));
}
```

- [ ] **Step 2: `server/src/server.ts`의 import 목록 확장**

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
  MOVE_SPEED_CAP,
  SPEED_GRACE,
  MIN_DT_MS,
  MAX_DT_MS,
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
  MAX_DT_MS,
  LEADERBOARD_COLLECTION,
  attachRanks,
  randomSpawn,
  type RankedLeaderboardEntry,
} from "./rules";
```

- [ ] **Step 3: `upsertLeaderboard` 헬퍼 + `endRound` 연결**

`server/src/server.ts`의 기존 `endRound` 함수 전체(현재 106~142번째 줄 근처):

```ts
async function endRound(roomId: string, users: Array<Record<string, any>>, state: Record<string, any>) {
  const now = Date.now();
  const scores: Record<string, number> = { ...(state.scores || {}) };
  const results: Array<Record<string, any>> = [];
  const seekingStartedAt = num(state.phaseEndsAt) - PHASE_SECONDS.seeking * 1000;

  let catches = 0;

  for (const u of users) {
    if (u.role === "seeker") continue;

    let gained: number;
    if (u.caught) {
      catches++;
      const aliveMs = Math.max(0, num(u.caughtAt, now) - seekingStartedAt);
      gained = Math.round((aliveMs / 1000) * SCORE.hiderPerSecondAlive);
    } else {
      gained = SCORE.hiderSurvived;
    }

    scores[u.account] = (scores[u.account] || 0) + gained;
    results.push({ account: u.account, nick: u.nick, caught: !!u.caught, gained });
  }

  if (state.seeker) {
    const gained = catches * SCORE.seekerPerCatch;
    scores[state.seeker] = (scores[state.seeker] || 0) + gained;
    results.push({ account: state.seeker, nick: "", caught: false, gained, seeker: true });
  }

  await $global.updateRoomState(roomId, {
    phase: "results" as Phase,
    phaseEndsAt: now + PHASE_SECONDS.results * 1000,
    scores,
    lastResults: results,
  });
}
```

를 다음으로 교체(끝에 새 `upsertLeaderboard` 헬퍼 함수 추가 + `endRound` 안에서
호출):

```ts
async function endRound(roomId: string, users: Array<Record<string, any>>, state: Record<string, any>) {
  const now = Date.now();
  const scores: Record<string, number> = { ...(state.scores || {}) };
  const results: Array<Record<string, any>> = [];
  const seekingStartedAt = num(state.phaseEndsAt) - PHASE_SECONDS.seeking * 1000;

  let catches = 0;

  for (const u of users) {
    if (u.role === "seeker") continue;

    let gained: number;
    if (u.caught) {
      catches++;
      const aliveMs = Math.max(0, num(u.caughtAt, now) - seekingStartedAt);
      gained = Math.round((aliveMs / 1000) * SCORE.hiderPerSecondAlive);
    } else {
      gained = SCORE.hiderSurvived;
    }

    scores[u.account] = (scores[u.account] || 0) + gained;
    results.push({ account: u.account, nick: u.nick, caught: !!u.caught, gained });
  }

  if (state.seeker) {
    const gained = catches * SCORE.seekerPerCatch;
    scores[state.seeker] = (scores[state.seeker] || 0) + gained;
    results.push({ account: state.seeker, nick: "", caught: false, gained, seeker: true });
  }

  // The seeker's own result entry carries an empty nick (the results overlay
  // looks it up from the room's player list instead), but the leaderboard
  // collection outlives the room, so every entry needs a real one.
  for (const r of results) {
    const nick = r.seeker ? users.find((u) => u.account === r.account)?.nick ?? "" : r.nick;
    await upsertLeaderboard(r.account, nick, r.gained);
  }

  await $global.updateRoomState(roomId, {
    phase: "results" as Phase,
    phaseEndsAt: now + PHASE_SECONDS.results * 1000,
    scores,
    lastResults: results,
  });
}

/** Add this round's points onto the account's permanent leaderboard total. */
async function upsertLeaderboard(account: string, nick: string, gained: number) {
  const existing = (await $global.getCollectionItems(LEADERBOARD_COLLECTION, {
    filters: [{ field: "account", operator: "==", value: account }],
  })) as any[];

  if (existing.length) {
    const item = existing[0];
    await $global.updateCollectionItem(LEADERBOARD_COLLECTION, {
      __id: item.__id,
      total: num(item.total) + gained,
      nick: nick || item.nick,
    });
  } else {
    await $global.addCollectionItem(LEADERBOARD_COLLECTION, { account, nick: nick || "익명", total: gained });
  }
}
```

- [ ] **Step 4: `getLeaderboard` remote function 추가**

`server/src/server.ts`의 `getMyState()` 메서드(현재 259~262번째 줄 근처):

```ts
  /** Own room-user state. Clients get this via useRoomMyState(); handy for tests. */
  async getMyState(): Promise<Record<string, any>> {
    return await $room.getMyState();
  }
```

바로 뒤에 추가:

```ts

  /** Top 10 by all-time total, plus the caller's own rank if they're outside it. */
  async getLeaderboard(): Promise<{ top: RankedLeaderboardEntry[]; me: RankedLeaderboardEntry | null }> {
    const topRaw = (await $global.getCollectionItems(LEADERBOARD_COLLECTION, {
      orderBy: [{ field: "total", direction: "desc" }],
      limit: 10,
    })) as any[];
    const top = attachRanks(
      topRaw.map((item) => ({ account: item.account, nick: item.nick || "익명", total: num(item.total) }))
    );

    if (top.some((t) => t.account === $sender.account)) {
      return { top, me: null };
    }

    const mineRaw = (await $global.getCollectionItems(LEADERBOARD_COLLECTION, {
      filters: [{ field: "account", operator: "==", value: $sender.account }],
    })) as any[];
    if (!mineRaw.length) return { top, me: null };

    const mine = mineRaw[0];
    const higher = await $global.countCollectionItems(LEADERBOARD_COLLECTION, {
      filters: [{ field: "total", operator: ">", value: num(mine.total) }],
    });

    return {
      top,
      me: { account: mine.account, nick: mine.nick || "익명", total: num(mine.total), rank: higher + 1 },
    };
  }
```

- [ ] **Step 5: 순수 로직 검증 스크립트 작성**

`scripts/check-leaderboard.ts` 신규 생성:

```ts
/**
 * Leaderboard's testable logic — attachRanks() is the only piece that can be
 * exercised without a live $global collection (see the plan's note on why no
 * write-capable diagnostic method was added for this).
 *
 * Run: npm run check:leaderboard
 */

import { attachRanks, type LeaderboardEntry } from "../server/src/rules";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

console.log("\nattachRanks");
{
  check("empty list stays empty", attachRanks([]).length === 0);

  const three: LeaderboardEntry[] = [
    { account: "a", nick: "A", total: 300 },
    { account: "b", nick: "B", total: 200 },
    { account: "c", nick: "C", total: 100 },
  ];
  const ranked = attachRanks(three);
  check("ranks are 1-based and in input order", ranked.map((r) => r.rank).join(",") === "1,2,3");
  check("every field is preserved alongside the new rank", ranked[0].account === "a" && ranked[0].total === 300);

  // attachRanks must NOT re-sort — the caller (getLeaderboard) is responsible
  // for handing it pre-sorted data. Feed it deliberately out-of-order input
  // and confirm the ranks land in that same (wrong-looking) order.
  const outOfOrder: LeaderboardEntry[] = [
    { account: "low", nick: "L", total: 10 },
    { account: "high", nick: "H", total: 999 },
  ];
  const rankedOutOfOrder = attachRanks(outOfOrder);
  check(
    "does not re-sort — rank 1 goes to whichever item is first, regardless of total",
    rankedOutOfOrder[0].account === "low" && rankedOutOfOrder[0].rank === 1
  );
}

if (failures === 0) {
  console.log("\n✅ leaderboard logic is consistent\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
```

- [ ] **Step 6: `package.json`에 `check:leaderboard` 스크립트 추가**

`package.json`의 `scripts` 블록에서 `"check:audio": "tsx scripts/check-audio.ts",` 줄
바로 뒤에 추가하고, `check` 체인에도 편입:

```json
    "check:audio": "tsx scripts/check-audio.ts",
    "check:leaderboard": "tsx scripts/check-leaderboard.ts",
    "check": "tsc --noEmit && npm run check:sync && npm run check:movement && npm run check:hub && npm run check:audio && npm run check:leaderboard && npm run server:test",
```

- [ ] **Step 7: 서버 통합 테스트 추가(빈 상태만)**

`server/test/server.test.ts` 파일 끝에 새 `describe` 블록 추가:

```ts

describe("leaderboard", () => {
  test("getLeaderboard on an account with no history returns no ranking", async (server) => {
    server.connect({ account: "user-leaderboard-fresh" });
    await server.joinGame("fresh");

    const result = await server.getLeaderboard();
    expect(Array.isArray(result.top)).toBe(true);
    expect(result.me).toBe(null);
  });
});
```

- [ ] **Step 8: 실행해서 통과 확인**

Run: `npm run check:leaderboard`
Expected: "attachRanks" 섹션 전부 `✓`, `✅ leaderboard logic is consistent`, exit 0.

- [ ] **Step 9: 전체 검증 스위트 확인**

Run: `npm run check`
Expected: 타입체크·check:sync·check:movement·check:hub·check:audio·**check:leaderboard**·
server:test 전부 통과.

- [ ] **Step 10: Commit**

```bash
git add server/src/rules.ts server/src/server.ts server/test/server.test.ts scripts/check-leaderboard.ts package.json
git commit -m "Add a persistent leaderboard collection, updated on every round end"
```

---

### Task 2: 클라이언트 — `fetchLeaderboard` 연결

**Files:**
- Modify: `src/net/types.ts`
- Modify: `src/net/useGame.ts`
- Modify: `src/net/offline.ts`

**Interfaces:**
- Consumes: Task 1의 서버 `getLeaderboard()` remote function.
- Produces: `useGame()`(온라인·오프라인 공통)이 `fetchLeaderboard: () => Promise<LeaderboardResult>`를 반환 — Task 3의 `Leaderboard.tsx`가 이걸 호출.

- [ ] **Step 1: `src/net/types.ts`에 타입 추가**

파일 끝에 추가:

```ts

export interface RankedLeaderboardEntry {
  account: string;
  nick: string;
  total: number;
  rank: number;
}

export interface LeaderboardResult {
  top: RankedLeaderboardEntry[];
  me: RankedLeaderboardEntry | null;
}
```

- [ ] **Step 2: `src/net/useGame.ts`에 `fetchLeaderboard` 추가**

`src/net/useGame.ts` 상단 import 목록:

```ts
import type { PlayerState, RoomInfo, WireDab } from "./types";
```

를 다음으로 교체:

```ts
import type { LeaderboardResult, PlayerState, RoomInfo, WireDab } from "./types";
```

그리고 `export type { PlayerState, RoomInfo, WireDab } from "./types";` 줄을:

```ts
export type { LeaderboardResult, PlayerState, RoomInfo, RankedLeaderboardEntry, WireDab } from "./types";
```

로 교체.

기존 `requestTag` 콜백(현재 160~163번째 줄 근처):

```ts
  const requestTag = useCallback(
    (target: string) => server.remoteFunction("requestTag", [target]),
    [server]
  );
```

바로 뒤에 추가:

```ts

  const fetchLeaderboard = useCallback(
    () => server.remoteFunction("getLeaderboard", []) as Promise<LeaderboardResult>,
    [server]
  );
```

반환 객체(현재 165~183번째 줄 근처)의 `requestTag,` 줄 바로 뒤에 `fetchLeaderboard,`
추가:

```ts
    requestTag,
    fetchLeaderboard,
  };
```

- [ ] **Step 3: `src/net/offline.ts`에 오프라인 버전 추가**

`src/net/offline.ts` 상단 import 목록:

```ts
import type { PlayerState, RoomInfo, WireDab } from "./types";
```

를 다음으로 교체:

```ts
import type { LeaderboardResult, PlayerState, RoomInfo, WireDab } from "./types";
```

기존 반환 객체(현재 373~432번째 줄 근처)의 `requestTag` 다음:

```ts
    requestTag: async (target: string) => {
      if (phase !== "seeking" || seeker !== ME) return { ok: false };
      const bot = bots.current.find((b) => b.account === target);
      if (!bot || bot.caught) return { ok: false };
      bot.caught = true;
      bot.caughtAt = Date.now();
      return { ok: true };
    },
  };
}
```

를 다음으로 교체(`fetchLeaderboard` 추가 — 실제 영속 저장 없이 현재 세션의
`scores`로 그 자리에서 계산):

```ts
    requestTag: async (target: string) => {
      if (phase !== "seeking" || seeker !== ME) return { ok: false };
      const bot = bots.current.find((b) => b.account === target);
      if (!bot || bot.caught) return { ok: false };
      bot.caught = true;
      bot.caughtAt = Date.now();
      return { ok: true };
    },
    fetchLeaderboard: async (): Promise<LeaderboardResult> => {
      const nickOf = (acc: string) =>
        acc === ME ? nick : BOTS.find((b) => b.account === acc)?.nick ?? "익명";
      const ranked = Object.entries(scores)
        .map(([account, total]) => ({ account, nick: nickOf(account), total }))
        .sort((a, b) => b.total - a.total)
        .map((e, i) => ({ ...e, rank: i + 1 }));

      const top = ranked.slice(0, 10);
      if (top.some((e) => e.account === ME)) return { top, me: null };
      return { top, me: ranked.find((e) => e.account === ME) ?? null };
    },
  };
}
```

- [ ] **Step 4: 타입체크 확인**

Run: `npx tsc --noEmit`
Expected: 클린.

- [ ] **Step 5: 전체 검증 스위트 확인**

Run: `npm run check`
Expected: 전부 통과.

- [ ] **Step 6: Commit**

```bash
git add src/net/types.ts src/net/useGame.ts src/net/offline.ts
git commit -m "Wire fetchLeaderboard into both the online and offline game hooks"
```

---

### Task 3: UI — 리더보드 패널

**Files:**
- Create: `src/ui/Leaderboard.tsx`
- Modify: `src/ui/HubHud.tsx`
- Modify: `src/App.tsx`
- Modify: `src/ui/ui.css`

**Interfaces:**
- Consumes: Task 2의 `fetchLeaderboard`, `LeaderboardResult`, `RankedLeaderboardEntry`.
- Produces: `src/ui/Leaderboard.tsx`가 `export function Leaderboard(props: { account: string; fetchLeaderboard: () => Promise<LeaderboardResult> }): JSX.Element`를 제공 — `HubHud.tsx`가 마운트한다.

- [ ] **Step 1: `src/ui/Leaderboard.tsx` 작성**

```tsx
import { useEffect, useState } from "react";
import type { LeaderboardResult, RankedLeaderboardEntry } from "../net/types";

interface Props {
  account: string;
  fetchLeaderboard: () => Promise<LeaderboardResult>;
}

const REFRESH_MS = 10_000;

function Row({ entry, account }: { entry: RankedLeaderboardEntry; account: string }) {
  return (
    <div className="leaderboard-row">
      <span className="leaderboard-rank">{entry.rank}</span>
      <span
        className="leaderboard-name"
        style={{ color: entry.account === account ? "var(--accent)" : undefined }}
      >
        {entry.nick}
        {entry.account === account ? " (나)" : ""}
      </span>
      <span className="leaderboard-total">{entry.total}</span>
    </div>
  );
}

/** Hub-only panel — top 10 all-time scores, plus your own rank if you're outside it. */
export function Leaderboard({ account, fetchLeaderboard }: Props) {
  const [data, setData] = useState<LeaderboardResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchLeaderboard()
        .then((result) => {
          if (!cancelled) setData(result);
        })
        // Keep showing the last good data on failure; leaderboard is
        // non-critical, a retry banner would be noise.
        .catch(() => {});
    };

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchLeaderboard]);

  return (
    <div className="leaderboard">
      <div className="leaderboard-heading">리더보드</div>
      {!data || data.top.length === 0 ? (
        <div className="leaderboard-empty">아직 기록이 없습니다</div>
      ) : (
        <>
          {data.top.map((entry) => (
            <Row key={entry.account} entry={entry} account={account} />
          ))}
          {data.me && (
            <>
              <div className="leaderboard-divider" />
              <Row entry={data.me} account={account} />
            </>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `src/ui/ui.css`에 스타일 추가**

파일 끝에 추가:

```css
.leaderboard {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 200px;
  padding: 12px 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  backdrop-filter: blur(8px);
}

.leaderboard-heading {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 8px;
}

.leaderboard-empty {
  font-size: 12px;
  color: var(--muted);
}

.leaderboard-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 3px 0;
}

.leaderboard-rank {
  width: 18px;
  color: var(--muted);
  text-align: right;
}

.leaderboard-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leaderboard-total {
  color: var(--muted);
}

.leaderboard-divider {
  margin: 6px 0;
  border-top: 1px solid var(--line);
}
```

- [ ] **Step 3: `src/ui/HubHud.tsx`에 마운트**

`src/ui/HubHud.tsx` 상단 import 목록:

```ts
import { useEffect, useRef, useState } from "react";
import type { PortalProgress } from "../hub/HubPlayer";
import type { PlayerState } from "../net/types";
```

를 다음으로 교체:

```ts
import { useEffect, useRef, useState } from "react";
import type { PortalProgress } from "../hub/HubPlayer";
import type { LeaderboardResult, PlayerState } from "../net/types";
import { Leaderboard } from "./Leaderboard";
```

`Props` 인터페이스:

```ts
interface Props {
  portalRef: React.MutableRefObject<PortalProgress>;
  players: PlayerState[];
  account: string;
  joining: boolean;
  /** False once the player has used the controls; hides the basic tutorial. */
  showControls: boolean;
}
```

를 다음으로 교체:

```ts
interface Props {
  portalRef: React.MutableRefObject<PortalProgress>;
  players: PlayerState[];
  account: string;
  joining: boolean;
  /** False once the player has used the controls; hides the basic tutorial. */
  showControls: boolean;
  fetchLeaderboard: () => Promise<LeaderboardResult>;
}
```

함수 시그니처:

```ts
export function HubHud({ portalRef, players, account, joining, showControls }: Props) {
```

를:

```ts
export function HubHud({ portalRef, players, account, joining, showControls, fetchLeaderboard }: Props) {
```

로 교체. 반환 JSX에서, `<div className="hud-left">...</div>` 블록(현재 41~52번째
줄) 바로 뒤에 추가:

```tsx
      <Leaderboard account={account} fetchLeaderboard={fetchLeaderboard} />
```

- [ ] **Step 4: `src/App.tsx`에서 `HubHud`에 prop 전달**

`src/App.tsx`의 기존 `<HubHud .../>` 호출:

```tsx
        <HubHud
          portalRef={portalRef}
          players={players}
          account={account}
          joining={joining}
          showControls={!controlsLearned}
        />
```

를 다음으로 교체:

```tsx
        <HubHud
          portalRef={portalRef}
          players={players}
          account={account}
          joining={joining}
          showControls={!controlsLearned}
          fetchLeaderboard={game.fetchLeaderboard}
        />
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

- [ ] **Step 8: 브라우저에서 전체 흐름 수동 확인**

`npm run dev`로(오프라인 모드 — 봇 상대):
- 허브 화면 우측 상단에 "리더보드" 패널이 보이는지, 처음엔 "아직 기록이 없습니다"인지
- 매치를 한 라운드 이상 끝내고 허브로 돌아왔을 때 리더보드에 본인 점수가 반영되는지
- 여러 라운드를 거치며 점수가 누적(덮어쓰기 아님)되는지

배포 환경(실제 Verse8)에서는 별도로:
- 콜렉션이 서버 재시작 후에도 유지되는지(로컬 인메모리 구현과 달리 실제 인프라가
  영속시키는지) — README에 "배포 후 확인 필요" 항목으로 남길 것

- [ ] **Step 9: Commit**

```bash
git add src/ui/Leaderboard.tsx src/ui/HubHud.tsx src/App.tsx src/ui/ui.css
git commit -m "Show a top-10 leaderboard panel in the hub"
```

---

## 완료 후 확인

- [ ] `README.md`의 "알려진 한계"에 "리더보드 콜렉션의 실제 배포 환경 영속성
      미확인(로컬 구현은 인메모리)" 항목 추가할지 사용자와 상의.

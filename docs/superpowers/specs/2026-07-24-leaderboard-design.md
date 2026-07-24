# 로비 리더보드 설계 (2026-07-24)

## 배경

로비(허브)에 누적 총점수 기준 상위 10명 리더보드를 추가한다. 별도 요청이었던
"아바타 구매"는 완전히 독립된 서브프로젝트로 분리, 별도 설계/계획으로 진행한다
(이 문서는 리더보드만 다룬다).

## 조사 결과 (설계에 영향을 준 것들)

- **계정 식별자(`account`)는 영속적이다.** `@agent8/gameserver`의
  `GameServer.randomAccount`가 `localStorage["agent8:temporary_account"]`에 저장돼
  같은 브라우저에서는 세션이 바뀌어도 유지되고, 실제 Verse8 로그인 환경에서는
  플랫폼이 진짜 계정을 준다(`node_modules/@agent8/gameserver/dist/src/server/
  GameServer.js:48-78`). 방/라운드에 묶이지 않는 영구 리더보드의 키로 쓸 수 있다.
- **`$global` 콜렉션이 방과 무관한 전역 저장소를 제공한다.** `GlobalContext`에
  `getCollectionItems`/`addCollectionItem`/`updateCollectionItem`(필터·정렬·limit
  지원)가 있고, 이건 룸 스코프의 `getRoomCollectionItems`와 별개다(`server/
  node_modules/@agent8/gameserver-node/dist/runtime/GlobalContext.js`). 이 프로젝트가
  지금까지 안 써봤을 뿐, 라운드가 끝나도 남는 저장소가 이미 SDK에 있다.
- 서버의 로컬(오프라인/테스트) 구현(`LocalCollectionManager`)은 인메모리 — 실제
  배포 환경에서 이 콜렉션이 서버 프로세스 재시작을 넘어 영속되는지는 이 저장소
  안에서 확인할 수 없다(SDK 문서 밖의 인프라 문제). 배포 후 실측이 필요한 항목으로
  README에 남긴다.

## 범위

- **순위 기준**: 누적 총점수(모든 라운드의 `gained` 합산). 승률/포착 횟수 등
  다른 지표는 범위 밖.
- **표시**: 로비(허브)에서만. 매치 화면에는 안 보임.
- **표시 인원**: 상위 10명 고정 표시 + 내 순위가 10위 밖이면 별도로 "내 순위" 한 줄
  추가 표시.
- **갱신 시점**: 서버의 `endRound`가 그 라운드 결과를 확정하는 시점에 리더보드
  콜렉션도 같이 갱신(라운드 종료마다, 실시간 스트리밍 아님).
- **오프라인 모드**: 실제 영속 저장 없이(오프라인 자체가 "리허설 rig"), 현재
  세션의 로컬 `scores`(나 + 봇 2명)로 그때그때 계산해서 같은 UI를 보여준다 —
  UI/인터페이스 일관성 유지가 목적이지, 오프라인에 진짜 영속성을 만드는 게 아니다.

## 아키텍처

### 서버: `server/src/server.ts`

새 콜렉션 이름 상수(`server/src/rules.ts`): `export const LEADERBOARD_COLLECTION = "leaderboard";`
항목 shape: `{ __id, account, nick, total }` — `__id`는 SDK가 자동 부여.

`endRound` 끝에 라운드 결과(`results` 배열 — 이미 존재)를 순회하며 계정별로
콜렉션을 upsert:

```
각 결과 항목(hider든 seeker든)에 대해:
  기존 항목 찾기: $global.getCollectionItems(LEADERBOARD_COLLECTION,
                   { filters: [{ field: "account", operator: "==", value: r.account }] })
  있으면: updateCollectionItem(..., { __id: existing.__id, total: existing.total + r.gained, nick: r.nick || existing.nick })
  없으면: addCollectionItem(..., { account: r.account, nick: r.nick || "익명", total: r.gained })
```

seeker 결과 항목은 `nick: ""`로 채워져 있으므로(기존 코드, 화면에는 클라이언트가
`players` 목록에서 닉네임을 다시 찾아 보여주는 방식이라 문제 없었음), 리더보드용으로
upsert할 땐 `users` 배열에서 `state.seeker`와 일치하는 유저의 실제 `nick`을 찾아
채운다.

새 remote function:

```ts
async getLeaderboard(): Promise<{
  top: Array<{ account: string; nick: string; total: number; rank: number }>;
  me: { account: string; nick: string; total: number; rank: number } | null;
}>
```

동작:
1. `$global.getCollectionItems(LEADERBOARD_COLLECTION, { orderBy: [{ field: "total", direction: "desc" }], limit: 10 })` → `top`(순위 1~10 부여).
2. 호출자(`$sender.account`)가 `top` 안에 이미 있으면 `me: null`(중복 표시 안 함).
3. 없으면: 본인 항목을 콜렉션에서 조회(`account == $sender.account` 필터) — 없으면
   `me: null`(아직 한 라운드도 완료 안 함). 있으면 자기보다 `total`이 더 높은
   항목 수를 세어(`countCollectionItems`에 `total > 내점수` 필터) `rank = 그 수 + 1`로
   계산.

### 클라이언트: `src/net/useGame.ts` / `src/net/offline.ts`

`useGame()`의 반환 객체에 `fetchLeaderboard: () => Promise<LeaderboardResult>` 추가
(온라인은 `server.remoteFunction("getLeaderboard", [])` 그대로 위임, 오프라인은
로컬 `scores` 객체로 즉석 계산 — 같은 반환 shape).

### UI: `src/ui/Leaderboard.tsx` (신규)

허브 전용, `HubHud.tsx`가 마운트한다(우측 상단 — 그 코너는 현재 허브 화면에서
비어 있음, `.hud-left`는 좌측 상단, `.hint`는 우측 하단). 마운트 시 1회 +
10초 간격으로 `fetchLeaderboard()` 호출해 갱신. 순위/닉네임/점수 3열 리스트,
내 항목은 강조 색상.

## 에러 처리

- `getLeaderboard` 호출 실패(네트워크 등) 시 마지막으로 성공한 데이터를 계속
  보여주고 조용히 재시도 — 에러 배너 없음(리더보드는 부가 정보, 실패가 게임
  진행을 막으면 안 됨).
- 콜렉션에 아직 아무도 없으면(서버 갓 시작) 빈 리스트 + "아직 기록이 없습니다"
  안내.

## 테스트

- `server/test/server.test.ts`에 케이스 추가: 한 라운드 종료 후 `getLeaderboard`가
  해당 계정들을 올바른 `total`/순위로 반환하는지, 같은 계정이 두 번째 라운드도
  끝낸 뒤 `total`이 누적(덮어쓰기 아님)되는지, 10명 넘게 있을 때 `top`이 정확히
  10개로 잘리고 내림차순인지, 상위 10위 밖 계정의 `me.rank`가 올바른지.
- 클라이언트 쪽(`fetchLeaderboard`의 오프라인 구현)은 `scripts/check-hub.ts`류의
  헤드리스 스크립트로 순수 계산 로직만 검증 가능하면 검증한다(정렬/순위 계산 함수를
  뽑아낼 수 있으면 순수 함수로 분리해서 테스트).

## 영향받지 않는 것

- 기존 `scores`(방 단위, 결과 화면에 쓰이는 것) — 그대로 유지, 이번 리더보드는
  별도의 영구 콜렉션을 추가로 쌓는 것이지 기존 걸 대체하지 않는다.
- 매치 중 UI, 이동/충돌/사운드 로직 — 전혀 무관.
- "아바타 구매" — 별도 설계 문서로 분리.

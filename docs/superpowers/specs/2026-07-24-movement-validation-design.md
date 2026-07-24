# 이동 서버 검증 설계 (2026-07-24)

## 배경

`README.md`의 "알려진 한계"에 명시된 항목: 서버가 클라이언트가 보고하는 위치(`pos`)를
그대로 신뢰한다. 스피드핵이나 순간이동으로 유리한 위치를 즉시 차지하거나, 술래를
회피할 수 있다. README는 해결 방향으로 "프레임당 이동거리 상한 검증"을 직접 제안했다.

추가로 확인한 점: `requestTag`(태그 판정)의 거리·시야각 체크가 `updateTransform`이
저장한 것과 동일한 `pos`/`rotY` 필드를 그대로 읽는다. 즉 `updateTransform`에서
`pos`를 검증하면, 태그 판정에서 "순간이동 후 태그"를 노리는 우회도 같이 막힌다.

## 범위

- **검증**: `server/src/server.ts`의 `updateTransform()` 내부에서, XZ 평면 이동거리만
  경과시간 × 최대속도 기준으로 상한을 두고 초과분은 clamp.
- **범위 밖**: Y축(수직) 이동 검증 — 점프/낙하가 중력가속도로 순간 속도가 크게 뛰기
  때문에, 별도 설계 없이 묶으면 정상 낙하를 오탐할 위험이 큼. 다음 단계로 남겨둔다.
- **범위 밖**: 완전한 서버 권위 물리(서버가 `stepMotion`+충돌을 재시뮬레이션). 이번
  변경은 README가 제안한 "가벼운" 수준에 그친다 — 클라이언트는 계속 자유롭게
  움직이고 입력만 보내는 구조로 바뀌지 않는다.

## 데이터 흐름

```
클라이언트 stepMotion() → onTransform() → updateTransform(pos, rotY, pose, moving)
                                                │
                                     $room.getMyState()로 직전 pos, lastMoveAt 조회
                                                │
                                elapsed = max(now - lastMoveAt, MIN_DT_MS)
                                maxDist = MOVE_SPEED_CAP * SPEED_GRACE * elapsed/1000
                                                │
                              신청 XZ가 직전 위치 기준 maxDist 밖이면 경계로 clamp
                                                │
                                  clamp된 pos + lastMoveAt: now 로 저장
                                                │
                    이후 모든 소비자(다른 클라이언트 렌더, requestTag 판정)가
                    이 clamp된 pos를 그대로 읽는다 — 별도 수정 불필요
```

## 상수 (server/src/rules.ts에 신규 추가)

```ts
/**
 * src/game/constants.ts의 MOVE.seekerSpeed(둘 중 더 빠른 쪽)와 동기화 유지 —
 * check:sync가 검사. 역할별로 나누지 않고 더 빠른 쪽을 공통 상한으로 쓴다:
 * 이 테스트 하네스는 블랙박스라 실제 라운드 진행 없이는 "seeker" 역할을 만들
 * 방법이 없어 역할별 값을 검증할 수 없고, 통합 상한을 써도 hider가 자기 실제
 * 속도(6.0)보다 살짝 더 여유(6.8까지)를 갖는 정도의 미미한 손해만 있다 —
 * "가벼운 검증"으로 합의한 범위에서 텔레포트 방지라는 목적은 그대로 달성한다.
 */
export const MOVE_SPEED_CAP = 6.8;
/** 네트워크 지터/전송 버스트에 대한 여유 배수. */
export const SPEED_GRACE = 1.5;
/** elapsed 계산의 하한(ms) — 버스트 전송으로 elapsed≈0이 되어 정상 이동까지 clamp되는 것 방지. */
export const MIN_DT_MS = 50;
```

`SPEED_GRACE`, `MIN_DT_MS`는 튜닝 값이라 정확한 근거가 있다기보다 "정상 플레이는 절대
안 걸리되 텔레포트/스피드핵은 확실히 막는" 선에서 넉넉하게 잡은 값이다. 배포 후 오탐이
있으면 올리고, 너무 널널하면 낮춘다.

## 리스폰 처리

`joinGame`과 `startRound`가 `updateRoomUserState`/`updateMyState`로 `pos`를 직접 쓸 때
(스폰), `lastMoveAt`도 같이 `now`로 리셋한다. 안 그러면 반대 방향으로 허점이 생긴다:

1. 플레이어가 한동안 가만히 있다 잡힌다 — 마지막 실제 이동은 훨씬 전(`lastMoveAt`은
   그 오래된 시각에 머물러 있음).
2. 새 라운드가 시작되며 서버가 새 스폰 위치로 `pos`를 직접 바꾼다(`lastMoveAt`은
   갱신 안 됨 — 여전히 오래된 값).
3. 클라이언트가 새 스폰 위치에서 `updateTransform`을 호출하면, 서버는
   `elapsed = now - lastMoveAt`을 실제보다 훨씬 크게(예: 수 초) 계산해서
   `maxDist`를 과도하게 넉넉하게 내준다.
4. 그 넉넉해진 한도 안에서, 스폰 위치와 무관하게 큰 폭의 순간이동을 "정상 이동"처럼
   위장할 수 있다 — 오탐(false positive)이 아니라 **탐지 유예 구간이 생기는
   허점**이다.

`lastMoveAt`을 스폰 시점에 `now`로 리셋하면, `elapsed`가 항상 "실제로 이 위치에
있었던 시점"부터 계산되어 이 허점이 사라진다.

## 에러 처리

명시적으로 "거부"하는 개념은 없다 — 항상 clamp된 값을 저장하고 정상적으로 계속
진행한다. 클라이언트 입장에서는 "빠르게 움직이려 해도 일정 속도 이상으로는 반영되지
않는다"로 보인다. 별도의 에러 응답이나 킥 처리는 만들지 않는다(오탐 시 게임이
멈추는 것보다 완만하게 제한되는 편이 안전).

## 테스트

`server/test/server.test.ts`에 케이스 추가:

1. **정상 이동 통과** — hiderSpeed 이내로 여러 번 연속 `updateTransform` 호출 시
   요청한 좌표가 그대로 저장됨.
2. **순간이동 clamp** — 첫 스폰 이후 물리적으로 불가능한 거리로 한 번에
   `updateTransform` 호출 시, 저장된 `pos`가 직전 위치에서 `maxDist` 이내로
   제한됨(요청한 좌표 그대로 저장되지 않음).

   두 테스트 모두, 이 로컬 테스트 하네스 특유의 제약 때문에 `joinGame` 직후 곧바로
   `getMyState()`를 읽으면 안 된다 — `$room`-scoped 상태(`getMyState`/`updateMyState`가
   씀)와 `joinGame`이 `$global.updateRoomUserState(roomId, ...)`로 쓰는 상태가
   서로 다른 room 키를 써서(`RoomContext.setRoomId`가 패키지 전체에서 호출되지
   않음 — 실제 배포 환경은 무관, 로컬 오프라인 런타임 한정) `joinGame` 직후
   `getMyState()`는 항상 `{}`를 반환한다. 그래서 각 테스트는 `updateTransform`을
   한 번 호출해 `$room`에서 읽을 수 있는 기준점(baseline)을 먼저 만든 뒤, 그
   기준점 대비로 다음 이동을 검증한다.
3. **스폰의 `lastMoveAt` 리셋** — 위와 같은 이유로 "`joinGame`/`startRound`가
   `lastMoveAt`을 실제로 리셋하는지"는 이 하네스로 관찰 불가능하다(리셋 여부와
   무관하게 스폰 직후 첫 `updateTransform`의 `prev`는 항상 `{}`로 읽힌다). 이
   항목은 자동 테스트 없이 코드 리뷰로만 검증한다. 기존 테스트 스위트가
   `$roomTick`/`startRound`를 직접 틱하지
   않는 관례를 따라 이 항목은 코드 리뷰로 확인(별도 라운드-플로우 테스트는 만들지
   않음).

`npm run check`(서버 테스트 포함)가 계속 통과해야 한다. `scripts/check-sync.ts`에
`MOVE_SPEED_CAP` 동기화 검사를 추가한다.

## 영향받지 않는 것

- 클라이언트 코드(`src/game/*`) — 전혀 수정하지 않는다.
- Y축 이동, 회전(`rotY`), 자세(`pose`) — 이번 변경 범위 밖.
- 페인트 시스템 — 무관.

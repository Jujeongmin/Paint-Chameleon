# 아바타 상점 설계 (2026-07-27)

## 배경

허브에서 코인으로 **체형이 다른 아바타**를 사고 장착한다. 리더보드 설계
문서([2026-07-24-leaderboard-design.md](2026-07-24-leaderboard-design.md))가
"아바타 구매는 완전히 독립된 서브프로젝트"로 분리해둔 그 항목이다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 아바타가 바꾸는 것 | 체형(지오메트리). 텍스처 프리셋이나 액세서리가 아님 |
| 게임플레이 영향 | **없음** — 실루엣만 다르고 키·충돌·태그 판정은 전부 동일 |
| 화폐 | 점수와 완전히 별개인 코인 |
| 적립 | 라운드 참가 고정 + 성과 보너스 |
| 상점 위치 | 허브 안 3D 구조물, 다가가면 열림 |

## 조사 결과 (설계에 영향을 준 것들)

- **`ARM_HALF`(0.27)와 `LEG_HALF`(0.285)는 독립 상수가 아니라 파생값이다.**
  캡슐의 반길이는 `length/2 + radius`이고, 실제로 `0.34/2 + 0.1 = 0.27`,
  `0.32/2 + 0.125 = 0.285`로 정확히 일치한다. 프로필에서 계산해 쓰면 굵기만
  바꿨는데 팔이 어깨에서 빠지는 부류의 버그가 구조적으로 불가능해진다.
- **현재 체형의 최대 반폭은 `shoulderX + armR = 0.35 + 0.1 = 0.45`로
  `MOVE.playerRadius`와 정확히 같다.** 즉 지금 몸은 이미 충돌체 상한에 붙어
  있고, "더 넓은 아바타"는 만들 수 없다. 넓어 보이게 하려면 몸통을 굵히고 팔을
  안쪽으로 당기는 수밖에 없다 — 카탈로그의 `tank`가 그 방식이다.
- **허브에는 이미 `frozen` 플래그가 있다**(`src/hub/HubPlayer.tsx:55`). 이동·
  마우스룩(`usePointerLook(!frozen, ...)`)·포털 감지(`frozen ? null :
  portalAt(...)`)를 한꺼번에 끈다. 상점 패널은 새 입력 처리를 만들 필요 없이
  이걸 재사용하며, 덤으로 쇼핑 중 실수로 매치 포털에 진입하는 것도 막힌다.
- **마우스룩 폴백은 HUD 클릭을 이미 고려하고 있다**(`src/game/input.ts:194`,
  `if (e.target !== canvas) return`). 포인터 락이 거부되는 환경(README 알려진
  한계 항목 참고 — Task 10 문서 정리 이후 번호가 바뀔 수 있어 여기서는 번호를
  고정하지 않는다)에서도 상점 버튼 클릭이 카메라를 돌리지 않는다.
- **페인트 UV 아틀라스는 부위 이름 6칸만 본다**(`src/game/paint.ts`의
  `PART_CELL`). 지오메트리 치수를 바꿔도 부위 구성이 그대로면 페인팅은 아무
  수정 없이 따라온다.
- `$lock`은 이미 매치메이킹에서 쓰고 있다(`server/src/server.ts:189`). 구매의
  읽기-수정-쓰기 경합을 막는 데 그대로 쓸 수 있다.

## 1. 아바타 = 체형 프로필

### 데이터 모델 (`src/game/bodies.ts`, 신규)

```ts
export interface BodyProfile {
  id: string;
  name: string;
  /** 0이면 기본 지급품. */
  price: number;
  head: { r: number };
  torso: { r: number; l: number; y: number };
  arm: { r: number; l: number };
  leg: { r: number; l: number };
  shoulderX: number;
  shoulderY: number;
  hipX: number;
}
```

### 불변식 — "실루엣만 다르게"를 코드로 강제

두 개는 **파생시켜서 위반 자체가 불가능하게** 만들고, 나머지 셋은 검사한다.

파생(구조적으로 보장):

| 값 | 식 | 고정값 |
|---|---|---|
| `headY` | `TOP_Y - head.r` | 정수리 `TOP_Y = 1.86` |
| `hipY` | `FOOT_Y + leg.l + 2·leg.r` | 발바닥 `FOOT_Y = 0.13` |
| `armHalf` | `arm.l/2 + arm.r` | — |
| `legHalf` | `leg.l/2 + leg.r` | — |

검사(`validateProfile()`):

1. `max(shoulderX + arm.r, torso.r, hipX + leg.r) ≤ MOVE.playerRadius` (0.45)
   — 몸이 충돌체 밖으로 나가면 안 된다.
2. `1.16 ≤ shoulderY ≤ 1.40` — `CAMERA.shoulderHeight`(1.35) 피벗이 계속
   "어깨"로 읽혀야 한다.
3. 어깨·엉덩이 피벗이 몸통 캡슐 안에 있을 것:
   `torso.y - (torso.l/2 + torso.r) ≤ hipY` 이고
   `shoulderY ≤ torso.y + (torso.l/2 + torso.r)` — 아니면 팔다리가 몸에서
   떨어져 보인다.

`TOP_Y`/`FOOT_Y`는 현재 체형에서 그대로 뽑은 값이다(`1.52 + 0.34 = 1.86`,
`0.70 - 2 × 0.285 = 0.13`). 즉 `classic`은 정의상 현재와 픽셀 단위로 동일하다.

### 카탈로그 v1

| id | 이름 | 가격 | head.r | torso r/l/y | arm r/l | leg r/l | shoulderX/Y | hipX |
|---|---|---|---|---|---|---|---|---|
| `classic` | 클래식 | 0 | 0.34 | 0.26 / 0.34 / 0.98 | 0.10 / 0.34 | 0.125 / 0.32 | 0.35 / 1.28 | 0.16 |
| `bean` | 콩이 | 40 | 0.40 | 0.32 / 0.30 / 0.95 | 0.115 / 0.24 | 0.145 / 0.20 | 0.335 / 1.18 | 0.15 |
| `stick` | 막대 | 60 | 0.26 | 0.20 / 0.36 / 1.06 | 0.075 / 0.46 | 0.095 / 0.50 | 0.375 / 1.38 | 0.13 |
| `tank` | 떡대 | 90 | 0.29 | 0.30 / 0.40 / 1.02 | 0.14 / 0.30 | 0.16 / 0.26 | 0.31 / 1.30 | 0.18 |

파생값 확인: `bean` 엉덩이 `0.13+0.20+0.29 = 0.62`, `stick` `0.13+0.50+0.19 =
0.82`, `tank` `0.13+0.26+0.32 = 0.71`. 네 프로필 모두 최대 반폭이 정확히
0.45이고 검사 3개를 통과한다.

### `Humanoid.tsx` 수정 지점

`body?: string` prop을 받아 `profileFor(id)`로 해석한다. **모르는 id는 조용히
`classic`으로 폴백** — 네트워크로 들어온 값이라 절대 크래시하면 안 된다.

치환할 하드코딩 위치:

- 모듈 상수 `SHOULDER_Y` / `ARM_HALF` / `HIP_Y` / `LEG_HALF` (20~23행) 제거
- `geoms` useMemo의 캡슐/구 치수 (80~86행) — `body`에 의존하도록 deps 추가
- `head.current.position.y` 목표값의 `1.52` (163행) → `profile.headY`
- `hipL/hipR`의 `HIP_Y` (189, 194행) → `profile.hipY`
- `hipL/hipR`의 `-0.16 * spec.legSpread` (188, 193행) → `±profile.hipX * ...`
- JSX의 `position={[0, 1.52, 0]}`, `[0, 0.98, 0]`, `[∓0.35, SHOULDER_Y, 0]`,
  `[0, -ARM_HALF, 0]`, `[∓0.16, HIP_Y, 0]`, `[0, -LEG_HALF, 0]` (200~215행)

`geoms`가 `body`에 의존하게 되므로 기존 정리 `useEffect`(99~104행)가 프로필이
바뀔 때마다 옛 지오메트리를 dispose한다 — 이미 올바른 형태라 그대로 둔다.

애니메이션 로직(걷기·점프·착지 스쿼시·포즈)은 전부 피벗 회전이라 **한 줄도
바뀌지 않는다.**

`showOutline`의 와이어프레임 타원체(217~222행)도 그대로 둔다. 총 키와 최대
반폭이 모든 프로필에서 동일하므로 고정 타원체가 네 체형 모두를 여전히 감싼다 —
이것 자체가 불변식이 지켜지고 있다는 시각적 확인이 된다.

## 2. 화폐와 소유

### 지갑 콜렉션 (서버)

리더보드와 **별도 콜렉션** `wallets`를 쓴다. 리더보드 항목은 상위 10명이
공개로 읽는 데이터라 개인 소유물을 섞지 않고, `attachRanks`와 기존 쿼리도
건드리지 않는다.

`server/src/rules.ts`: `export const WALLET_COLLECTION = "wallets";`

항목 shape: `{ __id, account, coins, owned, equipped }`

`owned`는 **쉼표 구분 문자열**로 저장한다. 이 SDK 콜렉션이 배열 필드를 제대로
다루는지 저장소 안에서 확인할 수 없고, 아바타 id는 영소문자뿐이라 구분자
충돌이 없다. 구현 중 배열이 안전하다고 확인되면 그때 바꾼다.

신규 계정의 암묵적 기본값: `coins: 0, owned: "classic", equipped: "classic"`.
지갑 항목이 아직 없는 계정도 이 값으로 읽히게 해서, 첫 라운드 전에 상점을
열어도 정상 동작한다.

### 코인 적립

`server/src/rules.ts`:

```ts
export const COINS = { perRound: 5, survived: 5, perCatch: 2 };
```

`endRound`의 리더보드 upsert 루프에 함께 태운다. hider는
`perRound + (안 잡혔으면 survived)`, seeker는 `perRound + catches × perCatch`.

**커밋 `88d005c`의 규율을 그대로 지킨다**: 페이즈 전환(`results`)이 이미 끝난
뒤에 실행되고, 지갑 쓰기 실패는 `try/catch`로 삼켜 라운드 진행을 절대 막지
않는다. 부분 실패한 라운드의 코인은 그냥 유실된다 — 재시도해서 중복 지급하는
것보다 낫다.

한 라운드에 약 10코인, 라운드 길이는 145초. 첫 아바타(40) 약 10분, 전부(190)
약 45분.

### 구매·장착 (전적으로 서버 권한)

```ts
async buyAvatar(id: string): Promise<{ ok: true; coins: number } | { ok: false; reason: string }>
async equipAvatar(id: string): Promise<{ ok: boolean }>
async getWallet(): Promise<{ coins: number; owned: string[]; equipped: string }>
```

`buyAvatar`는 `$lock("wallet:" + $sender.account, ...)` 안에서 콜렉션을 읽고,
판단은 전적으로 순수 함수 `applyPurchase()`에 맡긴 뒤(거부 사유 `unknown` /
`owned` / `broke`), 성공했을 때만 한 번의 `updateCollectionItem`으로 기록한다.

락 없이는 더블클릭으로 두 요청이 같은 잔액을 읽어 두 번 살 수 있다.

`equipAvatar`는 소유 여부를 검증한 뒤 지갑의 `equipped`와 **룸 유저 상태의
`body`를 함께** 쓴다.

서버 가격표(`AVATAR_PRICES`)가 클라 카탈로그와 갈라지면 표시가와 실제 차감액이
달라지므로, `MOVE_SPEED_CAP`이 그러듯 `check:sync`가 id 집합과 가격을 대조한다.

**코인을 지급하는 원격 메서드는 만들지 않는다.** 리더보드 설계가 점수 주입
메서드를 거부한 것과 같은 이유다 — 누구나 자기 잔액을 조작할 수 있게 된다.

## 3. 네트워크 동기화

- `src/net/types.ts`의 `PlayerState`에 `body?: string` 추가.
- `joinHub` / `joinGame`이 지갑의 `equipped`를 읽어 룸 유저 상태에 채운다.
- `RemotePlayers`가 `player.body`를 `Humanoid`에 그대로 넘긴다
  (`src/game/RemotePlayers.tsx:76`).
- 로컬 플레이어는 자기 지갑 상태에서 직접 읽는다.

전송량은 계정당 짧은 문자열 하나가 늘 뿐이고, 자주 바뀌지 않으므로
`NET_THROTTLE_MS` 경로(transform)와 무관하다.

### 클라이언트 훅

`useGame()` 반환에 `fetchWallet()`, `buyAvatar(id)`, `equipAvatar(id)` 추가.
온라인은 `remoteFunction`에 위임하고, 오프라인은 아래 인메모리 구현.

## 4. 상점 (허브)

### 3D 구조물 (`src/hub/hubMap.ts`)

키오스크 박스 몇 개를 스폰(z=10)과 포털(z=-11) 사이 왼편 **x ≈ -9.5, z ≈ 4**에
세우고 `HUB_BOXES`에 합류시켜 충돌을 얻는다. 트리거는 포털과 별개 함수
`atShop(x, z)`로 반경 **3.0**, **dwell 없이 진입 즉시** 열린다 — dwell은 되돌릴
수 없는 매치 진입용 장치이고 상점은 언제든 닫을 수 있으므로 필요 없다.

포털 반경(2.0~2.2)과 겹치지 않는 위치라 두 트리거가 동시에 켜질 일은 없다.

키오스크 옆에 **유료 아바타 3종이 실제 크기로 서서 천천히 회전한다.** 이게
미리보기다. 각 마네킹은 `__shop:bean` 같은 예약 id로 `surfaceFor()`에서 자기
페인트 캔버스를 받는다(계정 id와 충돌 불가능한 형태).

### 패널 (`src/ui/Shop.tsx`, 신규)

`HubHud`가 마운트한다. 반경 안에 들어오면 열리고 `Hub`의
`frozen={joining || shopOpen}`이 이동·마우스룩·포털 감지를 끈다.

표시: 현재 코인, 아바타 4장(이름·가격·소유/장착 상태), 구매·장착 버튼.
닫기는 Escape 또는 닫기 버튼.

**설계로 막는 버그**: 반경 안에 선 채로 닫으면 다음 프레임에 다시 열린다.
닫으면 `dismissed`를 세우고, `atShop`이 false가 될 때(반경 밖으로 나갔을 때)만
해제한다.

### 오프라인 모드

`src/net/offline.ts`에 인메모리 지갑을 두고 **시작 잔액 100코인**으로 상점
전체를 리허설할 수 있게 한다. 새로고침하면 초기화된다.

100은 임의의 값이 아니다: `bean`(40) + `stick`(60)을 정확히 살 수 있고
`tank`(90)는 못 사므로, 구매 성공 경로와 잔액 부족 거부 경로를 **둘 다** 서버
없이 눈으로 확인할 수 있다.

이건 리더보드 설계가 거부한 "점수 주입 메서드"와 다른 사안이다 — 오프라인은
서버가 존재하지 않는 순수 클라이언트 리그라 넘을 권한 경계 자체가 없다.
서버 쪽에는 지급 메서드를 만들지 않는다는 원칙은 그대로다.

## 에러 처리

- `getWallet` 실패: 마지막으로 성공한 값을 계속 보여주고 조용히 재시도.
  리더보드와 같은 방침 — 부가 기능이 게임 진행을 막으면 안 된다.
- `buyAvatar` 거부: 사유별 한국어 메시지를 패널 안에 인라인 표시(배너 아님).
- 알 수 없는 `body` id: `classic`으로 폴백, 로그 없음.

## 테스트

- `scripts/check-bodies.ts` (신규, `npm run check`에 편입)
  - 카탈로그 4종 전부 `validateProfile()` 통과
  - id 유일, 기본(`classic`)의 `price === 0`
  - `classic`의 파생값이 현재 하드코딩 값과 일치(회귀 방지):
    `headY ≈ 1.52`, `hipY ≈ 0.70`, `armHalf ≈ 0.27`, `legHalf ≈ 0.285`.
    **반드시 허용 오차(1e-6)로 비교할 것** — `1.86 - 0.34`는 부동소수점에서
    정확히 `1.52`가 아니라 `1.5199999999999998`이라 등호 비교는 실패한다.
    같은 이유로 `validateProfile()`의 폭·높이 상한 비교에도 같은 오차를 준다.
  - 불변식을 일부러 깬 프로필이 `validateProfile()`에서 거부되는지(양성 검사)
- `scripts/check-sync.ts` 확장 — 클라 카탈로그 id 집합·가격 == 서버
  `AVATAR_PRICES`

### 서버 테스트 하네스의 제약 — 순수 함수로 설계해야 하는 이유

`@agent8/gameserver-node test` 하네스는 **라운드를 끝까지 진행시킬 수단이 없다.**
리더보드가 정확히 이 벽에 부딪혀 서버 테스트가
`server/test/server.test.ts:199-208` 한 건(빈 상태)으로 끝났고, 나머지는 순수
함수 `attachRanks`를 `scripts/check-leaderboard.ts`가 검증하는 형태가 됐다.

여기에 더해 **구매는 코인 없이 테스트할 수 없다**. 코인을 지급하는 원격
메서드를 만들지 않기로 했으므로(위 참조), 살아 있는 서버에서 성공 구매를
재현할 방법 자체가 없다. 진단용 지급 메서드를 넣는 것은 잔액 조작 구멍이므로
리더보드 때와 같은 이유로 거부한다.

따라서 **결정 로직 전부를 `server/src/rules.ts`의 순수 함수로 뽑는다.**
`server.ts`의 원격 메서드는 콜렉션 읽기 → 순수 함수 → 콜렉션 쓰기의 얇은
껍데기가 된다.

```ts
export interface WalletState { coins: number; owned: string[]; equipped: string }
export const DEFAULT_WALLET: WalletState;

export function parseOwned(s: string): string[];
export function serializeOwned(ids: string[]): string;

/** 한 라운드에서 한 계정이 버는 코인. */
export function coinsFor(o: { seeker: boolean; caught: boolean; catches: number }): number;

export type PurchaseFailure = "unknown" | "owned" | "broke";
export function applyPurchase(
  w: WalletState, id: string
): { ok: true; wallet: WalletState } | { ok: false; reason: PurchaseFailure };

export function applyEquip(
  w: WalletState, id: string
): { ok: true; wallet: WalletState } | { ok: false };
```

`scripts/check-shop.ts` (신규, `npm run check`에 편입)가 검증한다:

- `coinsFor` — 생존 hider 10, 잡힌 hider 5, 캐치 3회 seeker 11, 캐치 0회 seeker 5
- `applyPurchase` 거부 3종: 미존재 id / 이미 소유 / 잔액 부족
- 성공 구매가 정확히 가격만큼 차감하고 `owned`에 **한 번만** 추가
- `applyPurchase`가 입력 지갑을 변형하지 않음(불변) — 실패 시 잔액이 새는 것을
  막는 실질적 검사
- `applyEquip`이 미소유 id를 거부하고, 소유 id는 `equipped`만 바꿈
- `parseOwned`/`serializeOwned` 왕복, 빈 문자열이 `[]`이 되는지

`server/test/server.test.ts`에는 라이브 경로 중 **실제로 도달 가능한 것만**
추가한다:

- 지갑 항목이 없는 신규 계정의 `getWallet()`이 `DEFAULT_WALLET`을 반환
- 잔액 0인 신규 계정의 `buyAvatar("bean")`이 `broke`로 거부
- `buyAvatar("nope")`가 `unknown`으로 거부
- 미소유 `equipAvatar("tank")` 거부
- `equipAvatar("classic")`은 기본 소유물이므로 성공

라운드 종료 시 적립은 `coinsFor`의 순수 검증 + `endRound`가 그것을 호출한다는
코드 리뷰로 커버한다. 리더보드가 같은 자리에 남긴 미검증 항목과 동일한 성격이며
README 알려진 한계에 함께 적는다.

## 영향받지 않는 것

- `MOVE`, `CAMERA`, `TAG`, 서버 이동 검증(`MOVE_SPEED_CAP` 등) — 체형이 충돌·
  카메라 봉투 안에 갇혀 있으므로 한 줄도 바뀌지 않는다.
- 걷기·점프·착지·포즈 애니메이션 — 전부 피벗 회전이라 프로필과 무관.
- 페인트 시스템 전체 — 부위 구성이 그대로라 UV 아틀라스가 그대로 동작.
- 리더보드 — 별도 콜렉션이라 쿼리·랭킹 로직 무변경.
- 매치 화면 UI — 상점은 허브 전용.

## 범위 밖 (의도적)

- 아바타별 성능 차이 / 트레이드오프 밸런싱
- 액세서리, 텍스처 프리셋, 색상 스킨
- 코인 선물·거래, 실제 결제(VXShop)
- 아바타 미리보기 회전을 마우스로 직접 돌리기

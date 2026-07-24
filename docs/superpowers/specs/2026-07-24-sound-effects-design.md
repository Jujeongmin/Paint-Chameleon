# 사운드 이펙트 설계 (2026-07-24)

## 배경

README의 "알려진 한계" 5번: 사운드 없음. 이번 작업으로 일부 채운다.

## 범위

- **소스**: 전부 Web Audio API로 코드 합성. 외부 음향 파일 없음 — 이 프로젝트가
  3D 에셋을 전부 절차 생성해 라이선스 문제를 피하는 것과 같은 원칙([README.md](../../../README.md)
  상단 저작권 안내). 번들 크기 증가 거의 없음.
- **커버하는 이벤트**: 술래 캐치, 페인트 브러시, 라운드 전환(숨는 시간 시작 / 결과
  발표), 음소거 토글.
- **범위 밖**: 점프/착지 사운드(사용자가 명시적으로 제외). 발소리, 포털/UI 클릭음,
  배경음악 — 전부 이번 범위 밖(추후 별도 작업).
- **범위 밖**: 원격 플레이어 이벤트 기반 거리 감쇠 — 이번 범위의 세 이벤트(캐치,
  브러시, 라운드 전환)는 전부 "내 화면에 보이는 UI/내 조작" 기준으로 트리거되는
  이벤트라, 위치 기반 공간음향이 필요 없다. 전부 풀볼륨(음소거 여부만 적용).

## 아키텍처

`src/audio/sound.ts` 단일 모듈. `AudioContext`를 지연 생성(모듈 스코프 싱글턴)하고,
`OscillatorNode`/`GainNode`(필요시 `AudioBufferSourceNode`로 짧은 화이트노이즈)를
조합해 각 효과음을 그때그때 합성한다. 재생 대상 파일이 없으므로 프리로드/디코딩
지연이 없다.

```ts
// src/audio/sound.ts
export function unlockAudio(): void;      // 첫 유저 제스처에서 1회 — AudioContext 생성/resume
export function playCatch(): void;
export function playBrushTick(): void;
export function playRoundStart(): void;
export function playResults(won: boolean): void;
export function isMuted(): boolean;
export function toggleMuted(): void;      // localStorage("pc-muted")에 저장, 즉시 반영
```

내부적으로 모든 `play*` 함수는 시작부에 `if (isMuted() || !ctx) return;`으로 조기 종료한다.
브라우저의 autoplay 정책상 `AudioContext`는 유저 제스처 없이 생성/resume이 안 되므로,
`unlockAudio()`는 이미 존재하는 첫 유저 상호작용 지점(닉네임 입력 후 "게임 참가" 버튼
클릭, `Screens.tsx`)에서 호출한다.

## 연결 지점

| 이벤트 | 위치 | 트리거 조건 |
|---|---|---|
| 캐치 | `src/App.tsx` | `me.caught` 또는 다른 hider의 `caught`가 false→true로 바뀌는 프레임(useEffect + ref로 이전 상태 비교) |
| 브러시 | `src/game/LocalPlayer.tsx`의 `handleDab` | dab이 실제로 호출될 때마다, 단 마지막 재생 후 100ms 이내면 스킵(스로틀) |
| 라운드 시작 | `src/App.tsx` | `room.phase`가 다른 값 → `"hiding"`으로 바뀌는 프레임 |
| 라운드 결과 | `src/App.tsx` | `room.phase`가 다른 값 → `"results"`로 바뀌는 프레임. `playResults(won)`의 `won`: 내 역할이 hider면 `!me.caught`; seeker면 `room.lastResults.find(r => r.account === me.account)?.gained > 0`(서버의 `endRound`가 seeker 항목의 `gained`를 `catches * SCORE.seekerPerCatch`로 채우므로, 0보다 크면 그 라운드에 최소 1명 잡았다는 뜻 — `server/src/server.ts`의 `endRound` 참고) |
| 음소거 토글 | `src/ui/Hud.tsx` | 새 버튼 클릭 → `toggleMuted()` |

모든 트리거는 기존 컴포넌트에 `useEffect`/콜백 몇 줄을 추가하는 식이며, 새 컴포넌트를
만들지 않는다.

## 사운드 디자인 (합성 방식, 대략적 스펙)

- **캐치**: 짧고 또렷한 "띵" — 사각파/삼각파 오실레이터 하나, 피치가 살짝 아래로
  떨어지는 짧은 envelope(~200ms).
- **브러시 틱**: 아주 짧은 화이트노이즈 버스트(~30ms) + 저역 필터 — "사각" 느낌.
- **라운드 시작**: 상승하는 2음 신호음(~400ms).
- **결과(승리/패배)**: 승리는 밝은 장3화음 아르페지오, 패배는 낮은 단음 — 둘 다
  ~600ms 이내.

정확한 주파수/길이는 구현 중 귀로 들어보면서 조정한다(계획에는 시작값만 명시하고,
"들어보고 조정" 스텝을 둔다).

## 에러 처리

- `AudioContext` 생성 자체가 실패하거나(구형 브라우저) `unlockAudio()`가 호출되기
  전에 어떤 `play*`가 호출되면, 조용히 무시한다(throw 없음) — 사운드는 부가 기능이라
  실패해도 게임 진행에 영향이 없어야 한다.
- `localStorage` 접근이 막힌 환경(사파리 프라이빗 모드 등)에서는 `isMuted()`가
  기본값(꺼짐, 즉 "음소거 아님")으로 동작하고 저장은 조용히 실패한다.

## 테스트

Web Audio 자체(실제로 소리가 나는지)는 헤드리스로 검증 불가 — 브라우저에서 직접
듣는다. 대신 순수 로직은 검증 가능:

1. `scripts/check-audio.ts`(신규, `npm run check`에 편입): 브러시 틱 스로틀 로직을
   시간 모킹 없이 순수 함수로 뽑아서(`shouldPlayBrushTick(now, lastPlayedAt, throttleMs)`
   같은 형태) 여러 시각 시퀀스로 검증 — 100ms 이내 연속 호출은 1번만 통과하는지 등.
2. 음소거 토글의 localStorage 직렬화/역직렬화(문자열 "1"/"0" 또는 JSON) 왕복 검증.

`play*` 함수 자체(오실레이터 생성 등)는 jsdom/헤드리스 환경에 `AudioContext`가 없어
테스트 대상에서 제외 — 대신 `unlockAudio()`/`play*`가 `AudioContext`가 없을 때
throw하지 않고 조용히 리턴하는지는 검증 가능(생성자를 주입 가능하게 만들면 mock으로
"없는 척"할 수 있음).

## 영향받지 않는 것

- 서버 코드(`server/*`) — 전혀 관련 없음, 사운드는 순수 클라이언트 로컬 재생.
- 이동/충돌/페인트 로직 자체 — 사운드는 기존 이벤트에 얹는 것뿐, 게임플레이 로직
  변경 없음.

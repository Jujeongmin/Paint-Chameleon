# 사운드

전부 **Kenney** (https://kenney.nl) 의 **CC0** 사운드입니다 —
[Creative Commons Zero](http://creativecommons.org/publicdomain/zero/1.0/),
퍼블릭 도메인. **출처 표기 의무도, 상업 이용 제한도 없습니다.**
`public/models/`의 3D 킷과 같은 출처·같은 라이선스라, 이 프로젝트의 에셋
라이선스는 여전히 한 줄입니다.

## 어떤 파일이 어디서 왔는지

| 쓰는 곳 | 파일 | 원본 | 팩 |
|---|---|---|---|
| 사격 (전자음 부분) | `shot.ogg` | `glitch_004.ogg` | Interface Sounds |
| 포획 · 전환 | `catch.ogg` | `impactPunch_medium_000.ogg` | Impact Sounds |
| 숨는 시간 시작 | `round-start.ogg` | `confirmation_001.ogg` | Interface Sounds |
| 추적 시작 | `hunt-start.ogg` | `bong_001.ogg` | Interface Sounds |
| 결과 — 승 | `win.ogg` | `confirmation_004.ogg` | Interface Sounds |
| 결과 — 패 | `lose.ogg` | `error_006.ogg` | Interface Sounds |
| 붓 틱 | `brush.ogg` | `tick_002.ogg` | Interface Sounds |

받은 팩 세 개(Impact Sounds 133개, Interface Sounds 103개, UI Audio 55개)에서
**7개만 골라 넣었습니다.** `public/`은 통째로 배포에 실리므로(`public/README.md`),
안 쓰는 284개와 zip 2MB를 두면 그대로 플레이어에게 내려갑니다. 지금 80KB입니다.

원본 zip은 저장소에 없습니다. 더 필요하면 kenney.nl에서 다시 받으세요 —
회원가입도, 결제도 필요 없습니다.

## 포맷

**OGG Vorbis**, Kenney가 배포한 그대로 — 재인코딩하지 않았습니다. MP3는 인코딩이
파일 앞뒤에 짧은 무음을 넣어서 이음매 없는 루프가 안 되는데, 지금은 전부 원샷이라
문제가 없고 나중에 배경음을 넣을 때를 대비해 포맷을 통일해 둡니다.

## 총소리만 절반이 합성입니다

Kenney의 세 팩에는 **총기 소리가 없습니다** — 발소리, 충돌음, 인터페이스 클릭이
전부입니다. 금속 충돌음은 총소리가 아닙니다. 그래서 `shot.ogg`(전자음 크랙)를
쓰고 그 아래 저역 thump는 여전히 오실레이터로 만듭니다. `game/src/audio/sound.ts`의
`playShot`을 보세요.

## 아직 안 쓴 것 중 쓸 만한 것

`kenney_impact-sounds`에 **발소리가 표면별 5종 × 5변형**으로 들어 있습니다
(`footstep_concrete`, `_wood`, `_carpet`, `_grass`, `_snow`). 넣으면 아레나에
발소리가 생기는데, 이건 **밸런스 변경입니다** — 하이더가 술래가 다가오는 걸 듣게
됩니다. 소리 이상의 결정이라 손대지 않았습니다.

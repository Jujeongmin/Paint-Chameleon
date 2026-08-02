# Verse8에 올리기

이 저장소는 **두 곳**에 올라갑니다.

| 별명 | 어디 | 브랜치 |
|---|---|---|
| `origin` | GitHub — `Jujeongmin/Paint-Chameleon` | `dev` |
| `verse8` | GitLab — `gitlab.verse8.io/anjshdkdl99/…` | `develop` |

브랜치 이름이 다릅니다. Verse8은 `develop`을 쓰고 우리는 `dev`를 씁니다.

---

## ⚠️ Verse8 안내문의 파일 목록은 부족합니다

Verse8이 주는 안내는 "`game/` · `package.json` · `vite.config.js` 를 복사"
라고 합니다. **이 프로젝트는 그것만으론 안 돕니다.**

| 빠진 것 | 없으면 |
|---|---|
| `server/` | 라운드·페이즈·매칭·포획·리더보드·지갑이 전부 여기. **게임 자체가 없음** |
| `public/` | 모델·텍스처·사운드 약 5MB. 빈 아레나가 됨 |
| `tsconfig.json` | `npm run build`가 `tsc -b`를 먼저 돌림 |

그리고 안내문은 `vite.config.js`라고 하지만 이 프로젝트는 `vite.config.ts`
입니다. Vite는 둘 다 읽으므로 그대로 두면 됩니다.

**그래서 파일을 복사하지 말고 리모트를 하나 더 두십시오.** 목록을 손으로
맞출 일이 없어지고, 커밋 히스토리도 따라갑니다.

---

## 처음 한 번만

### 1. 토큰 발급

verse8.io 프로젝트 → `⋯` → **Git Access** → **Generate Token**

**토큰은 한 번만 표시됩니다.** 다이얼로그를 닫으면 재발급뿐입니다. 나오는
`git clone` 명령에서 `https://` 부터 `.git` 까지가 주소입니다.

토큰을 채팅·이슈·커밋에 붙여넣지 마십시오. 노출되면 즉시 폐기하고 재발급.

### 2. 리모트 등록 (PowerShell)

```powershell
cd C:\Users\anshd\Desktop\Paint-Chameleon
git remote add verse8 'https://oauth2:토큰@gitlab.verse8.io/anjshdkdl99/…git'
```

**작은따옴표가 필수입니다.** 주소에 `@`가 들어 있고 PowerShell에서 `@`는
splatting 연산자입니다. 큰따옴표를 쓰면 `$`가 변수로 해석돼 토큰이 잘립니다.

### 3. 확인

```powershell
git config --get remote.verse8.url
```

**한 줄로**, `.git`으로 끝나야 합니다.

### 4. 첫 푸시

```powershell
git push verse8 dev:develop
```

`dev:develop` = "내 `dev`를 저쪽 `develop`으로". 이름이 다르므로 `dev`만
쓰면 안 됩니다.

---

## 그 뒤로는

```powershell
git push origin dev
git push verse8 dev:develop
```

한 줄로 묶으려면 (Windows PowerShell 5.1에는 `&&`가 없습니다):

```powershell
git push origin dev; if ($?) { git push verse8 dev:develop }
```

---

## 실제로 겪은 에러들

### `url contains a newline in its path component`

주소에 줄바꿈이 들어갔습니다. 웹에서 복사할 때 줄바꿈과 `/`가 딸려옵니다.

```powershell
git remote set-url verse8 '한 줄짜리 주소'
```

메모장에 먼저 붙여넣어 한 줄인지 확인한 뒤 다시 복사하는 것이 확실합니다.

### `error: remote verse8 already exists`

`add`는 **만드는** 명령이라 이미 있으면 거부합니다. 고칠 때는 `set-url`:

```powershell
git remote set-url verse8 '주소'
```

### `! [rejected] dev -> develop (fetch first)`

저쪽 `develop`에 이미 커밋이 있습니다(Verse8이 만든 스캐폴드). 먼저 보고:

```powershell
git fetch verse8
git log --oneline verse8/develop
```

스캐폴드뿐이면 덮어씁니다. **저쪽 커밋은 사라집니다** — 새로 만든 빈
프로젝트에서만 쓰십시오:

```powershell
git push verse8 dev:develop --force
```

### `git remote set-url origin …` 을 쓰라던데?

Verse8 페이지가 주는 그 명령은 **다른 상황용**입니다. 저쪽은 여러분이
자기네 빈 레포를 클론했다고 가정하므로 `origin`이 이미 Verse8이고, `set-url`은
토큰 갱신용입니다. 우리 `origin`은 GitHub이므로, 저걸 쓰면 **GitHub 연결이
사라집니다.**

---

## 올린 다음

`git ls-remote --heads verse8` 에 `refs/heads/develop`이 보이고, verse8.io
웹에서 **`game`·`server`·`public` 세 폴더가 다 보이면** 성공입니다.

### 로컬과 Verse8은 다른 모드로 돕니다

`VITE_AGENT8_VERSE`가 없으면 오프라인 리허설(혼자 + 하이더 봇 4명)로 돕니다
(`game/src/net/useGame.ts`). Verse8은 이 값을 넣어주고, 그때부터 진짜
멀티플레이입니다. **그래서 거기서만 확인되는 것들이 있습니다** — README
"알려진 한계" 4·6·7·9번, 그리고 tag 모드의 전환(사람 둘 필요).

---

## 배포와 401

`npx -y @agent8/deploy` 를 그냥 실행하면 **반드시 401입니다.**

```
POST https://verse8-game-backend-…/verses/<verse-id>/files
{"message":"No access token provided","error":"Unauthorized","statusCode":401}
```

v1.5.5 소스 기준으로 **기본 모드는 Authorization 헤더를 붙이지 않습니다.**
토큰이 틀린 게 아니라 안 보낸 것이라, **재시도로는 절대 안 풀립니다.** 에디터
에이전트가 여기서 무한 재시도에 빠진 적이 있습니다.

토큰을 싣는 것은 `--preview` / `--prod` 뿐이고, `V8_ACCESS_TOKEN` 을
`Authorization: Bearer` 로 보냅니다.

```bash
V8_ACCESS_TOKEN=… npx -y @agent8/deploy --preview
```

verse/account 는 CLI 인자 → `.agent8.lock`(정본) → `.env`(사본) 순으로 읽으니
따로 줄 필요가 없습니다.

### 막혔을 때 절대 하면 안 되는 것

**`.agent8.lock` 이나 `.env` 를 고치거나 지우지 마십시오.** 파일 첫 줄이
"DO NOT EDIT OR DELETE — 값을 바꾸면 배포된 게임·서버 데이터와의 연결이
끊긴다"고 적고 있습니다. 401은 그 파일들과 아무 관계가 없습니다. 막힌
에이전트가 "고치려고" 저기 손대는 것이 이 상황의 진짜 위험입니다.

`.deployed` 는 배포 도구가 업로드 해시를 적는 자기 파일입니다. 실패한 배포의
해시가 남아 다음 배포를 헷갈리게 하면 지워도 됩니다 — 플랫폼 관리 파일이
아닙니다.

---

## Verse8 에디터 프롬프트

가장 큰 위험은 **에디터의 AI가 이미 돌아가는 코드를 다시 쓰는 것**입니다.
검사 18개와 클라이언트↔서버 미러가 여럿이라, 좋은 뜻으로 손대면 조용히
깨집니다. 프롬프트를 방어적으로 쓰십시오.

### 어느 프롬프트에나 붙일 규칙

```
이 저장소 규칙:
- npm run check 가 항상 초록이어야 해. 검사 18개 + 서버 테스트 22개.
- server/src/rules.ts 의 값 중 상당수가 game/src 에 미러돼 있고
  scripts/check-sync.ts 가 대조해. 한쪽만 바꾸면 빨개져.
- 주석은 "무엇"이 아니라 "왜"를 적어. 기존 주석을 지우지 마.
- 검사를 새로 쓰면 대상을 일부러 깨뜨려서 빨간불을 본 다음에 믿어.
```

### 1) 파악만, 수정 금지

```
이 저장소는 이미 완성된 게임이야. 코드를 새로 쓰거나 리팩터링하지 마.

먼저 README.md 와 HANDOFF.md 를 읽어. 그 다음 이것만 답해줘:
1. server/src/server.ts 를 Verse8에서 실행하려면 뭘 해야 해?
2. VITE_AGENT8_VERSE 는 Verse8이 자동으로 넣어줘, 내가 설정해야 해?
3. npm run check 결과. 실패가 있으면 고치지 말고 무엇이 왜 실패하는지만 보고해.

아무것도 수정하지 마. 답변만 해.
```

### 2) 실행

```
게임을 Verse8에서 실행되게 해줘. 규칙:
- game/, server/, public/, scripts/ 의 기존 코드는 수정하지 마.
- 빌드 설정은 꼭 필요한 경우에만 최소한으로, 뭘 왜 바꿨는지 말해줘.
- 서버는 server/src/server.ts 하나뿐이야. 새로 만들지 마.
- 끝나면 npm run check 통과 확인.
배포는 아래 "배포와 401"을 먼저 읽어. 맨 npx -y @agent8/deploy 는 401이야.
```

### 3) 닉네임 계정 저장 — 남아 있는 유일한 서버 작업

```
game/src/net/profile.ts 를 읽어. 계정별 닉네임 저장의 뼈대만 있고 서버
구현이 비어 있어. 그 파일 맨 위 주석에 할 일이 순서대로 적혀 있으니 그대로
구현해줘.

주의:
- 클라이언트 호출부는 이미 배선돼 있어. App.tsx 는 건드릴 필요 없어.
- WalletState 에 nick 을 추가하면 클라이언트 미러도 있는지 확인하고
  scripts/check-sync.ts 에 비교를 추가해.
- 허브에 닉을 바꿀 수 있는 곳을 반드시 만들어. 저장되면 닉 화면이 안 뜨니까
  없으면 오타가 영구야.
- 끝나면 npm run check 통과 확인.
```

### 4) 배포 후에만 알 수 있는 것

```
배포된 환경에서 다음을 확인하고 결과만 알려줘. 코드는 고치지 마.
1. $global 콜렉션("leaderboard", "wallets")이 서버 재시작을 넘어 유지되는지.
   로컬 구현은 인메모리라 로컬에선 확인 불가능해.
2. $roomTick 의 실제 호출 주기(ms). NET_THROTTLE_MS 가 여기 맞춰져 있어.
3. 임베드가 iframe 이면 allow="pointer-lock" 이 있는지. 없으면 마우스
   고정이 거부되고 자유 시점으로 폴백해.
```

순서: **1 → 2 → 거기서 직접 플레이 → 3 → 4.**

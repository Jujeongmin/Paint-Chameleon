import { useSyncExternalStore } from "react";

/**
 * Every word the game says, in both languages it says them in.
 *
 * ENGLISH IS THE DEFAULT and Korean is the option, which is a reversal — the
 * whole UI was written in Korean. The reason to flip it is reach: this build
 * deploys to a portal whose players are not all Korean speakers, and a game
 * whose first screen is in a language you cannot read is a game you close.
 *
 * ONE FLAT TABLE, NOT NESTED NAMESPACES. There are about eighty strings. A tree
 * would buy nothing but a longer key to type, and the flat shape is what makes
 * check:i18n's job trivial: the two records must have exactly the same keys,
 * and no value may be blank. A missing translation is then a red check rather
 * than an English word appearing in the middle of a Korean sentence.
 *
 * The table is the source of truth for what CAN be said. Anything not in here
 * cannot be shown to a player, which is the point — a literal typed into a
 * component is a string that will never be translated and nobody will notice
 * until somebody reads it in the wrong language.
 */

export type Lang = "en" | "ko";

export const LANGS: Lang[] = ["en", "ko"];

/** What each language calls itself. Never translated — that is the convention. */
export const LANG_NAMES: Record<Lang, string> = { en: "English", ko: "한국어" };

const EN = {
  // --- entry
  "app.title": "Paint Chameleon",
  "app.tagline": "Paint yourself the colour of the room and hold still.\nA good corner, a good angle, and a steady brush.",
  "app.connecting": "Connecting…",
  "app.enteringLobby": "Entering the lobby…",
  "app.nickname": "Nickname",
  "app.join": "Play",
  "app.joining": "Joining…",
  "app.defaultNick": "Chameleon",
  "app.anon": "Anonymous",
  "app.you": " (you)",

  // --- loading
  "load.preparing": "Getting ready",
  "load.models": "Downloading models",
  "load.textures": "Downloading surfaces",
  "load.weapon": "Downloading the blaster",
  "load.parsing": "Preparing models",
  "load.terrain": "Mapping the arena",
  "load.done": "Ready",

  // --- phases and roles
  "phase.lobby": "Waiting",
  "phase.hiding": "Hiding",
  "phase.seeking": "Hunt",
  "phase.results": "Results",
  "role.seeker": "Seeker",
  "role.hider": "Hider",
  "role.pinned": "Pinned",

  // --- modes
  "mode.tag.label": "PAINT CHAMELEON",
  "mode.tag.sub": "Infection",
  "mode.hunt.label": "LAST ONE STANDING",
  "mode.hunt.sub": "Survival",

  // --- match HUD
  "hud.round": "Round {n}",
  "hud.roundPlayers": "Round {n} · {c} players",
  "hud.remaining": "Left",
  "hud.ready": "Ready up",
  "hud.unready": "Not ready",
  "hud.pose": "Pose",
  "hud.paint": "Paint",
  "hud.paintWhenHiding": "Hiding phase only",
  "hud.leave": "Leave to lobby",
  "hud.caught.title": "Caught",
  "hud.caught.body": "Watching the rest of the round for now",
  "hud.out.title": "Out",
  "hud.out.body": "Free camera until the round ends",
  "hud.cellNote": "Hunt starts in {n}s · {c} hiding",
  "hud.waiting.title": "Waiting for players",
  "hud.waiting.body": "{c}/{n} · starts when everyone is ready",

  // --- controls
  "key.move": "Move",
  "key.jump": "Jump",
  "key.look": "Look",
  "key.poseAction": "Pose",
  "key.pinOn": "Unpin",
  "key.pinOff": "Pin body",
  "key.shoot": "Shoot",
  "key.shop": "Shop",

  // --- results
  "results.caughtN": "{n} caught",
  "results.ofN": "of {n} hiding",
  "results.found": "You were found",
  "results.foundSub": "Next round, then",
  "results.survived": "You survived",
  "results.survivedSub": "Never spotted",
  "results.next": "Next round in {n}s",
  "results.statSeeker": "Seeker",
  "results.statCaught": "Caught",
  "results.statSurvived": "Survived",

  // --- hub
  "hub.title": "Lobby",
  "hub.online": "{n} here",
  "hub.coins": "coins",
  "hub.people": "Who's here",
  "hub.matching": "Finding a match…",
  "hub.matchingSub": "One moment",
  "hub.portalHold": "Keep standing here to enter",
  "hub.portalLocked": "Not open yet",
  "hub.shopSign": "AVATAR SHOP",
  "hub.leaderboard": "LEADERBOARD",
  "hub.hallOfFame": "HALL OF FAME",
  "hub.noScores": "No scores yet",

  // --- shop
  "shop.loading": "Loading…",
  "shop.equipping": "Equipping",
  "shop.broke": "Not enough coins",
  "shop.free": "Free",
  "shop.price": "{n} coins",
  "shop.buy": "Buy",
  "shop.equip": "Equip",
  "shop.equipped": "Equipped",
  "shop.bought": "Bought",
  "shop.owned": "Already owned",
  "shop.notForSale": "Not for sale",
  "shop.cannotEquip": "Can't equip that",
  "shop.tryAgain": "Try again in a moment",

  // --- paint
  "paint.picker": "Pick a colour from a wall, the floor, or your own body",
  "paint.fill": "Flood the whole body with the current colour",
  "paint.hintPicker": "Eyedropper — click a wall, the floor, or yourself to take its colour",
  "paint.hintBrush": "Drag on your body to paint, drag empty space to turn · wheel zooms · Shift+wheel resizes the brush",
  "paint.poseMenu": "Choose a pose",
  "paint.closeMenu": "Close (G)",
  "paint.timeLeft": " · {n}s left",
  "paint.backToHub": "Back to the lobby",

  // --- poses
  "pose.stand": "Stand",
  "pose.lie": "Lie down",
  "pose.reach": "Reach up",
  "pose.crouch": "Crouch",

  // --- avatars
  "body.classic": "Classic",
  "body.box": "Boxy",
  "body.tank": "Tank",

  // --- bots
  "bot.0": "Pickle",
  "bot.1": "Sesame",
  "bot.2": "Mackerel",
  "bot.3": "Seaweed",
  "bot.4": "Crust",
  "bot.5": "Gardenia",
  "bot.6": "Parsley",

  // --- errors
  "error.join": "Couldn't get in",
  "error.match": "Couldn't find a match",
  "error.hub": "Couldn't get back to the lobby",

  // --- settings
  "settings.soundOn": "Turn sound on",
  "settings.soundOff": "Turn sound off",
  "settings.language": "Language",
} as const;

export type Key = keyof typeof EN;

const KO: Record<Key, string> = {
  "app.title": "Paint Chameleon",
  "app.tagline": "주변 색으로 몸을 칠하고 자세를 잡아 술래를 속이세요.\n잘 숨은 곳, 좋은 각도, 그리고 붓질이 전부입니다.",
  "app.connecting": "서버에 연결하는 중…",
  "app.enteringLobby": "로비에 들어가는 중…",
  "app.nickname": "닉네임",
  "app.join": "게임 참가",
  "app.joining": "입장 중…",
  "app.defaultNick": "카멜레온",
  "app.anon": "익명",
  "app.you": " (나)",

  "load.preparing": "준비하는 중",
  "load.models": "모델 내려받는 중",
  "load.textures": "표면 내려받는 중",
  "load.weapon": "무기 내려받는 중",
  "load.parsing": "모델 준비 중",
  "load.terrain": "지형 계산 중",
  "load.done": "준비 완료",

  "phase.lobby": "대기 중",
  "phase.hiding": "숨는 시간",
  "phase.seeking": "추적",
  "phase.results": "결과",
  "role.seeker": "술래",
  "role.hider": "숨는 사람",
  "role.pinned": "고정됨",

  "mode.tag.label": "PAINT CHAMELEON",
  "mode.tag.sub": "술래 늘리기",
  "mode.hunt.label": "LAST ONE STANDING",
  "mode.hunt.sub": "생존",

  "hud.round": "라운드 {n}",
  "hud.roundPlayers": "라운드 {n} · {c}명",
  "hud.remaining": "남은 사람",
  "hud.ready": "준비 완료",
  "hud.unready": "준비 취소",
  "hud.pose": "자세",
  "hud.paint": "페인트",
  "hud.paintWhenHiding": "숨는 시간에만",
  "hud.leave": "로비로 나가기",
  "hud.caught.title": "잡혔습니다",
  "hud.caught.body": "라운드가 끝날 때까지 관전합니다",
  "hud.out.title": "탈락",
  "hud.out.body": "자유 시점으로 남은 라운드를 지켜봅니다",
  "hud.cellNote": "{n}초 후 추적이 시작됩니다 · 숨는 사람 {c}명",
  "hud.waiting.title": "플레이어 대기 중",
  "hud.waiting.body": "{c}/{n}명 · 모두 준비되면 시작합니다",

  "key.move": "이동",
  "key.jump": "점프",
  "key.look": "시점",
  "key.poseAction": "자세",
  "key.pinOn": "고정 해제",
  "key.pinOff": "캐릭터 고정",
  "key.shoot": "사격",
  "key.shop": "상점",

  "results.caughtN": "{n}명 잡았습니다",
  "results.ofN": "숨은 사람 {n}명 중",
  "results.found": "발각됐습니다",
  "results.foundSub": "다음 라운드에 다시",
  "results.survived": "살아남았습니다",
  "results.survivedSub": "끝까지 들키지 않았습니다",
  "results.next": "{n}초 후 다음 라운드",
  "results.statSeeker": "술래",
  "results.statCaught": "발각",
  "results.statSurvived": "생존",

  "hub.title": "로비",
  "hub.online": "{n}명 접속 중",
  "hub.coins": "코인",
  "hub.people": "여기 있는 사람들",
  "hub.matching": "매칭 중…",
  "hub.matchingSub": "잠시만 기다려주세요",
  "hub.portalHold": "계속 서 있으면 입장합니다",
  "hub.portalLocked": "아직 준비되지 않았습니다",
  "hub.shopSign": "아바타 상점",
  "hub.leaderboard": "리더보드",
  "hub.hallOfFame": "명예의 전당",
  "hub.noScores": "아직 기록이 없습니다",

  "shop.loading": "불러오는 중…",
  "shop.equipping": "장착 중",
  "shop.broke": "코인 부족",
  "shop.free": "기본 지급",
  "shop.price": "{n} 코인",
  "shop.buy": "구매",
  "shop.equip": "장착",
  "shop.equipped": "장착됨",
  "shop.bought": "구매했습니다",
  "shop.owned": "이미 가지고 있습니다",
  "shop.notForSale": "판매하지 않는 아바타입니다",
  "shop.cannotEquip": "장착할 수 없습니다",
  "shop.tryAgain": "잠시 후 다시 시도해주세요",

  "paint.picker": "주변 벽·바닥이나 자기 몸에서 색을 뽑습니다",
  "paint.fill": "전체를 현재 색으로",
  "paint.hintPicker": "스포이드 — 벽·바닥이나 자기 몸을 클릭해 색을 뽑으세요",
  "paint.hintBrush":
    "몸을 드래그해 칠하고, 빈 공간을 드래그해 시점을 돌리세요 · 휠로 확대 · Shift+휠로 붓 크기",
  "paint.poseMenu": "자세 고르기",
  "paint.closeMenu": "닫기 (G)",
  "paint.timeLeft": " · {n}초 남음",
  "paint.backToHub": "로비로 돌아가기",

  "pose.stand": "서기",
  "pose.lie": "눕기",
  "pose.reach": "만세",
  "pose.crouch": "앉기",

  "body.classic": "클래식",
  "body.box": "네모",
  "body.tank": "떡대",

  "bot.0": "단무지",
  "bot.1": "참깨",
  "bot.2": "고등어",
  "bot.3": "물미역",
  "bot.4": "누룽지",
  "bot.5": "치자",
  "bot.6": "미나리",

  "error.join": "입장에 실패했습니다",
  "error.match": "매칭에 실패했습니다",
  "error.hub": "로비로 돌아가지 못했습니다",

  "settings.soundOn": "소리 켜기",
  "settings.soundOff": "소리 끄기",
  "settings.language": "언어",
};

export const STRINGS: Record<Lang, Record<Key, string>> = { en: EN, ko: KO };

// --------------------------------------------------------------- the current

const STORAGE_KEY = "pc.lang";

function initial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ko") return saved;
  } catch {
    // Private mode, or storage disabled. Not worth failing over.
  }
  // English regardless of the browser's own language. Guessing from
  // navigator.language would mean two players in the same room seeing different
  // words for the same button, and the setting exists precisely so the choice
  // is the player's rather than a header's.
  return "en";
}

let current: Lang = initial();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // As above — the choice just won't survive a reload.
  }
  for (const l of listeners) l();
}

/**
 * Look up a string, filling {placeholders} from `params`.
 *
 * Callable from outside React on purpose: the warmup labels, the wallet's
 * messages and the leaderboard's canvas text are all produced away from a
 * component, and forcing them through a hook would mean either duplicating the
 * table or passing a translator down four layers.
 */
export function t(key: Key, params?: Record<string, string | number>): string {
  const raw = STRINGS[current][key] ?? STRINGS.en[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name) =>
    name in params ? String(params[name]) : whole
  );
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/**
 * Re-render this component when the language changes.
 *
 * Returns the translator rather than the language so a component reads
 * `const t = useT()` and then uses it exactly like the module-level `t` — the
 * two call sites look identical, which is what stops anyone importing the
 * non-reactive one into a component by accident.
 */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLang, () => "en" as Lang);
  return t;
}

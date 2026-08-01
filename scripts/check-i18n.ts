/**
 * The string table, and the promise that nothing is missing from it.
 *
 * The failure this exists to stop is quiet: a key added in English and
 * forgotten in Korean falls back to English at runtime, so the game keeps
 * working and one word on the screen is simply in the wrong language. Nobody
 * notices until a player does. Same for a placeholder that survives in one
 * language and not the other — "{n} caught" reading literally as "{n}" is the
 * kind of thing that ships.
 *
 * It also checks the things that name themselves through the table: every game
 * mode, pose, avatar and bot points at a key rather than carrying words, and a
 * key that does not exist would render as the key itself.
 *
 * Run: npm run check:i18n
 */

import { LANGS, LANG_NAMES, STRINGS, t, setLang, getLang, type Key, type Lang } from "../game/src/ui/i18n";
import { MODE_TEXT } from "../game/src/game/modes";
import { GAME_MODE_IDS } from "../server/src/rules";
import { POSES } from "../game/src/game/constants";
import { BODIES } from "../game/src/game/bodies";
import { BOT_NAME_KEYS } from "../game/src/game/bot";
import { PORTALS, STANDS } from "../game/src/hub/hubMap";
import { readFileSync } from "node:fs";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

const BASE: Lang = "en";
const keys = Object.keys(STRINGS[BASE]) as Key[];

console.log(`\n${keys.length} strings, ${LANGS.length} languages`);
{
  check("English is the default", getLang() === "en", `got ${getLang()}`);
  check(
    "every language names itself in its own language",
    LANGS.every((l) => LANG_NAMES[l] && LANG_NAMES[l].length > 0),
    JSON.stringify(LANG_NAMES)
  );
}

console.log("\nno language is missing anything");
for (const lang of LANGS) {
  const theirs = Object.keys(STRINGS[lang]) as Key[];

  const missing = keys.filter((k) => !(k in STRINGS[lang]));
  check(`${lang}: has every key (${theirs.length})`, missing.length === 0, missing.slice(0, 5).join(", "));

  const extra = theirs.filter((k) => !keys.includes(k));
  check(`${lang}: has no keys the others lack`, extra.length === 0, extra.slice(0, 5).join(", "));

  const blank = keys.filter((k) => !STRINGS[lang][k] || !STRINGS[lang][k].trim());
  check(`${lang}: nothing is blank`, blank.length === 0, blank.slice(0, 5).join(", "));
}

console.log("\nplaceholders match across languages");
{
  // A string that takes {n} in one language and not in the other is a sentence
  // that loses its number when translated — and it would render perfectly, just
  // without the fact it was there to carry.
  const holders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(",");
  const wrong: string[] = [];
  for (const k of keys) {
    const want = holders(STRINGS[BASE][k]);
    for (const lang of LANGS) {
      if (lang === BASE) continue;
      const got = holders(STRINGS[lang][k] ?? "");
      if (got !== want) wrong.push(`${k}: ${BASE}="${want || "none"}" ${lang}="${got || "none"}"`);
    }
  }
  check(`every string carries the same placeholders in each language`, wrong.length === 0, wrong.slice(0, 5).join("\n      "));
}

console.log("\nthe things that name themselves through the table");
{
  const has = (k: string): boolean => keys.includes(k as Key);

  for (const id of GAME_MODE_IDS) {
    const text = MODE_TEXT[id];
    check(`mode ${id} has a label and a subtitle`, !!text && has(text.labelKey) && has(text.subKey));
  }
  check(
    "the client knows the same modes as the server",
    Object.keys(MODE_TEXT).sort().join() === [...GAME_MODE_IDS].sort().join(),
    `${Object.keys(MODE_TEXT)} vs ${GAME_MODE_IDS}`
  );

  check(`all ${POSES.length} poses have a name`, POSES.every((p) => has(p.labelKey)));
  check(`all ${BODIES.length} avatars have a name`, BODIES.every((b) => has(b.nameKey)));
  check(`all ${BOT_NAME_KEYS.length} bot names exist`, BOT_NAME_KEYS.every(has));
  check(`all ${STANDS.length} shop stands have a name`, STANDS.every((s) => has(s.nameKey)));
  check(
    `all ${PORTALS.length} portals have a name`,
    PORTALS.every((p) => has(p.labelKey) && (p.subKey === null || has(p.subKey)))
  );
}

console.log("\nthe translator itself");
{
  check("a plain string comes back as itself", t("app.title") === STRINGS.en["app.title"]);
  check("a placeholder is filled", t("hud.round", { n: 4 }) === "Round 4");
  check(
    "a missing parameter is left visible rather than blanked",
    t("hud.round", {}).includes("{n}"),
    "a silently empty sentence is harder to spot than an obvious hole"
  );

  setLang("ko");
  check("switching language switches the words", t("phase.seeking") === STRINGS.ko["phase.seeking"]);
  check("...and placeholders still fill", t("results.next", { n: 7 }).includes("7"));
  setLang("en");
  check("switching back works", t("phase.seeking") === STRINGS.en["phase.seeking"]);
}

console.log("\nnothing is left hard-coded where a player can read it");
{
  // The table is only the source of truth if components actually use it. These
  // are the files that render text; a Korean literal in one of them is a string
  // that will never be translated, and the fallback will never fire because
  // nothing is looking it up.
  //
  // Comments are exempt — this project writes its reasoning in prose and that
  // prose is not shown to anybody.
  const files = [
    "game/src/App.tsx",
    "game/src/ui/Hud.tsx",
    "game/src/ui/HubHud.tsx",
    "game/src/ui/Screens.tsx",
    "game/src/ui/PaintTools.tsx",
    "game/src/ui/PoseMenu.tsx",
    "game/src/ui/ShopPrompt.tsx",
    "game/src/ui/Settings.tsx",
    "game/src/ui/useWallet.ts",
    "game/src/hub/Hub.tsx",
    "game/src/hub/LeaderboardBoard.tsx",
    "game/src/net/useGame.ts",
    "game/src/game/warmup.ts",
  ];

  // Block comments are tracked across lines rather than matched per line. This
  // project writes its reasoning in paragraphs, and a middle line of one has no
  // marker of its own — matching `^\s*\*` caught the usual style and reported a
  // JSX `{/* ... */}` continuation line as an offender.
  const offenders: string[] = [];
  for (const file of files) {
    let inBlock = false;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        let code = line;
        if (inBlock) {
          const close = code.indexOf("*/");
          if (close === -1) return;
          code = code.slice(close + 2);
          inBlock = false;
        }
        // Whole /* ... */ pairs first, then a `/*` with no partner opens a run,
        // then anything after a //.
        code = code.replace(/\/\*[\s\S]*?\*\//g, "");
        const open = code.indexOf("/*");
        if (open !== -1) {
          inBlock = true;
          code = code.slice(0, open);
        }
        code = code.replace(/\/\/.*$/, "");
        if (/[가-힣]/.test(code)) offenders.push(`${file}:${i + 1} ${code.trim().slice(0, 60)}`);
      });
  }
  check(
    "no Korean literals left in the files that render text",
    offenders.length === 0,
    offenders.slice(0, 6).join("\n      ")
  );
}

if (failures === 0) {
  console.log("\n✅ both languages say everything\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}

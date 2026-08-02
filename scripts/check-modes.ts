/**
 * The two rooms, as a decision table.
 *
 * The whole difference between them is one question — what happens when a hider
 * is shot — so the risk is not that the answer is wrong, it is that the answer
 * leaks. A change meant for one room quietly showing up in the other, or the
 * client and server disagreeing about which room this is, would produce a game
 * that is neither. Everything below asks that question from both sides.
 *
 * Run: npm run check:modes
 */

import {
  DEFAULT_MODE,
  GAME_MODE_IDS,
  acceptsJoiners,
  afterResults,
  activeHiders,
  catchPatch,
  huntOver,
  isGameMode,
  type GameMode,
  type RoundUser,
} from "../server/src/rules";
import {
  DEFAULT_MODE as CLIENT_DEFAULT,
  MODE_TEXT,
  canLeaveNow,
  caughtIsOut,
  modeOf,
  canPoseNow,
  roundFreezes,
} from "../game/src/game/modes";
import { MIN_PLAYERS, MAX_PLAYERS } from "../server/src/rules";
import { PORTALS } from "../game/src/hub/hubMap";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

const MODES: GameMode[] = ["tag", "hunt"];

console.log("\nbeing caught means different things, and only these things");
{
  const tag = catchPatch("tag", 1000);
  const hunt = catchPatch("hunt", 1000);

  check("tag puts you on the other side", tag.role === "seeker", JSON.stringify(tag));
  check(
    "...and does NOT mark you caught",
    tag.caught === false,
    "the flag drives the dimmed body and the 발각 result row, and a player who is now hunting is neither"
  );
  check("...but records when it happened, for scoring", tag.convertedAt === 1000);
  check(
    "...and clears the shot cooldown, so a new seeker can act at once",
    tag.lastShotAt === 0
  );

  check("hunt marks you caught", hunt.caught === true);
  check("...and takes you out of the world", hunt.spectating === true);
  check("...and does not change your role", hunt.role === undefined, JSON.stringify(hunt));
  check(
    "hunt never converts and tag never eliminates",
    tag.spectating === undefined && hunt.convertedAt === undefined
  );
}

console.log("\nthe round ends by one rule, in both rooms");
{
  const u = (over: Partial<RoundUser>): RoundUser => ({ account: "a", role: "hider", ...over });

  check("a fresh round is not over", !huntOver([u({ role: "seeker" }), u({}), u({})]));
  check(
    "hunt ends when the last hider is caught",
    huntOver([u({ role: "seeker" }), u({ caught: true }), u({ caught: true })])
  );
  check(
    "tag ends when the last hider has changed sides",
    huntOver([u({ role: "seeker" }), u({ role: "seeker" }), u({ role: "seeker" })])
  );
  check(
    "one hider left keeps it going, either way",
    !huntOver([u({ role: "seeker" }), u({ role: "seeker" }), u({})])
  );

  // The guard that stops an empty or seeker-less room reading as a finished
  // round — without it a room whose seeker walked out would end instantly and
  // then end again, every tick.
  check("an empty room is not a finished round", !huntOver([]));
  check("a room with no seeker is not a finished round", !huntOver([u({}), u({})]));

  check("active hiders counts what is left to find", activeHiders([u({ role: "seeker" }), u({}), u({ caught: true })]) === 1);
}

console.log("\nwho may walk in, and when");
{
  check("a lobby takes joiners", acceptsJoiners("lobby", 2, MAX_PLAYERS));
  check("so does a results screen — the room is about to play again", acceptsJoiners("results", 2, MAX_PLAYERS));
  check("a hiding phase does not", !acceptsJoiners("hiding", 2, MAX_PLAYERS));
  check(
    "and neither does a hunt in progress",
    !acceptsJoiners("seeking", 2, MAX_PLAYERS),
    "in tag you would arrive as the only hider in a room of seekers; in hunt with the hiding phase already spent"
  );
  check("a full room takes nobody", !acceptsJoiners("lobby", MAX_PLAYERS, MAX_PLAYERS));
}

console.log("\nwhat happens after the results screen");
{
  check(`${MIN_PLAYERS} players restarts`, afterResults(MIN_PLAYERS, MIN_PLAYERS) === "restart");
  check("a full room restarts", afterResults(MAX_PLAYERS, MIN_PLAYERS) === "restart");
  check(
    "dropping below the minimum falls back to the lobby",
    afterResults(MIN_PLAYERS - 1, MIN_PLAYERS) === "lobby",
    "rather than starting a round that cannot be played"
  );
  check("an empty room goes to the lobby", afterResults(0, MIN_PLAYERS) === "lobby");
}

console.log("\nthe client agrees with the server");
{
  check(`default mode matches (${DEFAULT_MODE})`, DEFAULT_MODE === CLIENT_DEFAULT);
  // The server holds ids and no words at all — it cannot know which language a
  // player picked, so display text lives in the client's i18n table and
  // check:i18n asserts every id has a name there in both languages.
  check(
    "both sides know the same set of modes",
    [...GAME_MODE_IDS].sort().join() === Object.keys(MODE_TEXT).sort().join(),
    `${GAME_MODE_IDS} vs ${Object.keys(MODE_TEXT)}`
  );

  // The client asks "does being caught take me out" in three places — whether
  // to draw a body, whether to hand over the camera, whether leaving is live —
  // and all three read caughtIsOut. It has to agree with what the server
  // actually does to the player.
  for (const m of MODES) {
    const patch = catchPatch(m, 1);
    check(
      `${m}: caughtIsOut agrees with what the server writes`,
      caughtIsOut(m) === (patch.spectating === true)
    );
  }

  check("rubbish falls back to the default", modeOf("nonsense") === DEFAULT_MODE && modeOf(undefined) === DEFAULT_MODE);
  check("a real mode survives the round trip", modeOf("hunt") === "hunt" && isGameMode("hunt"));
  check("isGameMode refuses anything else", !isGameMode("tag ") && !isGameMode(null) && !isGameMode(""));
}

console.log("\nleaving is offered exactly when it should be");
{
  for (const m of MODES) {
    check(`${m}: the results screen offers it`, canLeaveNow(m, "results", false));
    check(`${m}: a live round does not, if you are still playing`, !canLeaveNow(m, "seeking", false));
  }
  check(
    "hunt offers it the moment you are out",
    canLeaveNow("hunt", "seeking", true),
    "sitting and watching until the clock runs out would be a punishment nobody asked for"
  );
  check(
    "tag does not, because being caught there is not being out",
    !canLeaveNow("tag", "seeking", true),
    "you are hunting now"
  );
}

console.log("\nwho can move, and when");
{
  // The results phase pins hiders and lets the seeker walk, and the asymmetry
  // is the whole point: the reveal shows WHERE people hid, so the seeker has to
  // be able to go and look, and the hider has to still be there when they
  // arrive. A revealed hider who wandered off would be a glow marking nothing.
  check("the seeker walks through the results", !roundFreezes("results", true));
  check("hiders stay where they hid", roundFreezes("results", false));

  for (const phase of ["lobby", "hiding", "seeking"]) {
    check(
      `${phase} pins nobody`,
      !roundFreezes(phase, true) && !roundFreezes(phase, false),
      "being caught and opening a panel freeze too, but those are App's business, not the round's"
    );
  }
}


console.log("\nthe hub's doors lead where they claim");
{
  const open = PORTALS.filter((p) => p.available);
  check(`${open.length} doors are open`, open.length >= 2);
  for (const p of open) {
    check(`${p.id} names a real mode (${p.mode})`, isGameMode(p.mode));
    if (isGameMode(p.mode)) {
      check(
        `${p.id} shows that mode's own name`,
        p.labelKey === MODE_TEXT[p.mode].labelKey && p.subKey === MODE_TEXT[p.mode].subKey,
        `${p.labelKey} / ${p.subKey}`
      );
    }
  }
  check(
    "every open door leads somewhere different",
    new Set(open.map((p) => p.mode)).size === open.length
  );
  check(
    "closed doors promise nothing",
    PORTALS.filter((p) => !p.available).every((p) => !p.mode)
  );
}

console.log("\nposing and painting during a round");
{
  const base = { inHub: false, isSeeker: false, caught: false };

  // The change this pins: seeking used to be closed, which made the disguise a
  // thing you committed to in the first thirty seconds and then watched fail.
  check("a hider can re-pose while the seeker is hunting", canPoseNow({ ...base, phase: "seeking" }));
  check("and while still hiding", canPoseNow({ ...base, phase: "hiding" }));
  check("and in the lobby before the round", canPoseNow({ ...base, phase: "lobby" }));

  // Results keeps hiders pinned so the reveal marks where they actually hid —
  // roundFreezes says the same thing about movement, and the two must agree or
  // a hider could re-pose while frozen in place.
  check("but not once the round is over", !canPoseNow({ ...base, phase: "results" }));
  check(
    "...which is the same call roundFreezes makes",
    roundFreezes("results", false) === !canPoseNow({ ...base, phase: "results" })
  );

  check("the seeker never poses", !canPoseNow({ ...base, isSeeker: true, phase: "seeking" }));
  check("a caught player never poses", !canPoseNow({ ...base, caught: true, phase: "seeking" }));
  check("nobody poses in the hub", !canPoseNow({ ...base, inHub: true, phase: "lobby" }));

  // Every phase, so a new one cannot quietly default to open.
  for (const phase of ["lobby", "hiding", "seeking", "results"]) {
    const open = canPoseNow({ ...base, phase });
    check(`${phase}: ${open ? "open" : "closed"} to a live hider`, open === (phase !== "results"));
  }
}

if (failures === 0) {
  console.log("\n✅ the two rooms stay two rooms\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}

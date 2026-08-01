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
  GAME_MODES,
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
  GAME_MODES as CLIENT_MODES,
  canLeaveNow,
  caughtIsOut,
  modeOf,
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
  for (const m of MODES) {
    check(
      `${m}: label and subtitle match`,
      GAME_MODES[m].label === CLIENT_MODES[m].label && GAME_MODES[m].sub === CLIENT_MODES[m].sub,
      `${JSON.stringify(GAME_MODES[m])} vs ${JSON.stringify(CLIENT_MODES[m])}`
    );
  }
  check("both sides know the same set of modes", Object.keys(GAME_MODES).join() === Object.keys(CLIENT_MODES).join());

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

console.log("\nthe hub's doors lead where they claim");
{
  const open = PORTALS.filter((p) => p.available);
  check(`${open.length} doors are open`, open.length >= 2);
  for (const p of open) {
    check(`${p.id} names a real mode (${p.mode})`, isGameMode(p.mode));
    if (isGameMode(p.mode)) {
      check(
        `${p.id} shows that mode's own label`,
        p.label === CLIENT_MODES[p.mode].label && p.sub === CLIENT_MODES[p.mode].sub,
        `"${p.label}" / "${p.sub}"`
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

if (failures === 0) {
  console.log("\n✅ the two rooms stay two rooms\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}

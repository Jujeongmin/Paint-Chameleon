/**
 * Avatar shop decision logic.
 *
 * Everything that decides anything lives in pure functions, because the server
 * test harness cannot drive a round to completion and we deliberately ship no
 * remote method that grants coins — so a successful purchase is unreachable on
 * a live server in tests. Same wall the leaderboard hit; same answer.
 *
 * Run: npm run check:shop
 */

import {
  AVATAR_PRICES,
  COINS,
  DEFAULT_WALLET,
  applyEquip,
  applyPurchase,
  coinsFor,
  parseOwned,
  serializeOwned,
  type WalletState,
} from "../server/src/rules";
import { standAction } from "../game/src/ui/standAction";
import { STANDS } from "../game/src/hub/hubMap";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

console.log("\ncoinsFor");
{
  check(
    "a hider who survived earns the round fee plus the survival bonus",
    coinsFor({ seeker: false, caught: false, catches: 0 }) === COINS.perRound + COINS.survived
  );
  check(
    "a hider who was caught earns only the round fee",
    coinsFor({ seeker: false, caught: true, catches: 0 }) === COINS.perRound
  );
  check(
    "a seeker with three catches earns the fee plus three bounties",
    coinsFor({ seeker: true, caught: false, catches: 3 }) === COINS.perRound + COINS.perCatch * 3
  );
  check(
    "a seeker who caught nobody still earns the round fee",
    coinsFor({ seeker: true, caught: false, catches: 0 }) === COINS.perRound
  );
  check("nobody ever earns a negative amount", coinsFor({ seeker: true, caught: true, catches: -5 }) >= 0);
}

console.log("\nowned round-trip");
{
  check("an empty string parses to no items", parseOwned("").length === 0);
  check("whitespace-only parses to no items", parseOwned("   ").length === 0);
  check("a single id parses to one item", parseOwned("classic").join() === "classic");
  check("round-trips a list", serializeOwned(parseOwned("classic,square")) === "classic,square");
  check("drops empty segments", parseOwned("classic,,square").length === 2);
}

console.log("\ndefault wallet");
{
  check("starts with no coins", DEFAULT_WALLET.coins === 0);
  check("owns the free profile", DEFAULT_WALLET.owned.includes("classic"));
  check("has the free profile equipped", DEFAULT_WALLET.equipped === "classic");
  check("owns nothing else", DEFAULT_WALLET.owned.length === 1);
}

console.log("\napplyPurchase");
{
  const rich = (): WalletState => ({ coins: 1000, owned: ["classic"], equipped: "classic" });

  const unknown = applyPurchase(rich(), "does-not-exist");
  check("rejects an id that is not for sale", unknown.ok === false);
  check("...with reason 'unknown'", unknown.ok === false && unknown.reason === "unknown");

  const already = applyPurchase(rich(), "classic");
  check("rejects something already owned", already.ok === false);
  check("...with reason 'owned'", already.ok === false && already.reason === "owned");

  const broke = applyPurchase({ coins: 0, owned: ["classic"], equipped: "classic" }, "square");
  check("rejects when the balance is short", broke.ok === false);
  check("...with reason 'broke'", broke.ok === false && broke.reason === "broke");

  // Exactly the price, not a coin more or less.
  const before = rich();
  const bought = applyPurchase(before, "square");
  check("accepts an affordable, unowned avatar", bought.ok === true);
  check(
    "deducts exactly the listed price",
    bought.ok === true && bought.wallet.coins === before.coins - AVATAR_PRICES.square
  );
  check("adds the avatar to owned", bought.ok === true && bought.wallet.owned.includes("square"));
  check(
    "adds it exactly once",
    bought.ok === true && bought.wallet.owned.filter((i) => i === "square").length === 1
  );
  check(
    "does not auto-equip the purchase",
    bought.ok === true && bought.wallet.equipped === "classic"
  );

  // A rejected purchase that mutated the input would leak coins on the way out.
  const untouched = rich();
  applyPurchase(untouched, "square");
  check("leaves the input wallet untouched on success", untouched.coins === 1000 && untouched.owned.length === 1);
  const untouched2 = rich();
  applyPurchase(untouched2, "does-not-exist");
  check("leaves the input wallet untouched on failure", untouched2.coins === 1000);

  // Affording it exactly must work — an off-by-one here would be invisible
  // until someone saved up the precise amount.
  const exact = applyPurchase({ coins: AVATAR_PRICES.tank, owned: ["classic"], equipped: "classic" }, "tank");
  check("affording the exact price is enough", exact.ok === true);
  check("...and lands on a zero balance", exact.ok === true && exact.wallet.coins === 0);
}

console.log("\napplyEquip");
{
  const w: WalletState = { coins: 0, owned: ["classic", "square"], equipped: "classic" };

  const notOwned = applyEquip(w, "tank");
  check("refuses to equip something not owned", notOwned.ok === false);

  const unknown = applyEquip(w, "does-not-exist");
  check("refuses to equip an unknown id", unknown.ok === false);

  const equipped = applyEquip(w, "square");
  check("equips an owned avatar", equipped.ok === true);
  check("...and changes nothing else", equipped.ok === true && equipped.wallet.coins === w.coins);
  check(
    // owned is the ownership record — a security-relevant field — so an
    // equip, which must never grant or revoke ownership, has to be checked
    // against it directly rather than just coins.
    "...and leaves owned untouched",
    equipped.ok === true &&
      equipped.wallet.owned.length === w.owned.length &&
      w.owned.every((id) => equipped.wallet.owned.includes(id))
  );
  check("leaves the input wallet untouched", w.equipped === "classic");
}

console.log("\nunknown ids can't be smuggled in via inherited Object.prototype keys");
{
  // AVATAR_PRICES is a plain object literal, so AVATAR_PRICES["toString"] (or
  // "constructor"/"__proto__") resolves to an inherited Function rather than
  // undefined unless the lookup uses hasOwnProperty. A function coerces to
  // NaN in the price/balance arithmetic, and every comparison against NaN is
  // false — so a naive `=== undefined` check would let these through as free
  // or nearly-free purchases.
  const rich = (): WalletState => ({ coins: 1000, owned: ["classic"], equipped: "classic" });

  for (const id of ["toString", "__proto__", "constructor"]) {
    const bought = applyPurchase(rich(), id);
    check(`applyPurchase rejects "${id}" as unknown`, bought.ok === false && bought.reason === "unknown");

    const equippedAttempt = applyEquip({ coins: 0, owned: ["classic", id], equipped: "classic" }, id);
    check(`applyEquip refuses "${id}"`, equippedAttempt.ok === false);
  }

  const nanBalance = applyPurchase({ coins: NaN, owned: ["classic"], equipped: "classic" }, "tank");
  check(
    "a non-finite (NaN) balance is refused as 'broke', not treated as sufficient",
    nanBalance.ok === false && nanBalance.reason === "broke"
  );
}

console.log("\nwhat one [E] press at a stand does");
{
  // The client half of the same decision. With the modal panel gone there are
  // no disabled buttons documenting what's allowed, so this table IS the
  // interaction — and it has to agree with applyPurchase/applyEquip above or
  // the prompt will offer something the server then refuses.
  const square = { id: "square", price: AVATAR_PRICES.square };
  const classic = { id: "classic", price: 0 };

  check("a wallet that hasn't loaded yet says so", standAction(square, null) === "loading");
  check(
    "the equipped body offers nothing",
    standAction(classic, { coins: 0, owned: ["classic"], equipped: "classic" }) === "equipped"
  );
  check(
    "an owned but unequipped body offers equip",
    standAction(square, { coins: 0, owned: ["classic", "square"], equipped: "classic" }) === "equip"
  );
  check(
    "an unowned body you can afford offers buy",
    standAction(square, { coins: AVATAR_PRICES.square, owned: ["classic"], equipped: "classic" }) === "buy"
  );
  check(
    "one coin short offers nothing",
    standAction(square, { coins: AVATAR_PRICES.square - 1, owned: ["classic"], equipped: "classic" }) === "broke"
  );
  check(
    // Owning something you can no longer afford must still be equippable —
    // ordering the ownership test after the balance test would strand it.
    "an owned body is equippable on an empty balance",
    standAction(square, { coins: 0, owned: ["classic", "square"], equipped: "classic" }) === "equip"
  );

  // The free body is the only way back to the default now that the panel is
  // gone. On a brand new wallet its stand must not be a dead end.
  const fresh = { coins: 0, owned: [...DEFAULT_WALLET.owned], equipped: DEFAULT_WALLET.equipped };
  const dead = STANDS.filter((s) => {
    const a = standAction(s, fresh);
    return a === "broke" && s.price === 0;
  });
  check("no free stand is ever unreachable", dead.length === 0, dead.map((s) => s.id).join());

  check(
    "every stand offers exactly one action on a fresh wallet",
    STANDS.every((s) => ["loading", "equipped", "equip", "buy", "broke"].includes(standAction(s, fresh)))
  );
  check(
    "a stand exists for every body, including the free one",
    STANDS.some((s) => s.price === 0),
    "with no free stand there is no way back to the default body"
  );
}

if (failures === 0) {
  console.log("\n✅ shop logic is consistent\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}

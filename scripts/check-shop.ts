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
  check("round-trips a list", serializeOwned(parseOwned("classic,bean")) === "classic,bean");
  check("drops empty segments", parseOwned("classic,,bean").length === 2);
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

  const broke = applyPurchase({ coins: 0, owned: ["classic"], equipped: "classic" }, "bean");
  check("rejects when the balance is short", broke.ok === false);
  check("...with reason 'broke'", broke.ok === false && broke.reason === "broke");

  // Exactly the price, not a coin more or less.
  const before = rich();
  const bought = applyPurchase(before, "bean");
  check("accepts an affordable, unowned avatar", bought.ok === true);
  check(
    "deducts exactly the listed price",
    bought.ok === true && bought.wallet.coins === before.coins - AVATAR_PRICES.bean
  );
  check("adds the avatar to owned", bought.ok === true && bought.wallet.owned.includes("bean"));
  check(
    "adds it exactly once",
    bought.ok === true && bought.wallet.owned.filter((i) => i === "bean").length === 1
  );
  check(
    "does not auto-equip the purchase",
    bought.ok === true && bought.wallet.equipped === "classic"
  );

  // A rejected purchase that mutated the input would leak coins on the way out.
  const untouched = rich();
  applyPurchase(untouched, "bean");
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
  const w: WalletState = { coins: 0, owned: ["classic", "bean"], equipped: "classic" };

  const notOwned = applyEquip(w, "tank");
  check("refuses to equip something not owned", notOwned.ok === false);

  const unknown = applyEquip(w, "does-not-exist");
  check("refuses to equip an unknown id", unknown.ok === false);

  const equipped = applyEquip(w, "bean");
  check("equips an owned avatar", equipped.ok === true);
  check("...and changes nothing else", equipped.ok === true && equipped.wallet.coins === w.coins);
  check("leaves the input wallet untouched", w.equipped === "classic");
}

if (failures === 0) {
  console.log("\n✅ shop logic is consistent\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}

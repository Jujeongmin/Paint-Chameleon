# Status

## Recent activity

- **Ad SDK integration**: wired `@verse8/ads` (v0.4.0) into `game/src/ui/adProvider.ts`. `showAd` now plays a real rewarded ad (`placementId: "shop-coins"`) in deployed builds; offline rehearsal (`VITE_AGENT8_VERSE` unset) skips the SDK entirely and uses the existing countdown panel, because the SDK would hang on a 30s timeout in a hostless page. Server enforcement unchanged (`claimAd` server-clock rules).
- **Test coins**: ad reward `AD_REWARD.coins` raised 25 → 200 on both sides (`server/src/rules.ts` and `game/src/game/coins.ts`, held together by `check:sync`). Updated the shop balance check: it now asserts one ad funds the most expensive avatar (tank 90) instead of the old "a day of ads stays under 4 tanks" guard.
- `npm run check` passes (18 check scripts + 28 server tests); `npm run build` succeeds.

## Verification

- `npm run check` → all green.
- `npx tsc --noEmit` → clean.
- `npm run build` → clean (chunk-size warning only).

## Next steps / open items

- Confirm the real rewarded ad actually renders in the Verse8 host (deploy via editor **Launch**; watch a shop ad, verify coins +200 after completing, nothing on skip).
- Decide placement id naming/registration with the ad network if `"shop-coins"` needs a console entry.
- Verify wallet/leaderboard persistence across server restarts in production.
- Git repo is absent (`.git` removed); re-init + set remote if commit history is wanted.

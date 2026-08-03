# Status

## Recent activity

- **Ad SDK removed (reverted)**: the `@verse8/ads` integration added earlier was removed at the builder's request. `showAd` in `game/src/ui/adProvider.ts` is back to the placeholder-only countdown panel; the package dependency is gone. The server-side ad-reward rules were left intact (server clock enforcement, provider-agnostic) — only the provider seam reverted.
- **Ad reward coins reset**: `AD_REWARD.coins` set to **0** (both `server/src/rules.ts` and `game/src/game/coins.ts`, held by `check:sync`). The shop balance check in `check-shop.ts` was restored to its original form ("a full day's worth of ads is worth less than 4 tanks").
- `npm run check` passes (18 check scripts + 28 server tests); `npm run build` succeeds.

## Verification

- `npm run check` → all green.
- `npx tsc --noEmit` → clean.
- `npm run build` → clean (chunk-size warning only).

## Next steps / open items

- Decide whether the ad-for-coins feature should ship at all: the provider seam is a placeholder and `AD_REWARD.coins` is 0, so watching the panel currently grants nothing.
- Verify wallet/leaderboard persistence across server restarts in production.
- Git repo is absent (`.git` removed); re-init + set remote if commit history is wanted.

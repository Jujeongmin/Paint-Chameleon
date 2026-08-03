# Status

## Recent activity

- **Fake ad panel removed, real SDK attached**: the in-app "Paint Chameleon" ad countdown panel (`AdBreak.tsx`) is gone. `showAd` in `game/src/ui/adProvider.ts` now calls `@verse8/ads` (`Verse8Ads.showRewarded`, placement `"shop-coins"`) directly. A page that cannot play a real ad (offline rehearsal, plain browser) resolves `{ completed: false }` and the server refuses the claim — no fallback panel. Removed the now-dead `AdBreak` component, `adProgress` state in `useWallet`, the panel-only i18n keys (`ad.tag`/`ad.house`/`ad.remaining`/`ad.escape`), the `AD_PANEL_MS` constant, and the `check:sync` panel check.
- **Ad reward coins**: `AD_REWARD.coins` stays at **0** (both `server/src/rules.ts` and `game/src/game/coins.ts`, held by `check:sync`).
- `npm run check` passes (18 check scripts + 28 server tests); `npm run build` succeeds.

## Verification

- `npm run check` → all green.
- `npx tsc --noEmit` → clean.
- `npm run build` → clean (chunk-size warning only).

## Next steps / open items

- Decide whether the ad-for-coins feature should ship at all: the provider seam is a placeholder and `AD_REWARD.coins` is 0, so watching the panel currently grants nothing.
- Verify wallet/leaderboard persistence across server restarts in production.
- Git repo is absent (`.git` removed); re-init + set remote if commit history is wanted.

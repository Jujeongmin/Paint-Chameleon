# Requirements

## Core rules

- 2–10 players per match. One seeker per round; hiders paint themselves and hold a pose.
- Phases: lobby → hiding (30s) → seeking (75s) → results (30s).
- Scoring: survive = 100 pts; caught = 1 pt/sec alive; seeker = 75 pts/catch.
- Modes: `tag` (caught hider converts to seeker) and `hunt` (caught hider is out).

## Economy / shop

- Coins: `perRound 5` + `survived 5` + `perCatch 2`. Ad reward: **200** coins per completed watch.
- Avatars: `classic` (free), `square` (50), `tank` (90).
- Wallet per account in `wallets` collection, keyed by `$sender.account` — persistent for logged-in Verse8 users, **not** for guests (guest accounts are regenerated per session).
- Shop: stand on a mannequin footprint, `E` to buy/equip, `F` to watch an ad for coins.

## Ads for coins

- Rewarded ads via `@verse8/ads` in deployed builds; offline rehearsal falls back to an in-app countdown panel.
- Server enforces on its own clock only: `minWatchMs 14s`, `cooldownMs 90s`, `dailyCap 10`, `ticketMs 300s`. A claim trusts no client timestamp/amount.
- Client mirror (`adRules.ts`) is display/rehearsal only; `check:sync` holds it to the server copy.

## Known issues / constraints

- Guest accounts: leaderboard + wallet never accumulate for non-logged-in players (see Context).
- `$roomTick` actual period unmeasured in production.
- Server has no map — shot distance/wall checks are client-side (README 한계 13).
- Collection persistence across server restarts unverified in production.

# Structure

```
game/                  Client app (Vite root)
  src/
    App.tsx            Scene + HUD composition
    net/
      useGame.ts       useGame() — offline vs online branch
      offline.ts       Offline rehearsal rig (bots, local wallet)
      types.ts         Wire types (PlayerState, WalletView, results…)
      profile.ts
    game/              Pure-ish game logic
      arena.ts map.ts cell.ts   geometry/collision (MAP_BOXES)
      movement.ts input.ts      player movement + input
      bot.ts nav.ts             AI hiders + pathfinding
      paint.ts useBrush.ts      painting system (CanvasTexture)
      constants.ts coins.ts modes.ts  mirrored constants
      bodies.ts bodyGeometry.ts avatar catalogue + geometry
      useShoot.ts aim.ts camera*.ts  seeker gun + cameras
      adRules.ts       client mirror of ad reward rules (rehearsal/display)
      models.ts props.tsx instancing.ts  3D assets
    hub/               Social hub (spawn, shop stands, portals, leaderboard)
    ui/                HUD, shop, ad break, i18n, settings
      adProvider.ts    SHOW AD SEAM — real @verse8/ads + fallback countdown
      AdBreak.tsx      the ad panel (placeholder / behind real ad)
      useWallet.ts     wallet state, buy/equip/watchAd flow
      ShopPrompt.tsx   shop interaction (E buy, F watch ad)
    audio/sound.ts     procedural audio
public/                Static assets (GLB models, textures, audio ogg)
server/                Game server (structured project)
  src/server.ts        Server class: rooms, phases, shot, wallet, ads
  src/rules.ts         Shared constants + pure rule functions (mirrored)
  test/server.test.ts  Server tests (28)
scripts/               check:* verification scripts + helpers
PROJECT/               This documentation
dist/                  Client build output
```

## Key seams

- **Ad reward**: `showAd` in `game/src/ui/adProvider.ts` is the only place the ad network is touched. Server enforcement lives in `claimAd` (`server/src/rules.ts`) — server clock only, provider-agnostic. Client mirror in `game/src/game/adRules.ts`.
- **Wallet**: per-account rows in `wallets` collection (`WALLET_COLLECTION`). Server is the only authority on coins/ownership; the client catalogue is display-only.
- **Shared constants**: `game/src/game/coins.ts` and `game/src/game/constants.ts` mirror `server/src/rules.ts`; `scripts/check-sync.ts` compares answers, not just numbers.

## Architecture notes

- `$roomTick` runs the phase machine on server wall-clock (`phaseEndsAt`), no accumulated deltas.
- Shot resolution is a remote function (`requestShot`), not a tick step; server checks phase/role/target/cooldown/facing only — no map, no distance (see README "알려진 한계" 13).
- Paint is cosmetic: server relays dabs without interpreting them.
- Player movement: client owns position; server clamps XZ by `MOVE_SPEED_CAP * SPEED_GRACE`.

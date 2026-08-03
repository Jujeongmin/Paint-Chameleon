# Context

## Project overview

**Paint Chameleon** — 3D multiplayer hide-and-seek on the Verse8 / Agent8 platform. You paint your own body and hold a pose to blend into the arena and fool the seeker. In "tag" mode a caught hider becomes a seeker; in "hunt" mode a caught hider is out.

## Tech stack

| Layer | Choice |
|---|---|
| Client | React 18 + Vite (app lives in `game/`) |
| 3D | React Three Fiber 8 + three.js |
| Painting | Canvas2D → `CanvasTexture`, one texture per player |
| Server | `@agent8/gameserver-node` structured project (`server/src/server.ts`) |
| Networking | Agent8 Room State + room messaging (socket.io + msgpack + lz4) |
| Ads | `@verse8/ads` rewarded ads (shop coin reward) |

## User context

- The builder works through the Verse8/Agent8 editor. The dev server and browser preview are managed by the platform; the assistant never starts or checks them.
- Builder is Korean-speaking; i18n ships `en` and `ko`.
- The project is considered "complete" — new work should be additive and minimal, not refactors.
- Deployment is done by the builder via the editor **Launch** button, not by the assistant running deploy commands.

## Critical memory

- `.agent8.lock` (verse identity) and `.env` are platform-managed — never modify.
- `VITE_AGENT8_VERSE` set ⇒ online mode; unset ⇒ offline rehearsal rig (`game/src/net/offline.ts`), which runs AI hiders and the same rules locally.
- Server runs in isolated-vm: no `setInterval`/`setTimeout`, no network, no Node built-ins. `$global`/`$room`/`$sender`/`$asset`/`$lock` only.
- Client/server share constants by mirroring (e.g. `coins.ts` ↔ `rules.ts`); `npm run check` (specifically `check:sync`) holds the mirrors together.
- Git repo: `.git` was initialized once but is currently absent — no remote, no commit history available.

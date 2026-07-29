# public/

Vite serves everything here from the site root, unprocessed: `public/textures/x.jpg`
is fetched as `/textures/x.jpg`. Nothing here is bundled, hashed or tree-shaken,
so only put files in that you reference by a literal URL at runtime.

```
textures/   seamless colour maps for the floor and walls (2K JPG is plenty)
hdri/       equirectangular .hdr for the background (take the 1K or 2K download,
            never the 16K one — it is over 100 MB)
models/     .glb / .gltf decoration. Visual only: collision is always the
            axis-aligned boxes in src/game/arena.ts, never a mesh.
```

## Two rules the arena's camouflage depends on

**Prop families stay flat two-tone.** Drums, crates, pallets and pillars are
what a hider paints themselves to imitate, and the eyedropper hands the player
one colour number straight off the box (`onPickColor` in
`src/game/ArenaScene.tsx`). A photographic texture on a prop cannot be matched
by a player who can only paint flat colours, so texturing the props makes
hiding *worse*. Floor, walls, background and non-colliding decoration are free.

**If the floor gets a texture, `FLOOR_COLOR` has to move with it.** The
eyedropper returns that constant rather than sampling the texture, so a floor
that no longer looks like `#3a3f4a` breaks the lying-down disguise. Set the
constant to the texture's average tone in the same commit.

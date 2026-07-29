# public/

Vite serves everything here from the site root, unprocessed: `public/textures/x.jpg`
is fetched as `/textures/x.jpg`. Nothing here is bundled, hashed or tree-shaken,
so only put files in that you reference by a literal URL at runtime.

```
textures/   floor_*      Concrete047A   (ambientCG, CC0)  — arena floor
            wall_*       CorrugatedSteel005                — perimeter walls
            partition_*  MetalPlates011                    — not wired yet
hdri/       equirectangular .hdr for the background (take the 1K or 2K download,
            never the 16K one — it is over 100 MB). Empty for now.
models/     Kenney Factory Kit 3.0, GLB only (CC0). Decoration is visual only:
            collision is always the axis-aligned boxes in src/game/arena.ts,
            never a mesh. Nothing is placed in the scene yet.
```

Each texture is `_color` / `_normal` / `_rough`, downscaled to 1024 and
re-encoded at quality 82. The ambientCG downloads are 2K at quality 100 — 6 to 8
MB per map, 42 MB for nine of them, and everything in this folder ships to the
player verbatim. Do the same to anything you add. The originals' other maps
(displacement, AO, metalness, NormalDX) and the FBX/OBJ/blend copies of the
Kenney models were deleted for the same reason.

## Two rules the arena's camouflage depends on

**Prop families stay flat two-tone.** Drums, crates, pallets and pillars are
what a hider paints themselves to imitate, and the eyedropper hands the player
one colour number straight off the box (`onPickColor` in
`src/game/ArenaScene.tsx`). A photographic texture on a prop cannot be matched
by a player who can only paint flat colours, so texturing the props makes
hiding *worse*. Floor, walls, background and non-colliding decoration are free.

**A textured surface has to state what colour it reads as.** The eyedropper
takes a material's colour, and a textured material's colour must be white or it
tints the map — so textured meshes carry `userData.pickColor`, and
`FLOOR_COLOR` / `WALL_COLOR` in `src/game/arena.ts` hold the average tone of
their texture. Change a texture and you must re-measure, or a hider paints
themselves a colour the floor no longer is.

To re-measure (Windows PowerShell):

```powershell
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile("$PWD\public\textures\floor_color.jpg")
$r=0;$g=0;$b=0;$c=0
for ($x=0; $x -lt $img.Width; $x+=8) { for ($y=0; $y -lt $img.Height; $y+=8) {
  $p=$img.GetPixel($x,$y); $r+=$p.R; $g+=$p.G; $b+=$p.B; $c++ } }
"#{0:x2}{1:x2}{2:x2}" -f [int]($r/$c), [int]($g/$c), [int]($b/$c)
```

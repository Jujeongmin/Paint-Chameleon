import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useGame } from "./net/useGame";
import { Arena, Lighting } from "./game/ArenaScene";
import { CellScene, CellLighting } from "./game/CellScene";
import { LocalPlayer } from "./game/LocalPlayer";
import { RemotePlayers } from "./game/RemotePlayers";
import { Hub } from "./hub/Hub";
import type { PortalProgress } from "./hub/HubPlayer";
import type { Stand } from "./hub/hubMap";
import { Hud } from "./ui/Hud";
import { HubHud } from "./ui/HubHud";
import { useWallet } from "./ui/useWallet";
import { useLeaderboard } from "./ui/useLeaderboard";
import { PaintTools } from "./ui/PaintTools";
import { MuteToggle } from "./ui/MuteToggle";
import { PoseMenu } from "./ui/PoseMenu";
import { hsvToRgb, rgbToHsv } from "./ui/ColorWheel";
import { ConnectingScreen, NickScreen, ResultsOverlay, WaitingBanner } from "./ui/Screens";
import {
  BRUSH,
  NET_THROTTLE_MS,
  PAINT_FLUSH_MS,
  PAINT_MAX_BATCH,
  STAND_POSE,
} from "./game/constants";
import { clearAllSurfaces, surfaceFor, type PaintDab } from "./game/paint";
import { useControlsLearned } from "./game/input";
import type { Tool } from "./game/useBrush";
import type { ShotResult } from "./game/useShoot";
import type { WireDab } from "./net/types";
import { playCatch, playResults, playRoundStart } from "./audio/sound";
import "./ui/ui.css";

export default function App() {
  const game = useGame();
  const { server, account, connected, joined, joining, error, room, me, players, secondsLeft } = game;

  // Held here rather than in each HUD so walking between the hub and a match
  // doesn't bring the tutorial back.
  const controlsLearned = useControlsLearned();

  const [nick, setNick] = useState("");
  const [pose, setPose] = useState(STAND_POSE);
  const [poseMenuOpen, setPoseMenuOpen] = useState(false);
  const [paintMode, setPaintMode] = useState(false);
  const [charLocked, setCharLocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);

  const wallet = useWallet(game);

  // paint tools
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(BRUSH.default);
  const [zoom, setZoom] = useState(0);
  const [hue, setHue] = useState(0.05);
  const [sat, setSat] = useState(0.85);
  const [value, setValue] = useState(0.95);

  const color = hsvToRgb(hue, sat, value);

  // Room state already carries the authoritative body (joinHub/joinGame seed
  // it from the wallet, equipAvatar updates it), so prefer `me.body` over the
  // locally-fetched `equipped` whenever it's present. Without this, a
  // getWallet() that's issued before `connected` and then rejects (the
  // effect's deps run it on mount, which for the online hook can race the
  // connection) leaves `equipped` stuck at the default for the whole session
  // while every peer already sees the real body. Offline players have no
  // `body` field on their PlayerState at all, so `?? equipped` is load-bearing
  // there, not just a defensive fallback.
  const bodyId = me?.body ?? wallet.equipped;

  /** Dabs waiting to be flushed to the room. */
  const pending = useRef<WireDab[]>([]);
  /** Written by HubPlayer every frame; the hub HUD polls it. */
  const portalRef = useRef<PortalProgress>({ portal: null, progress: 0 });
  /** Likewise: the shop stand the player is standing at, or null. */
  const standRef = useRef<Stand | null>(null);
  /** Sound: last phase seen, so a transition sound fires exactly once. */
  const prevPhase = useRef<string | null>(null);
  /** Sound: last known caught flag per account, so a catch sound fires once per catch. */
  const prevCaught = useRef<Map<string, boolean>>(new Map());

  const inHub = room?.kind === "hub";
  const phase = room?.phase ?? "lobby";
  // The board is hub geometry, so there's nothing to poll for during a match.
  const leaderboard = useLeaderboard(game.fetchLeaderboard, inHub);
  const isSeeker = me?.role === "seeker";
  /** The seeker sits out the hiding phase underground rather than blindfolded. */
  const inCell = isSeeker && phase === "hiding";
  // Posing and painting share the same window: only hiders, only before or
  // during the hunt starts, never once caught. The seeker's own facing has to
  // track their camera exactly for the server's shot facing check, so their pose is
  // fixed and the menu stays closed for them.
  const canPose = !inHub && !isSeeker && (phase === "hiding" || phase === "lobby") && !me?.caught;
  const canPaint = canPose || inCell;

  // Paint belongs to a match. Walking back into the hub has to wipe it too, or
  // everyone stands around the lobby still wearing the last round's camouflage
  // — the round-start wipe below can't cover this, because it deliberately
  // ignores the hub.
  useEffect(() => {
    if (!inHub) return;
    clearAllSurfaces();
    pending.current = [];
  }, [inHub]);

  // A new round wipes everyone's paint and resets the pose.
  useEffect(() => {
    if (inHub || phase !== "hiding") return;
    setPose(STAND_POSE);
    setPoseMenuOpen(false);
    setPaintMode(false);
    setCharLocked(false);
    setTool("brush");
    clearAllSurfaces();
    pending.current = [];
  }, [phase, inHub]);

  // Round-transition stingers. Skipped in the hub, which has no rounds.
  useEffect(() => {
    if (inHub) return;
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (prev === phase) return;

    if (phase === "hiding") {
      playRoundStart();
    } else if (phase === "results") {
      const won = isSeeker
        ? (room?.lastResults ?? []).some((r: any) => r.account === account && r.gained > 0)
        : !me?.caught;
      playResults(won);
    }
  }, [phase, inHub, isSeeker, room?.lastResults, account, me?.caught]);

  // Catch stinger: your own catch, and everyone else's.
  useEffect(() => {
    if (inHub) return;
    if (me?.caught && !prevCaught.current.get(account)) playCatch();
    if (typeof me?.caught === "boolean") prevCaught.current.set(account, me.caught);

    for (const p of players) {
      if (p.account === account) continue;
      if (p.caught && !prevCaught.current.get(p.account)) playCatch();
      prevCaught.current.set(p.account, !!p.caught);
    }
  }, [me?.caught, players, inHub, account]);

  useEffect(() => {
    if (phase === "lobby") setReady(false);
  }, [phase]);

  // Being caught, or becoming the seeker, releases the pin.
  useEffect(() => {
    if (me?.caught || isSeeker) setCharLocked(false);
  }, [me?.caught, isSeeker]);

  // Painting and posing are locked once the hunt starts — the hiding phase has
  // to matter. Also close the pose menu if the character gets pinned (R) while
  // it's open, so a locked pose can't be quietly changed out from under it.
  useEffect(() => {
    if (!canPaint && paintMode) setPaintMode(false);
    if ((!canPose || charLocked) && poseMenuOpen) setPoseMenuOpen(false);
  }, [canPaint, paintMode, canPose, charLocked, poseMenuOpen]);

  // Pointer lock is read from the document rather than plumbed up from
  // usePointerLook, which keeps it in refs to avoid re-rendering at pointer
  // rate. This only flips on lock/unlock, so state is fine here.
  useEffect(() => {
    const onChange = () => setPointerLocked(!!document.pointerLockElement);
    onChange();
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  // Hide the OS cursor while looking around; the centred crosshair is the aim.
  // Painting and the pose menu need it back — both are pointer-driven UI. The
  // shop isn't: it's a keyboard prompt with no clickable surface.
  //
  // Only ever hidden while pointer lock is actually held. Without lock the game
  // falls back to free look, where the cursor is a real cursor that can wander
  // off the canvas and out of the window — and the fallback stops turning the
  // view the moment it leaves (`e.target !== canvas` in input.ts). Hiding it
  // there means the player loses track of a cursor that silently disables their
  // own mouse look. Under lock the browser hides it anyway, so this is belt and
  // braces rather than the mechanism.
  useEffect(() => {
    const hide = pointerLocked && !paintMode && !poseMenuOpen;
    document.body.classList.toggle("hide-cursor", hide);
    return () => document.body.classList.remove("hide-cursor");
  }, [pointerLocked, paintMode, poseMenuOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyF" && canPaint && !poseMenuOpen) {
        e.preventDefault();
        setPaintMode((v) => !v);
      }
      if (e.code === "KeyG" && canPose && !charLocked && !paintMode) {
        e.preventDefault();
        setPoseMenuOpen((v) => !v);
      }
      if (e.code === "Escape") {
        setPaintMode(false);
        setPoseMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPaint, canPose, charLocked, paintMode, poseMenuOpen]);

  // Batch dabs rather than sending one message per brush movement.
  //
  // Read through a ref rather than depending on `game`: that object is rebuilt
  // every render, so an effect keyed on it clears and restarts this interval on
  // every render. At 140ms the timer would keep getting reset before it ever
  // fired, and strokes would sit in `pending` unsent.
  const gameRef = useRef(game);
  gameRef.current = game;

  useEffect(() => {
    const id = setInterval(() => {
      if (!pending.current.length) return;
      gameRef.current.paintDabs(pending.current.splice(0, PAINT_MAX_BATCH));
    }, PAINT_FLUSH_MS);
    return () => clearInterval(id);
  }, []);

  const onDab = useCallback((dab: PaintDab, join: boolean) => {
    pending.current.push({ ...dab, j: join });
    // Drop the oldest if a frantic drag outruns the flush interval; the visual
    // result is already on screen locally, this only affects what peers see.
    if (pending.current.length > PAINT_MAX_BATCH * 3) {
      pending.current.splice(0, pending.current.length - PAINT_MAX_BATCH * 3);
    }
  }, []);

  const onFill = useCallback(() => {
    if (!me) return;
    surfaceFor(me.account).fill(color);
    pending.current = [];
    game.paintFill(color);
  }, [me, color, game]);

  const onSelectPose = useCallback((index: number) => {
    setPose(index);
    setPoseMenuOpen(false);
  }, []);

  // Jumping out of a held pose only makes sense as standing — you can't jump
  // while lying down mid-animation and land in the same pose.
  const onJumpFromPose = useCallback(() => setPose(STAND_POSE), []);

  const onColorPicked = useCallback((picked: number) => {
    const [h, s, v] = rgbToHsv(picked);
    setHue(h);
    setSat(s);
    setValue(v);
    setTool("brush");
  }, []);

  const sendTransform = useCallback(
    (pos: [number, number, number], rotY: number, p: number, moving: boolean) => {
      // Throttled sends can be dropped by design; swallow the rejection.
      server
        .remoteFunction("updateTransform", [{ pos, rotY, pose: p, moving }], {
          throttle: NET_THROTTLE_MS,
        })
        .catch(() => {});
    },
    [server]
  );

  const onHubTransform = useCallback(
    (pos: [number, number, number], rotY: number, moving: boolean) =>
      sendTransform(pos, rotY, 0, moving),
    [sendTransform]
  );

  const onShoot = useCallback(
    (result: ShotResult) => {
      // A miss is a legitimate outcome and costs nothing to send — but there is
      // nobody to send it about, so it stops here. The tracer and the local
      // shot sound are handled in LocalPlayer, right where useShoot's onFire
      // already has the shooter's own position to hand.
      if (!result.account) return;
      game.requestShot(result.account).catch(() => {});
    },
    [game]
  );

  const toggleReady = useCallback(() => {
    const next = !ready;
    setReady(next);
    game.setReady(next);
  }, [ready, game]);

  const handleJoin = useCallback(
    (name: string) => {
      setNick(name);
      game.join(name);
    },
    [game]
  );

  if (!connected) return <ConnectingScreen />;
  if (!joined) return <NickScreen onJoin={handleJoin} joining={joining} error={error} />;
  if (!room || !me) return <ConnectingScreen message="로비에 들어가는 중…" />;

  const frozen = paintMode || poseMenuOpen || !!me.caught || phase === "results";

  return (
    <>
      {/* One canvas for both worlds — remounting it would drop the WebGL context
          and every paint texture along with it. */}
      <Canvas
        shadows
        camera={{ fov: 70, near: 0.1, far: 200, position: [0, 4, 8] }}
        // preserveDrawingBuffer costs a little perf but lets dev tooling grab
        // the framebuffer; keep it out of production builds.
        gl={{ antialias: true, preserveDrawingBuffer: import.meta.env.DEV }}
      >
        {inHub ? (
          <Hub
            account={account}
            nick={me.nick || nick || "익명"}
            body={bodyId}
            players={players}
            portalRef={portalRef}
            onEnterPortal={() => game.enterGame(nick || me.nick || "익명")}
            onTransform={onHubTransform}
            standRef={standRef}
            leaderboard={leaderboard}
            joining={joining}
          />
        ) : (
          // The arena's textures load asynchronously and suspend while they do.
          // Nothing renders in their place: a fallback arena would flash a
          // differently-coloured world for a frame and then swap under the
          // player, which reads as a glitch rather than as loading.
          <Suspense fallback={null}>
            {inCell ? <CellLighting /> : <Lighting />}
            {inCell ? <CellScene /> : <Arena />}
            <LocalPlayer
              me={me}
              phase={phase}
              inCell={inCell}
              pose={pose}
              body={bodyId}
              onJumpFromPose={onJumpFromPose}
              frozen={frozen}
              paintMode={paintMode}
              charLocked={charLocked}
              onToggleLock={() => setCharLocked((v) => !v)}
              onTransform={sendTransform}
              onShoot={onShoot}
              tool={tool}
              color={color}
              brushSize={brushSize}
              zoom={zoom}
              onZoom={setZoom}
              onDab={onDab}
              onColorPicked={onColorPicked}
            />
            {!inCell && <RemotePlayers players={players} selfAccount={account} />}
          </Suspense>
        )}
      </Canvas>

      <MuteToggle />

      {inHub ? (
        <HubHud
          portalRef={portalRef}
          standRef={standRef}
          players={players}
          account={account}
          joining={joining}
          showControls={!controlsLearned}
          wallet={wallet}
        />
      ) : (
        <>
          <Hud
            room={room}
            me={me}
            players={players}
            account={account}
            secondsLeft={secondsLeft}
            pose={pose}
            paintMode={paintMode}
            canPaint={canPaint}
            charLocked={charLocked}
            ready={ready}
            onToggleReady={toggleReady}
            showControls={!controlsLearned}
            canPose={canPose}
          />

          {poseMenuOpen && (
            <PoseMenu current={pose} onSelect={onSelectPose} onClose={() => setPoseMenuOpen(false)} />
          )}

          {phase === "lobby" && !paintMode && !poseMenuOpen && (
            <button
              className="hub-return"
              onClick={() => game.returnToHub(nick || me.nick || "익명")}
            >
              로비로 돌아가기
            </button>
          )}

          {paintMode && (
            <div className="overlay">
              <PaintTools
                zoom={zoom}
                onZoom={setZoom}
                brushSize={brushSize}
                onBrushSize={setBrushSize}
                hue={hue}
                sat={sat}
                value={value}
                onColor={(h, s) => {
                  setHue(h);
                  setSat(s);
                }}
                onValue={setValue}
                tool={tool}
                onTool={setTool}
                onFill={onFill}
                onExit={() => setPaintMode(false)}
              />
              <div className="paint-hint">
                {tool === "picker"
                  ? "스포이드 — 벽·바닥이나 자기 몸을 클릭해 색을 뽑으세요"
                  : "몸을 드래그해 칠하고, 빈 공간을 드래그해 시점을 돌리세요 · 휠로 확대"}
                {phase === "hiding" && ` · ${secondsLeft}초 남음`}
              </div>
            </div>
          )}

          {phase === "results" && (
            <ResultsOverlay
              room={room}
              players={players}
              account={account}
              secondsLeft={secondsLeft}
            />
          )}

          {phase === "lobby" && players.length < room.minPlayers && (
            <WaitingBanner count={players.length} needed={room.minPlayers} />
          )}
        </>
      )}
    </>
  );
}


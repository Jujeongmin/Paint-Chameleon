import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useGame } from "./net/useGame";
import { Arena, Lighting } from "./game/Arena";
import { LocalPlayer } from "./game/LocalPlayer";
import { RemotePlayers } from "./game/RemotePlayers";
import { Hub } from "./hub/Hub";
import type { PortalProgress } from "./hub/HubPlayer";
import { Hud } from "./ui/Hud";
import { HubHud } from "./ui/HubHud";
import { PaintTools } from "./ui/PaintTools";
import { MuteToggle } from "./ui/MuteToggle";
import { PoseMenu } from "./ui/PoseMenu";
import { hsvToRgb, rgbToHsv } from "./ui/ColorWheel";
import { ConnectingScreen, NickScreen, ResultsOverlay, WaitingBanner } from "./ui/Screens";
import {
  BRUSH,
  MIN_PLAYERS,
  NET_THROTTLE_MS,
  PAINT_FLUSH_MS,
  PAINT_MAX_BATCH,
  STAND_POSE,
} from "./game/constants";
import { clearAllSurfaces, surfaceFor, type PaintDab } from "./game/paint";
import { useControlsLearned } from "./game/input";
import type { Tool } from "./game/useBrush";
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

  // paint tools
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(BRUSH.default);
  const [zoom, setZoom] = useState(0);
  const [hue, setHue] = useState(0.05);
  const [sat, setSat] = useState(0.85);
  const [value, setValue] = useState(0.95);

  const color = hsvToRgb(hue, sat, value);

  /** Dabs waiting to be flushed to the room. */
  const pending = useRef<WireDab[]>([]);
  /** Written by HubPlayer every frame; the hub HUD polls it. */
  const portalRef = useRef<PortalProgress>({ portal: null, progress: 0 });
  /** Sound: last phase seen, so a transition sound fires exactly once. */
  const prevPhase = useRef<string | null>(null);
  /** Sound: last known caught flag per account, so a catch sound fires once per catch. */
  const prevCaught = useRef<Map<string, boolean>>(new Map());

  const inHub = room?.kind === "hub";
  const phase = room?.phase ?? "lobby";
  const isSeeker = me?.role === "seeker";
  // Posing and painting share the same window: only hiders, only before or
  // during the hunt starts, never once caught. The seeker's own facing has to
  // track their camera exactly for the server's tag check, so their pose is
  // fixed and the menu stays closed for them.
  const canPose = !inHub && !isSeeker && (phase === "hiding" || phase === "lobby") && !me?.caught;
  const canPaint = canPose;

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

  // Hide the OS cursor while looking around; the centred crosshair is the aim.
  // Painting and the pose menu need it back — both are pointer-driven UI.
  useEffect(() => {
    document.body.classList.toggle("hide-cursor", !paintMode && !poseMenuOpen);
    return () => document.body.classList.remove("hide-cursor");
  }, [paintMode, poseMenuOpen]);

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
  useEffect(() => {
    const id = setInterval(() => {
      if (!pending.current.length) return;
      game.paintDabs(pending.current.splice(0, PAINT_MAX_BATCH));
    }, PAINT_FLUSH_MS);
    return () => clearInterval(id);
  }, [game]);

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

  const onTag = useCallback((target: string) => game.requestTag(target).catch(() => {}), [game]);

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

  const frozen =
    paintMode ||
    poseMenuOpen ||
    !!me.caught ||
    phase === "results" ||
    (isSeeker && phase === "hiding");

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
            players={players}
            portalRef={portalRef}
            onEnterPortal={() => game.enterGame(nick || me.nick || "익명")}
            onTransform={onHubTransform}
            joining={joining}
          />
        ) : (
          <>
            <Lighting />
            <Arena />
            <LocalPlayer
              me={me}
              phase={phase}
              pose={pose}
              onJumpFromPose={onJumpFromPose}
              frozen={frozen}
              paintMode={paintMode}
              charLocked={charLocked}
              onToggleLock={() => setCharLocked((v) => !v)}
              players={players}
              onTransform={sendTransform}
              onTag={onTag}
              tool={tool}
              color={color}
              brushSize={brushSize}
              zoom={zoom}
              onZoom={setZoom}
              onDab={onDab}
              onColorPicked={onColorPicked}
            />
            <RemotePlayers players={players} selfAccount={account} />
          </>
        )}
      </Canvas>

      <MuteToggle />

      {inHub ? (
        <HubHud
          portalRef={portalRef}
          players={players}
          account={account}
          joining={joining}
          showControls={!controlsLearned}
          fetchLeaderboard={game.fetchLeaderboard}
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

          {phase === "lobby" && players.length < MIN_PLAYERS && (
            <WaitingBanner count={players.length} needed={MIN_PLAYERS} />
          )}
        </>
      )}
    </>
  );
}

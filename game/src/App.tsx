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
import { Settings } from "./ui/Settings";
import { PoseMenu } from "./ui/PoseMenu";
import { hsvToRgb, rgbToHsv } from "./ui/ColorWheel";
import { ConnectingScreen, LoadingScreen, NickScreen, ResultsOverlay, RoomSwitchScreen, WaitingBanner } from "./ui/Screens";
import { runWarmup, type WarmupProgress } from "./game/warmup";
import { fetchSavedNick, saveNick } from "./net/profile";
import { DEFAULT_MODE, canLeaveNow, canPoseNow, caughtIsOut, roundFreezes } from "./game/modes";
import {
  BRUSH,
  NET_THROTTLE_MS,
  PAINT_FLUSH_MS,
  PAINT_MAX_BATCH,
  STAND_POSE,
} from "./game/constants";
import { clearAllSurfaces, surfaceFor, type PaintDab } from "./game/paint";
import { botPaintColor } from "./game/botPaint";
import { useControlsLearned } from "./game/input";
import type { Tool } from "./game/useBrush";
import type { ShotResult } from "./game/useShoot";
import type { WireDab } from "./net/types";
import { playCatch, playHuntStart, playResults, playRoundStart } from "./audio/sound";
import "./ui/ui.css";
import { t, useT } from "./ui/i18n";

export default function App() {
  // One subscription, at the root. A language change re-renders everything
  // below, which is why every other file imports the plain `t` rather than a
  // hook — the alternative is a subscription in each of thirty components for
  // an event that happens once a session.
  useT();

  const game = useGame();
  const { server, account, connected, joined, joining, error, room, me, players, secondsLeft, recovering, switching } = game;

  // Held here rather than in each HUD so walking between the hub and a match
  // doesn't bring the tutorial back.
  const controlsLearned = useControlsLearned();

  const [nick, setNick] = useState("");
  const [pose, setPose] = useState(STAND_POSE);
  const [poseMenuOpen, setPoseMenuOpen] = useState(false);
  const [paintMode, setPaintMode] = useState(false);
  const [charLocked, setCharLocked] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);
  /**
   * The account's remembered nick, once we have asked for it.
   *
   *   undefined — not asked yet, so we do not know whether to show the screen
   *   null      — asked, and this account has never set one
   *   string    — asked, and it has: skip the screen entirely
   *
   * The three-state is the point. Defaulting to null would flash the nick
   * screen for one render before the answer came back, and a screen that
   * appears and vanishes is worse than one that waits.
   */
  const [savedNick, setSavedNick] = useState<string | null | undefined>(undefined);
  /** null once everything is ready; a progress report until then. */
  const [warmup, setWarmup] = useState<WarmupProgress | null>({ done: 0, total: 1, label: t("load.preparing") });

  const wallet = useWallet(game);

  // paint tools
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(BRUSH.default);
  const [zoom, setZoom] = useState(0);
  /** Where the brush ring is drawn, and how big; null when off the body. */
  const [brushCursor, setBrushCursor] = useState<{
    x: number;
    y: number;
    radius: number;
  } | null>(null);
  const [hue, setHue] = useState(0.05);
  const [sat, setSat] = useState(0.85);
  const [value, setValue] = useState(0.95);

  const color = hsvToRgb(hue, sat, value);

  // Wheel notches are multiplicative, not additive: a step that reads as a
  // small change at 0.02 would be imperceptible at 0.30, and one that reads at
  // 0.30 would skip the whole bottom of the range. 16 notches end to end.
  const stepBrush = useCallback((dir: number) => {
    const factor = Math.pow(BRUSH.max / BRUSH.min, 1 / 16);
    setBrushSize((r) =>
      Math.min(BRUSH.max, Math.max(BRUSH.min, r * (dir > 0 ? factor : 1 / factor)))
    );
  }, []);

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
  /** True while HubPlayer is standing in the how-to-play zone. */
  const guideRef = useRef(false);
  /** Sound: last phase seen, so a transition sound fires exactly once. */
  const prevPhase = useRef<string | null>(null);
  /** Sound: last known caught flag per account, so a catch sound fires once per catch. */
  const prevCaught = useRef<Map<string, boolean>>(new Map());
  /**
   * The ready toggle, reachable from the key handler above where it is defined.
   * A ref rather than a dependency: `toggleReady` is rebuilt whenever `ready`
   * changes, and listing it would tear down and rebuild the keydown listener
   * every time somebody readies up.
   */
  const toggleReadyRef = useRef<() => void>(() => {});
  /** Same trick for leaving, which the results screen binds to the same key. */
  const leaveRef = useRef<() => void>(() => {});

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
  const canPose = canPoseNow({ inHub, isSeeker, phase, caught: !!me?.caught });
  const canPaint = canPose || inCell;

  const mode = room?.mode ?? DEFAULT_MODE;
  /** Caught, in the room where that ends your round: no body, free camera. */
  const spectating = !inHub && caughtIsOut(mode) && !!me?.caught;
  /** When the leave button is live. See modes.ts — one rule, asked in one place. */
  const canLeave = !inHub && canLeaveNow(mode, phase, !!me?.caught);

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

  // ...and the AI hiders paint themselves again, because the wipe above just
  // took last round's coat off them too. Keyed on the roster as well as the
  // phase: bots appear and disappear as people join and leave, and one that
  // arrives mid-lobby has never been painted at all.
  useEffect(() => {
    if (inHub) return;
    for (const p of players) {
      if (p.bot) surfaceFor(p.account).fill(botPaintColor(p.account));
    }
  }, [players, phase, inHub]);

  // Round-transition stingers. Skipped in the hub, which has no rounds.
  useEffect(() => {
    if (inHub) return;
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (prev === phase) return;

    if (phase === "hiding") {
      playRoundStart();
    } else if (phase === "seeking") {
      // The seeker has been sat in the holding cell for the whole hiding
      // phase; this is the moment the door opens. Everyone hears it — the
      // hiders need to know the clock changed hands just as much.
      playHuntStart();
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

  // endRound publishes the results phase before it grants persistent coins to
  // each player. Refreshing once on the transition can therefore win that race
  // and read the old balance. Poll sequentially for a few seconds: the first
  // successful post-grant read updates the UI immediately, and later reads are
  // harmless confirmations rather than out-of-order stale responses.
  useEffect(() => {
    if (inHub || phase !== "results") return;
    let cancelled = false;
    const delays = [250, 600, 1200, 2400];

    const syncRoundCoins = async () => {
      for (const delay of delays) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (cancelled) return;
        await wallet.refresh();
      }
    };
    void syncRoundCoins();
    return () => {
      cancelled = true;
    };
  }, [phase, inHub, wallet.refresh]);

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
      if (e.code === "KeyP" && paintMode && !poseMenuOpen) {
        e.preventDefault();
        setTool((current) => (current === "picker" ? "brush" : "picker"));
      }
      // Ready has been a mouse-only button since the lobby existed, which
      // means letting go of the controls to press it. Enter rather than Space:
      // Space is jump, and a key that both readies you and launches you is the
      // sort of thing that gets pressed by accident at exactly the wrong time.
      if (e.code === "Enter" && !inHub && phase === "lobby" && !poseMenuOpen) {
        e.preventDefault();
        toggleReadyRef.current();
      }
      // The same key ends the session whenever the leave button is on screen —
      // the results screen, and a caught-out spectator mid-hunt. It cannot
      // collide with the ready toggle above: canLeave is never true in the
      // lobby. The seeker keeps pointer lock through the results, and a caught
      // spectator may still hold it too, so without a key the leave button
      // would be visible and unclickable until they pressed Escape first.
      if (e.code === "Enter" && !inHub && canLeave && !poseMenuOpen) {
        e.preventDefault();
        leaveRef.current();
      }
      // The lobby's own way back. Enter is taken by the ready toggle there, so
      // the back-to-the-lobby button gets its own key — and it obeys the same
      // conditions the button renders under, so the key never works while the
      // control that advertises it is hidden.
      if (e.code === "KeyL" && !inHub && phase === "lobby" && !paintMode && !poseMenuOpen) {
        e.preventDefault();
        leaveRef.current();
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
  }, [canPaint, canPose, canLeave, charLocked, paintMode, poseMenuOpen, inHub, phase]);

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

  const leave = useCallback(() => {
    game.returnToHub(nick || me?.nick || t("app.anon"));
  }, [game, nick, me?.nick]);

  const toggleReady = useCallback(() => {
    if (me?.ready) return;
    game.setReady(true);
  }, [me?.ready, game]);

  toggleReadyRef.current = toggleReady;
  leaveRef.current = leave;

  // Kick off once the player has committed to playing. Before the nick screen
  // is submitted there is nothing to be ready FOR, and downloading several
  // megabytes at somebody who may just be looking is rude.
  useEffect(() => {
    if (!joined) return;
    let live = true;
    runWarmup((p) => {
      if (live) setWarmup(p);
    }).then(() => {
      if (live) setWarmup(null);
    });
    return () => {
      live = false;
    };
  }, [joined]);

  // Ask once, as soon as there is a server to ask. Today this always answers
  // null and the screen always shows — see net/profile.ts for why the stub is
  // a stub and what the real one has to do.
  useEffect(() => {
    if (!connected || joined) return;
    let live = true;
    fetchSavedNick(server)
      .catch(() => null)
      .then((found) => {
        if (!live) return;
        setSavedNick(found);
        // A remembered nick skips the screen rather than pre-filling it: being
        // asked to confirm your own name every time is the same interruption
        // the saved nick exists to remove.
        if (found) {
          setNick(found);
          game.join(found);
        }
      });
    return () => {
      live = false;
    };
  }, [connected, joined, server, game]);

  const handleJoin = useCallback(
    (name: string) => {
      setNick(name);
      // Fire-and-forget, and deliberately not awaited: a profile write that is
      // slow or broken must not stand between somebody and the game.
      saveNick(server, name).catch(() => {});
      game.join(name);
    },
    [game, server]
  );

  // Settings ride along on the entry screens too, and the language switch is
  // why. English is the default, so the very first screen a Korean player sees
  // is in a language they may not read — and it is also the screen with the
  // fewest words on it to guess from. Making them join before they can change
  // it would be exactly backwards.
  if (!connected)
    return (
      <>
        <ConnectingScreen />
        <Settings />
      </>
    );
  // Still waiting to hear whether this account has a name already. Showing the
  // nick screen here and pulling it away a frame later would be worse than a
  // beat of "connecting".
  if (savedNick === undefined)
    return (
      <>
        <ConnectingScreen />
        <Settings />
      </>
    );
  if (!joined)
    return (
      <>
        <NickScreen onJoin={handleJoin} joining={joining} error={error} />
        <Settings />
      </>
    );
  // Before the room, so the wait for assets and the wait for a room are one
  // wait rather than two screens in a row.
  if (warmup)
    return (
      <>
        <LoadingScreen {...warmup} />
        <Settings />
      </>
    );
  // Four different waits, and they used to read as one. Recovering means the
  // room went away underneath a session that already had one; switching means
  // the player themself walked through a door and the platform is moving them
  // (about twenty seconds, measured — rejoin.ts). The switch gets a screen
  // that shows the wait passing, because a bare line over twenty seconds
  // reads as a hang.
  if (!room || !me) {
    if (recovering) return <ConnectingScreen message={t("app.reconnecting")} />;
    if (switching)
      return (
        <RoomSwitchScreen
          message={t(switching === "match" ? "app.enteringMatch" : "app.returningHub")}
        />
      );
    return <ConnectingScreen message={t("app.enteringLobby")} />;
  }

  const frozen = paintMode || poseMenuOpen || !!me.caught || roundFreezes(phase, isSeeker);

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
            nick={me.nick || nick || t("app.anon")}
            body={bodyId}
            players={players}
            portalRef={portalRef}
            // The door decides the game. A portal with no mode is one that
            // does not lead anywhere yet, and HubPlayer already refuses those.
            onEnterPortal={(portal) =>
              game.enterGame(nick || me.nick || t("app.anon"), portal.mode ?? DEFAULT_MODE)
            }
            onTransform={onHubTransform}
            standRef={standRef}
            guideRef={guideRef}
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
            spectating={spectating}
              onToggleLock={() => setCharLocked((v) => !v)}
              onTransform={sendTransform}
              onShoot={onShoot}
              tool={tool}
              color={color}
              brushSize={brushSize}
              zoom={zoom}
              onZoom={setZoom}
              onBrushStep={stepBrush}
              onCursor={setBrushCursor}
              onDab={onDab}
              onColorPicked={onColorPicked}
            />
            {!inCell && (
              <RemotePlayers
                players={players}
                selfAccount={account}
                reveal={phase === "results"}
                armed={phase === "seeking"}
              />
            )}
          </Suspense>
        )}
      </Canvas>

      <Settings />

      {inHub ? (
        <HubHud
          portalRef={portalRef}
          standRef={standRef}
          guideRef={guideRef}
          players={players}
          account={account}
          joining={joining}
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
            ready={!!me.ready}
            onToggleReady={toggleReady}
            showControls={!controlsLearned}
            canPose={canPose}
            mode={mode}
            spectating={spectating}
            canLeave={canLeave}
            onLeave={leave}
          />

          {poseMenuOpen && (
            <PoseMenu current={pose} onSelect={onSelectPose} onClose={() => setPoseMenuOpen(false)} />
          )}

          {phase === "lobby" && !paintMode && !poseMenuOpen && (
            <button
              className="hub-return"
              onClick={() => game.returnToHub(nick || me.nick || t("app.anon"))}
            >
              <span>{t("paint.backToHub")}</span>
              <kbd>L</kbd>
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
              {brushCursor && tool === "brush" && (
                <div
                  className="brush-cursor"
                  style={{
                    left: brushCursor.x,
                    top: brushCursor.y,
                    width: brushCursor.radius * 2,
                    height: brushCursor.radius * 2,
                  }}
                />
              )}
              <div className="paint-hint">
                {tool === "picker"
                  ? t("paint.hintPicker")
                  : t("paint.hintBrush")}
                {phase === "hiding" && t("paint.timeLeft", { n: secondsLeft })}
              </div>
            </div>
          )}

          {phase === "results" && (
            <ResultsOverlay
              room={room}
              players={players}
              account={account}
              secondsLeft={secondsLeft}
              onLeave={leave}
            />
          )}

          {phase === "lobby" && players.filter((p) => !p.bot).length < room.minPlayers && (
            <WaitingBanner count={players.filter((p) => !p.bot).length} needed={room.minPlayers} />
          )}
        </>
      )}
    </>
  );
}

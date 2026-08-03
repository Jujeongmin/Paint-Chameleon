import { PHASE_SECONDS, POSES, type Phase } from "../game/constants";
import { MODE_TEXT, type GameMode } from "../game/modes";
import { Icon } from "./icons";
import { KeyHints, type KeyHint } from "./KeyHints";
import type { PlayerState, RoomInfo } from "../net/types";
import { t, type Key } from "./i18n";

const PHASE_KEY: Record<Phase, Key> = {
  lobby: "phase.lobby",
  hiding: "phase.hiding",
  seeking: "phase.seeking",
  results: "phase.results",
};

interface Props {
  room: RoomInfo;
  me: PlayerState;
  players: PlayerState[];
  account: string;
  secondsLeft: number;
  pose: number;
  paintMode: boolean;
  canPaint: boolean;
  /** Posing shares its availability window with painting, but is its own gate. */
  canPose: boolean;
  charLocked: boolean;
  ready: boolean;
  onToggleReady: () => void;
  /** False once the player has used the controls; hides the basic tutorial. */
  showControls: boolean;
  mode: GameMode;
  /** Caught in a room where that removes you: watching, not playing. */
  spectating: boolean;
  /** Whether leaving is offered right now. Decided by modes.ts, not here. */
  canLeave: boolean;
  onLeave: () => void;
}

export function Hud({
  room,
  me,
  players,
  account,
  secondsLeft,
  pose,
  paintMode,
  canPaint,
  canPose,
  charLocked,
  ready,
  onToggleReady,
  showControls,
  mode,
  spectating,
  canLeave,
  onLeave,
}: Props) {
  const isSeeker = me.role === "seeker";
  const hiders = players.filter((p) => p.role === "hider");
  const remaining = hiders.filter((p) => !p.caught).length;

  // How much of this phase is left, as a bar under the timer. The lobby has no
  // clock — it ends when everyone is ready — so it gets no bar rather than a
  // full one, which would read as "you have all the time in the world".
  const total = PHASE_SECONDS[room.phase];
  const drain = total > 0 ? Math.max(0, Math.min(1, secondsLeft / total)) : 0;

  // Nothing along the bottom while waiting to start. The lobby is a room you
  // stand around in, not a round you are playing, and a rail of controls that
  // mostly do not work yet is clutter over the one thing that matters there —
  // whether everyone has pressed ready.
  const inRound = room.phase !== "lobby";

  // Paint is not on the rail. It gets its own panel at the right edge, level
  // with the middle of the screen, because pressing F replaces the right edge
  // with the paint tools — the control and what it opens are in the same place,
  // and it is far enough from the crosshair to be read without covering it.
  const showPaint = inRound && (!isSeeker || room.phase === "hiding");

  // The rail below the crosshair. Order is how often you reach for the thing,
  // not how important it is: movement is muscle memory and goes first so the
  // things you actually have to read sit nearest the middle of the screen.
  const hints: KeyHint[] = [];
  if (inRound) {
    if (showControls) {
      hints.push({ cap: "WASD", icon: "move", label: t("key.move"), tone: "move" });
      hints.push({ cap: "SPACE", icon: "jump", label: t("key.jump"), tone: "move" });
      hints.push({ cap: "MOUSE", icon: "look", label: t("key.look"), tone: "move" });
    }
    if (!isSeeker) {
      hints.push({ cap: "G", icon: "pose", label: t("key.poseAction"), tone: "pose", off: !canPose });
      hints.push({
        cap: "R",
        icon: "pin",
        label: charLocked ? t("key.pinOn") : t("key.pinOff"),
        tone: "pin",
        on: charLocked,
      });
    } else {
      hints.push({
        cap: "CLICK",
        icon: "shoot",
        label: t("key.shoot"),
        tone: "seeker",
        off: room.phase !== "seeking",
      });
    }
  }

  return (
    <div className="overlay">
      {!paintMode && (
        <>
          <div className={"hud-top phase-" + room.phase}>
            {/* Which of the two rooms you are in. It changes what being caught
                means, so it is not a detail you should have to remember. */}
            <span className="mode-chip">{t(MODE_TEXT[mode].subKey)}</span>
            <span className="phase-label">{t(PHASE_KEY[room.phase])}</span>
            {room.phase !== "lobby" && (
              <span className={"timer" + (secondsLeft <= 10 ? " urgent" : "")}>{secondsLeft}</span>
            )}
            {room.phase !== "lobby" && (
              <span className={"role-chip " + (isSeeker ? "seeker" : "hider")}>
                {isSeeker ? t("role.seeker") : t("role.hider")}
              </span>
            )}
            {room.phase === "seeking" && (
              <span className="phase-label">
                {t("hud.remaining")} <b className="tally">{remaining}</b>/{hiders.length}
              </span>
            )}
            {charLocked && <span className="role-chip locked">{t("role.pinned")}</span>}
            {/* The clock again, as a length rather than a number: a glance at
                the bar answers "am I nearly out of time" without reading. */}
            {total > 0 && (
              <span className="phase-drain">
                <span className="phase-drain-fill" style={{ transform: `scaleX(${drain})` }} />
              </span>
            )}
          </div>

          <div className="hud-left">
            <div className="hud-heading">
              {t("hud.roundPlayers", { n: room.round, c: players.length })}
            </div>
            {players.map((p) => (
              <div key={p.account} className={"player-row" + (p.caught ? " caught" : "")}>
                <span
                  className="dot"
                  style={{
                    background:
                      p.account === room.seeker
                        ? "var(--seeker)"
                        : p.caught
                        ? "var(--muted)"
                        : "var(--hider)",
                  }}
                />
                <span className="name">
                  {p.nick || t("app.anon")}
                  {p.account === account ? t("app.you") : ""}
                </span>
                <span className="score">{room.scores[p.account] ?? 0}</span>
              </div>
            ))}
            {room.phase === "lobby" && (
              // The key is on the button rather than in a hint somewhere else:
              // the button is where you look when you are deciding to press it.
              <button className="btn ready-btn" style={{ marginTop: 10 }} onClick={onToggleReady} disabled={ready}>
                <span>{ready ? t("hud.unready") : t("hud.ready")}</span>
                <kbd>Enter</kbd>
              </button>
            )}
          </div>

          <div className={"crosshair" + (isSeeker && room.phase === "seeking" ? " locked" : "")} />

          {showPaint && (
            <div className={"paint-call" + (canPaint ? "" : " is-off")}>
              <span className="paint-call-icon">
                <Icon name="paint" />
              </span>
              <span className="paint-call-cap">F</span>
              <span className="paint-call-label">{t("hud.paint")}</span>
              {/* Says why it is greyed rather than leaving you to work it out.
                  Painting closes when the hunt starts, and that is a rule of
                  the round, not a thing that went wrong. */}
              {!canPaint && <span className="paint-call-why">{t("hud.paintWhenHiding")}</span>}
            </div>
          )}

          {/* One column, not three things each pinned to their own offset. The
              rail wraps to a second row on a narrow window, and anything
              positioned above it by a fixed number of pixels lands inside it
              when it does — which is exactly what happened at 560px wide. */}
          <div className="hud-bottom">
            {isSeeker && room.phase === "hiding" && (
              <div className="cell-note">
                {t("hud.cellNote", { n: secondsLeft, c: remaining })}
              </div>
            )}

            {!isSeeker && inRound && (
              <div className="pose-readout">
                <span className="pose-readout-label">{t("hud.pose")}</span>
                {t(POSES[pose]?.labelKey ?? "pose.stand")}
              </div>
            )}

            <KeyHints hints={hints} />
          </div>

        </>
      )}

      {/*
        The two rooms say different things about being caught, and the banner is
        where a player finds out which one they are in. In tag it is not even
        shown — you are not out, you are hunting now, and a "잡혔습니다" banner
        over a player who just got a gun would be the opposite of true.
      */}
      {me.caught && spectating && room.phase === "seeking" && !paintMode && (
        <div className="banner spectator-banner">
          <h2>{t("hud.out.title")}</h2>
          <p>{t("hud.out.body")}</p>
        </div>
      )}

      {canLeave && room.phase !== "results" && !paintMode && (
        // Deliberately its own control rather than a line in the results panel:
        // it is live during play too, for a spectator whose round is already
        // over, and it should not move between those two moments.
        <button className="leave-btn" onClick={onLeave}>
          <span>{t("hud.leave")}</span>
          {/* The seeker keeps pointer lock through the results now, so the
              click path is unavailable to them until they press Escape. The
              key is the way out that always works. */}
          <kbd>Enter</kbd>
        </button>
      )}
    </div>
  );
}

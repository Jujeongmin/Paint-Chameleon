import { PHASE_SECONDS, POSES, type Phase } from "../game/constants";
import { Icon } from "./icons";
import { KeyHints, type KeyHint } from "./KeyHints";
import type { PlayerState, RoomInfo } from "../net/types";

const PHASE_LABEL: Record<Phase, string> = {
  lobby: "대기 중",
  hiding: "숨는 시간",
  seeking: "추적",
  results: "결과",
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
      hints.push({ cap: "WASD", icon: "move", label: "이동", tone: "move" });
      hints.push({ cap: "SPACE", icon: "jump", label: "점프", tone: "move" });
      hints.push({ cap: "MOUSE", icon: "look", label: "시점", tone: "move" });
    }
    if (!isSeeker) {
      hints.push({ cap: "G", icon: "pose", label: "자세", tone: "pose", off: !canPose });
      hints.push({
        cap: "R",
        icon: "pin",
        label: charLocked ? "고정 해제" : "캐릭터 고정",
        tone: "pin",
        on: charLocked,
      });
    } else {
      hints.push({
        cap: "CLICK",
        icon: "shoot",
        label: "사격",
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
            <span className="phase-label">{PHASE_LABEL[room.phase]}</span>
            {room.phase !== "lobby" && (
              <span className={"timer" + (secondsLeft <= 10 ? " urgent" : "")}>{secondsLeft}</span>
            )}
            {room.phase !== "lobby" && (
              <span className={"role-chip " + (isSeeker ? "seeker" : "hider")}>
                {isSeeker ? "술래" : "숨는 사람"}
              </span>
            )}
            {room.phase === "seeking" && (
              <span className="phase-label">
                남은 사람 <b className="tally">{remaining}</b>/{hiders.length}
              </span>
            )}
            {charLocked && <span className="role-chip locked">고정됨</span>}
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
              라운드 {room.round} · {players.length}명
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
                  {p.nick || "익명"}
                  {p.account === account ? " (나)" : ""}
                </span>
                <span className="score">{room.scores[p.account] ?? 0}</span>
              </div>
            ))}
            {room.phase === "lobby" && (
              <button className="btn" style={{ marginTop: 10 }} onClick={onToggleReady}>
                {ready ? "준비 취소" : "준비 완료"}
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
              <span className="paint-call-label">페인트</span>
              {/* Says why it is greyed rather than leaving you to work it out.
                  Painting closes when the hunt starts, and that is a rule of
                  the round, not a thing that went wrong. */}
              {!canPaint && <span className="paint-call-why">숨는 시간에만</span>}
            </div>
          )}

          {/* One column, not three things each pinned to their own offset. The
              rail wraps to a second row on a narrow window, and anything
              positioned above it by a fixed number of pixels lands inside it
              when it does — which is exactly what happened at 560px wide. */}
          <div className="hud-bottom">
            {isSeeker && room.phase === "hiding" && (
              <div className="cell-note">
                <strong>{secondsLeft}초</strong> 후 추적이 시작됩니다 · 숨는 사람 {remaining}명
              </div>
            )}

            {!isSeeker && inRound && (
              <div className="pose-readout">
                <span className="pose-readout-label">자세</span>
                {POSES[pose]?.label ?? "서기"}
              </div>
            )}

            <KeyHints hints={hints} />
          </div>

        </>
      )}

      {me.caught && room.phase === "seeking" && !paintMode && (
        <div className="banner">
          <h2>잡혔습니다</h2>
          <p>라운드가 끝날 때까지 관전합니다</p>
        </div>
      )}
    </div>
  );
}

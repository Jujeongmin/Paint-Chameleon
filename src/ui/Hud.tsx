import { POSES, type Phase } from "../game/constants";
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
  const blindfolded = isSeeker && room.phase === "hiding";
  const hiders = players.filter((p) => p.role === "hider");
  const remaining = hiders.filter((p) => !p.caught).length;

  return (
    <div className="overlay">
      {!paintMode && (
        <>
          <div className="hud-top">
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
                남은 사람 {remaining}/{hiders.length}
              </span>
            )}
            {charLocked && <span className="role-chip locked">🔒 고정됨</span>}
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

          <div className="hint">
            {/* Basic controls are a tutorial — drop it once they've been used. */}
            {showControls && (
              <>
                <div>
                  <kbd>W</kbd>
                  <kbd>A</kbd>
                  <kbd>S</kbd>
                  <kbd>D</kbd> 이동 · <kbd>Space</kbd> 점프
                </div>
                <div>마우스로 시점</div>
              </>
            )}
            {!isSeeker && (
              <div>
                <kbd>R</kbd> 캐릭터 고정 {charLocked ? "— 켜짐" : ""}
              </div>
            )}
            <div>
              현재 자세 — {POSES[pose]?.label ?? "서기"}
              {canPose && (
                <>
                  {" · "}
                  <kbd>G</kbd> 자세 고르기
                </>
              )}
              {canPaint && (
                <>
                  {" · "}
                  <kbd>F</kbd> 페인트
                </>
              )}
            </div>
            {isSeeker && room.phase === "seeking" && <div>클릭으로 잡기</div>}
          </div>
        </>
      )}

      {blindfolded && (
        <div className="blindfold">
          <div>
            <h2 style={{ fontSize: 28, margin: "0 0 8px" }}>눈을 감고 있습니다</h2>
            <p style={{ color: "var(--muted)", margin: 0 }}>
              {secondsLeft}초 후 추적이 시작됩니다
            </p>
          </div>
        </div>
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

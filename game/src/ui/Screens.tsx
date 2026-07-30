import { useState } from "react";
import type { PlayerState, RoomInfo } from "../net/types";
import { unlockAudio } from "../audio/sound";

export function ConnectingScreen({ message }: { message?: string }) {
  return (
    <div className="screen">
      <div className="card" style={{ textAlign: "center" }}>
        <h1 className="title">Paint Chameleon</h1>
        <p className="subtitle" style={{ margin: 0 }}>{message ?? "서버에 연결하는 중…"}</p>
      </div>
    </div>
  );
}

export function NickScreen({
  onJoin,
  joining,
  error,
}: {
  onJoin: (nick: string) => void;
  joining: boolean;
  error: string | null;
}) {
  const [nick, setNick] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio();
    onJoin(nick.trim() || "카멜레온");
  };

  return (
    <div className="screen">
      <form className="card" onSubmit={submit}>
        <h1 className="title">Paint Chameleon</h1>
        <p className="subtitle">
          주변 색으로 몸을 칠하고 자세를 잡아 술래를 속이세요.
          <br />
          잘 숨은 곳, 좋은 각도, 그리고 붓질이 전부입니다.
        </p>
        <input
          className="field"
          placeholder="닉네임"
          maxLength={16}
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          autoFocus
        />
        <button className="btn" type="submit" disabled={joining}>
          {joining ? "입장 중…" : "게임 참가"}
        </button>
        {error && (
          <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 0 }}>{error}</p>
        )}
      </form>
    </div>
  );
}

export function ResultsOverlay({
  room,
  players,
  account,
  secondsLeft,
}: {
  room: RoomInfo;
  players: PlayerState[];
  account: string;
  secondsLeft: number;
}) {
  const results = room.lastResults ?? [];
  const nickOf = (acc: string) => players.find((p) => p.account === acc)?.nick || "익명";

  return (
    <div className="overlay">
      <div className="banner" style={{ minWidth: 380 }}>
        <h2>라운드 {room.round} 결과</h2>
        <p>{secondsLeft}초 후 다음 라운드</p>

        <table className="results-table">
          <thead>
            <tr>
              <th>플레이어</th>
              <th>결과</th>
              <th style={{ textAlign: "right" }}>획득</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r: any) => (
              <tr key={r.account}>
                <td style={{ color: r.account === account ? "var(--accent)" : undefined }}>
                  {nickOf(r.account)}
                  {r.account === account ? " (나)" : ""}
                </td>
                <td style={{ color: "var(--muted)" }}>
                  {r.seeker ? "술래" : r.caught ? "발각" : "생존"}
                </td>
                <td className="num">+{r.gained}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function WaitingBanner({ count, needed }: { count: number; needed: number }) {
  return (
    <div className="overlay">
      <div className="banner">
        <h2>플레이어 대기 중</h2>
        <p>
          {count}/{needed}명 · 모두 준비되면 시작합니다
        </p>
      </div>
    </div>
  );
}

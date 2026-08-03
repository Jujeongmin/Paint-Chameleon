import { useState } from "react";
import type { PlayerState, RoomInfo } from "../net/types";
import { unlockAudio } from "../audio/sound";
import { t, type Key } from "./i18n";

export function ConnectingScreen({ message }: { message?: string }) {
  return (
    <div className="screen">
      <div className="card" style={{ textAlign: "center" }}>
        <h1 className="title">{t("app.title")}</h1>
        <p className="subtitle" style={{ margin: 0 }}>{message ?? t("app.connecting")}</p>
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
    onJoin(nick.trim() || t("app.defaultNick"));
  };

  return (
    <div className="screen">
      <form className="card" onSubmit={submit}>
        <h1 className="title">{t("app.title")}</h1>
        <p className="subtitle">
          {t("app.tagline")}
        </p>
        <input
          className="field"
          placeholder={t("app.nickname")}
          maxLength={16}
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          autoFocus
        />
        <button className="btn" type="submit" disabled={joining}>
          {joining ? t("app.joining") : t("app.join")}
        </button>
        {error && (
          <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 0 }}>{error}</p>
        )}
      </form>
    </div>
  );
}

/**
 * Shown once, after joining, while everything expensive is got ready.
 *
 * It is not decoration for a wait that would have happened anyway — the wait
 * used to happen DURING play, as the arena popping in, the gun arriving late
 * into a round, and a hard stall the first time a bot needed a route. Moving
 * all of it in front of the game is the point; see game/src/game/warmup.ts.
 */
export function LoadingScreen({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="screen">
      <div className="card" style={{ textAlign: "center" }}>
        <h1 className="title">{t("app.title")}</h1>
        <p className="subtitle" style={{ margin: "0 0 18px" }}>{label}</p>
        <div className="load-bar">
          <div className="load-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="load-count">
          {done} / {total}
        </div>
      </div>
    </div>
  );
}

export function ResultsOverlay({
  room,
  players,
  account,
  secondsLeft,
  onLeave,
}: {
  room: RoomInfo;
  players: PlayerState[];
  account: string;
  secondsLeft: number;
  onLeave: () => void;
}) {
  const results = room.lastResults ?? [];
  // The server sends an empty nick for the seeker's row, so the player list is
  // the fallback rather than the other way round.
  const nickOf = (r: any) =>
    (r.nameKey ? t(r.nameKey as Key) : r.nick) ||
    players.find((p) => p.account === r.account)?.nick ||
    t("app.anon");

  const mine = results.find((r: any) => r.account === account);
  const hiders = results.filter((r: any) => !r.seeker);
  const caught = hiders.filter((r: any) => r.caught).length;

  // One line saying how it went for YOU. The table says what happened to
  // everybody, which is not the same question and is not the one you ask first.
  const verdict = mine?.seeker
    ? { line: t("results.caughtN", { n: caught }), sub: t("results.ofN", { n: hiders.length }), won: caught * 2 >= hiders.length }
    : mine?.caught
    ? { line: t("results.found"), sub: t("results.foundSub"), won: false }
    : { line: t("results.survived"), sub: t("results.survivedSub"), won: true };

  return (
    <div className="overlay">
      {/*
       * Down the right-hand side, not across the middle.
       *
       * The results phase runs for thirty seconds for one reason: the hiders
       * who were never found glow through the walls, and you are meant to look
       * around and see where they had been. A panel in the centre of the screen
       * covers exactly that — the overlay was hiding the thing the phase exists
       * to show. Nothing here is clickable either, so it takes no input away
       * from a camera you are supposed to be turning.
       */}
      <div className="results-panel">
        <div className="results-round">{t("hud.round", { n: room.round })}</div>
        <div className={"results-verdict" + (verdict.won ? " won" : " lost")}>{verdict.line}</div>
        <div className="results-sub">{verdict.sub}</div>

        <table className="results-table">
          <tbody>
            {results.map((r: any) => (
              <tr key={r.account} className={r.account === account ? "is-me" : undefined}>
                <td className="who">
                  <span
                    className="dot"
                    style={{
                      background: r.seeker
                        ? "var(--seeker)"
                        : r.caught
                        ? "var(--muted)"
                        : "var(--hider)",
                    }}
                  />
                  {nickOf(r)}
                  {r.account === account ? t("app.you") : ""}
                </td>
                <td className="what">{r.seeker ? t("results.statSeeker") : r.caught ? t("results.statCaught") : t("results.statSurvived")}</td>
                <td className="num">+{r.gained}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="results-next">{t("results.next", { n: secondsLeft })}</div>
        <button className="results-leave" onClick={onLeave}>
          <span>{t("hud.leave")}</span>
          <kbd>Enter</kbd>
        </button>
      </div>
    </div>
  );
}

export function WaitingBanner({ count, needed }: { count: number; needed: number }) {
  return (
    <div className="overlay">
      <div className="banner">
        <h2>{t("hud.waiting.title")}</h2>
        <p>{t("hud.waiting.body", { c: count, n: needed })}</p>
      </div>
    </div>
  );
}

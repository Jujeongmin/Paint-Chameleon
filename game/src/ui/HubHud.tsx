import { useEffect, useRef, useState } from "react";
import type { PortalProgress } from "../hub/HubPlayer";
import type { Stand } from "../hub/hubMap";
import type { PlayerState } from "../net/types";
import { ShopPrompt } from "./ShopPrompt";
import type { Wallet } from "./useWallet";

interface Props {
  portalRef: React.MutableRefObject<PortalProgress>;
  /** Written every frame by HubPlayer; polled here alongside `portalRef`. */
  standRef: React.MutableRefObject<Stand | null>;
  players: PlayerState[];
  account: string;
  joining: boolean;
  wallet: Wallet;
}

export function HubHud({
  portalRef,
  standRef,
  players,
  account,
  joining,
  wallet,
}: Props) {
  // The dwell timer lives in a ref so the render loop doesn't re-render React;
  // poll it a few times a second, which is plenty for a progress ring.
  const [state, setState] = useState<PortalProgress>({ portal: null, progress: 0 });
  const [stand, setStand] = useState<Stand | null>(null);
  const last = useRef("");

  useEffect(() => {
    const id = setInterval(() => {
      const current = portalRef.current;
      const key = `${current.portal?.id ?? ""}:${current.progress.toFixed(2)}`;
      if (key !== last.current) {
        last.current = key;
        setState({ ...current });
      }
      // Identity comparison is enough: STANDS is a module-level array, so the
      // same stand is always the same object.
      setStand((prev) => (prev === standRef.current ? prev : standRef.current));
    }, 60);
    return () => clearInterval(id);
  }, [portalRef, standRef]);

  const { portal, progress } = state;

  return (
    <div className="overlay">
      <div className="hud-top">
        <span className="phase-label">로비</span>
        <span className="role-chip hider">{players.length}명 접속 중</span>
        {/* The shop has no panel to read a balance off any more, so it lives
            here permanently. */}
        <span className="role-chip coins">{wallet.wallet?.coins ?? "…"} 코인</span>
      </div>

      <div className="hud-left">
        <div className="hud-heading">여기 있는 사람들</div>
        {players.map((p) => (
          <div key={p.account} className="player-row">
            <span className="dot" style={{ background: "var(--hider)" }} />
            <span className="name">
              {p.nick || "익명"}
              {p.account === account ? " (나)" : ""}
            </span>
          </div>
        ))}
      </div>

      {!joining && <ShopPrompt stand={stand} wallet={wallet} />}

      {/* The cursor is hidden out here too, so the aim point has to be visible. */}
      <div className="crosshair" />

      {/* No control rail down here.
       *
       * The lobby is a room you stand around in rather than a round you are
       * playing, and everything it offers already announces itself where it
       * happens: the stand prompt appears when you step onto a pad, the portal
       * names itself and fills a bar when you walk into it. A permanent strip
       * of chips would be repeating, at the bottom of the screen, what the
       * world is already saying in the place it applies. */}

      {joining && (
        <div className="banner">
          <h2>매칭 중…</h2>
          <p>잠시만 기다려주세요</p>
        </div>
      )}

      {!joining && portal && (
        <div className="portal-prompt">
          <div className="portal-title">{portal.label}</div>
          {portal.available ? (
            <>
              <div className="portal-sub">{portal.sub}</div>
              <div className="portal-bar">
                <div className="portal-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <div className="portal-hint">계속 서 있으면 입장합니다</div>
            </>
          ) : (
            <div className="portal-hint">아직 준비되지 않았습니다</div>
          )}
        </div>
      )}
    </div>
  );
}

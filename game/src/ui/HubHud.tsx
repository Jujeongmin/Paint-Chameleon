import { useEffect, useRef, useState } from "react";
import type { PortalProgress } from "../hub/HubPlayer";
import type { Stand } from "../hub/hubMap";
import type { PlayerState } from "../net/types";
import { ShopPrompt } from "./ShopPrompt";
import { t } from "./i18n";
import type { Wallet } from "./useWallet";

interface Props {
  portalRef: React.MutableRefObject<PortalProgress>;
  /** Written every frame by HubPlayer; polled here alongside `portalRef`. */
  standRef: React.MutableRefObject<Stand | null>;
  guideRef: React.MutableRefObject<boolean>;
  players: PlayerState[];
  account: string;
  joining: boolean;
  wallet: Wallet;
}

export function HubHud({
  portalRef,
  standRef,
  guideRef,
  players,
  account,
  joining,
  wallet,
}: Props) {
  // The dwell timer lives in a ref so the render loop doesn't re-render React;
  // poll it a few times a second, which is plenty for a progress ring.
  const [state, setState] = useState<PortalProgress>({ portal: null, progress: 0 });
  const [stand, setStand] = useState<Stand | null>(null);
  const [showGuide, setShowGuide] = useState(false);
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
      setShowGuide((prev) => (prev === guideRef.current ? prev : guideRef.current));
    }, 60);
    return () => clearInterval(id);
  }, [portalRef, standRef, guideRef]);

  const { portal, progress } = state;

  return (
    <div className="overlay">
      <div className="hud-top">
        <span className="phase-label">{t("hub.title")}</span>
        {/* A headcount is not a role. This wore the hider's teal, which in a
            match means "you are a hider" — the one place in the game where
            that colour carries information. */}
        <span className="role-chip count">{t("hub.online", { n: players.length })}</span>
        {/* The shop has no panel to read a balance off any more, so it lives
            here permanently. */}
        <span className="role-chip coins">
          {wallet.wallet?.coins ?? "…"}
          <span className="chip-unit">{t("hub.coins")}</span>
        </span>
      </div>

      <div className="hud-left">
        <div className="hud-heading">{t("hub.people")}</div>
        {players.map((p) => (
          <div key={p.account} className="player-row">
            <span className="dot" style={{ background: "var(--hider)" }} />
            <span className="name">
              {p.nick || t("app.anon")}
              {p.account === account ? t("app.you") : ""}
            </span>
          </div>
        ))}
      </div>

      {!joining && <ShopPrompt stand={stand} wallet={wallet} />}

      {!joining && showGuide && (
        <section className="guide-panel">
          <div className="guide-eyebrow">{t("guide.eyebrow")}</div>
          <h2>{t("guide.title")}</h2>
          <p className="guide-intro">{t("guide.intro")}</p>
          <div className="guide-grid">
            <div><strong>{t("guide.hideTitle")}</strong><span>{t("guide.hideBody")}</span></div>
            <div><strong>{t("guide.seekTitle")}</strong><span>{t("guide.seekBody")}</span></div>
            <div><strong>{t("guide.tagTitle")}</strong><span>{t("guide.tagBody")}</span></div>
            <div><strong>{t("guide.huntTitle")}</strong><span>{t("guide.huntBody")}</span></div>
          </div>
          <div className="guide-controls">{t("guide.controls")}</div>
          <div className="guide-exit">{t("guide.exit")}</div>
        </section>
      )}

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
          <h2>{t("hub.matching")}</h2>
          <p>{t("hub.matchingSub")}</p>
        </div>
      )}

      {!joining && portal && (
        <div className="portal-prompt">
          <div className="portal-title">{t(portal.labelKey)}</div>
          {portal.available ? (
            <>
              <div className="portal-sub">{portal.subKey ? t(portal.subKey) : ""}</div>
              <div className="portal-bar">
                <div className="portal-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <div className="portal-hint">{t("hub.portalHold")}</div>
            </>
          ) : (
            <div className="portal-hint">{t("hub.portalLocked")}</div>
          )}
        </div>
      )}
    </div>
  );
}

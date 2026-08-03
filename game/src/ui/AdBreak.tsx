import { useEffect } from "react";
import { AD_PANEL_MS } from "../game/coins";
import { t } from "./i18n";
import type { Wallet } from "./useWallet";

interface Props {
  wallet: Wallet;
}

/**
 * The ad, on screen.
 *
 * The one full-screen modal in the hub, and it earns that: an ad you can walk
 * around behind is an ad nobody watches, and the reward is real coins. The
 * shop prompt underneath is deliberately covered.
 *
 * Escape cancels. There is no close button, because a button placed where a
 * real ad network will later draw its own close button is a button players
 * learn to hunt for and then cannot find.
 */
export function AdBreak({ wallet }: Props) {
  const progress = wallet.adProgress;
  const running = progress !== null;

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.preventDefault();
      wallet.cancelAd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, wallet]);

  if (!running) return null;

  const left = Math.max(0, Math.ceil((AD_PANEL_MS * (1 - progress)) / 1000));

  return (
    <div className="ad-break">
      <div className="ad-panel">
        <div className="ad-tag">{t("ad.tag")}</div>
        <div className="ad-body">
          <div className="ad-mark">🦎</div>
          <div className="ad-line">{t("ad.house")}</div>
        </div>
        <div className="ad-bar">
          {/* Width, not transform: the bar is one element and a scaleX would
              stretch nothing else, but it would also stretch the rounded ends
              into ellipses at the start of every ad. */}
          <div className="ad-bar-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="ad-count">{t("ad.remaining", { n: left })}</div>
        <div className="ad-skip">{t("ad.escape")}</div>
      </div>
    </div>
  );
}

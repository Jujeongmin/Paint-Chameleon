import { useEffect } from "react";
import type { Stand } from "../hub/hubMap";
import { standAction } from "./standAction";
import type { Wallet } from "./useWallet";
import { t } from "./i18n";

interface Props {
  /** Stand the player is standing at, or null. */
  stand: Stand | null;
  wallet: Wallet;
}

const LABEL = {
  loading: t("shop.loading"),
  equipped: t("shop.equipping"),
  broke: t("shop.broke"),
} as const;

/**
 * The shop's entire interaction surface: a line at the bottom of the screen
 * while you stand on a mannequin's footprint, and one [E] press to act on it.
 *
 * Deliberately not a panel. The mannequin behind it IS the preview, so
 * anything that dims or covers the world hides the thing being sold — which
 * is exactly what the old modal did. Nothing here freezes movement or needs
 * the cursor, so it stays out of the way of pointer lock too.
 */
export function ShopPrompt({ stand, wallet }: Props) {
  const action = stand ? standAction(stand, wallet.wallet) : null;

  useEffect(() => {
    if (!stand || (action !== "buy" && action !== "equip")) return;
    const onKey = (e: KeyboardEvent) => {
      // `repeat` guard: holding E down would otherwise fire once per key-repeat
      // tick, and this action has no confirmation step to stop it.
      if (e.code !== "KeyE" || e.repeat || wallet.busy) return;
      e.preventDefault();
      if (action === "equip") wallet.equip(stand.id);
      else wallet.buy(stand.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stand, action, wallet]);

  if (!stand || !action) return null;

  return (
    <div className="stand-prompt">
      <div className="stand-name">{t(stand.nameKey)}</div>
      <div className="stand-price">{stand.price === 0 ? t("shop.free") : t("shop.price", { n: stand.price })}</div>
      <div className={"stand-action" + (action === "buy" || action === "equip" ? "" : " denied")}>
        {action === "buy" || action === "equip" ? (
          <>
            <kbd>E</kbd> {action === "buy" ? t("shop.buy") : t("shop.equip")}
          </>
        ) : (
          LABEL[action]
        )}
      </div>
      {wallet.message && <div className="stand-message">{wallet.message}</div>}
    </div>
  );
}

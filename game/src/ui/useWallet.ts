import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_BODY_ID } from "../game/bodies";
import type { BuyFailure, BuyResult, WalletView } from "../net/types";
import { t } from "./i18n";

/** How long a purchase/equip result stays on the prompt before it clears. */
const MESSAGE_MS = 2200;

const REFUSAL: Record<BuyFailure, string> = {
  unknown: t("shop.notForSale"),
  owned: t("shop.owned"),
  broke: t("shop.broke"),
};

interface Api {
  fetchWallet: () => Promise<WalletView>;
  buyAvatar: (id: string) => Promise<BuyResult>;
  equipAvatar: (id: string) => Promise<{ ok: boolean }>;
}

export interface Wallet {
  /** Null until the first fetch lands. */
  wallet: WalletView | null;
  /** Equipped body id, defaulted — safe to render before the wallet arrives. */
  equipped: string;
  /** Transient result of the last buy/equip; clears itself. */
  message: string | null;
  /** True while a write is in flight; the prompt uses it to ignore repeat keys. */
  busy: boolean;
  buy: (id: string) => void;
  equip: (id: string) => void;
}

/**
 * Wallet state for the whole client: the balance the HUD shows, the equipped
 * body the world renders, and the two writes the shop prompt drives.
 *
 * Lives above both because the equipped body is needed to draw the local
 * player before any shop interaction happens, so it can't hang off a panel
 * that only exists while you're standing at a stand.
 */
export function useWallet(api: Api): Wallet {
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The remote functions are read through a ref and never used as dependencies.
  // The offline rehearsal rig rebuilds them as fresh closures every render
  // (`src/net/offline.ts`) because they close over the current React state — so
  // an effect keyed on `fetchWallet` fetches, sets state, re-renders, sees a new
  // identity and fetches again, forever. That loop starves the render loop and
  // freezes the game rather than showing up as a wrong balance.
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    let cancelled = false;
    apiRef.current
      .fetchWallet()
      .then((w) => {
        if (!cancelled) setWallet(w);
      })
      .catch(() => {
        // Cosmetic: the default body is a fine thing to stand in.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const say = useCallback((text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), MESSAGE_MS);
  }, []);

  const buy = useCallback(
    (id: string) => {
      if (busy) return;
      setBusy(true);
      apiRef.current
        .buyAvatar(id)
        .then((res) => {
          if (res.ok) {
            // Use the wallet the write itself returned rather than re-fetching
            // — the offline rig's fetchWallet closes over React state per
            // render and would hand back the pre-purchase balance in the same
            // tick.
            setWallet(res.wallet);
            say(t("shop.bought"));
          } else {
            say(REFUSAL[res.reason]);
          }
        })
        .catch(() => say(t("shop.tryAgain")))
        .finally(() => setBusy(false));
    },
    [busy, say]
  );

  const equip = useCallback(
    (id: string) => {
      if (busy) return;
      setBusy(true);
      apiRef.current
        .equipAvatar(id)
        .then((res) => {
          if (res.ok) setWallet((w) => (w ? { ...w, equipped: id } : w));
          else say(t("shop.cannotEquip"));
        })
        .catch(() => say(t("shop.tryAgain")))
        .finally(() => setBusy(false));
    },
    [busy, say]
  );

  return { wallet, equipped: wallet?.equipped ?? DEFAULT_BODY_ID, message, busy, buy, equip };
}

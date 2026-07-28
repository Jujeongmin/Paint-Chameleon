import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_BODY_ID } from "../game/bodies";
import type { BuyFailure, BuyResult, WalletView } from "../net/types";

/** How long a purchase/equip result stays on the prompt before it clears. */
const MESSAGE_MS = 2200;

const REFUSAL: Record<BuyFailure, string> = {
  unknown: "판매하지 않는 아바타입니다",
  owned: "이미 가지고 있습니다",
  broke: "코인이 부족합니다",
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
export function useWallet({ fetchWallet, buyAvatar, equipAvatar }: Api): Wallet {
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWallet()
      .then((w) => {
        if (!cancelled) setWallet(w);
      })
      .catch(() => {
        // Cosmetic: the default body is a fine thing to stand in.
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWallet]);

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
      buyAvatar(id)
        .then((res) => {
          if (res.ok) {
            // Use the wallet the write itself returned rather than re-fetching
            // — the offline rig's fetchWallet closes over React state per
            // render and would hand back the pre-purchase balance in the same
            // tick.
            setWallet(res.wallet);
            say("구매했습니다");
          } else {
            say(REFUSAL[res.reason]);
          }
        })
        .catch(() => say("잠시 후 다시 시도해주세요"))
        .finally(() => setBusy(false));
    },
    [busy, buyAvatar, say]
  );

  const equip = useCallback(
    (id: string) => {
      if (busy) return;
      setBusy(true);
      equipAvatar(id)
        .then((res) => {
          if (res.ok) setWallet((w) => (w ? { ...w, equipped: id } : w));
          else say("장착할 수 없습니다");
        })
        .catch(() => say("잠시 후 다시 시도해주세요"))
        .finally(() => setBusy(false));
    },
    [busy, equipAvatar, say]
  );

  return { wallet, equipped: wallet?.equipped ?? DEFAULT_BODY_ID, message, busy, buy, equip };
}

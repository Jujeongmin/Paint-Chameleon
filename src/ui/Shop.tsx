import { useCallback, useEffect, useState } from "react";
import { BODIES, DEFAULT_BODY_ID } from "../game/bodies";
import type { BuyFailure, BuyResult, WalletView } from "../net/types";

interface Props {
  fetchWallet: () => Promise<WalletView>;
  buyAvatar: (id: string) => Promise<BuyResult>;
  equipAvatar: (id: string) => Promise<{ ok: boolean }>;
  /** Called whenever the equipped body changes, so the world can re-render it. */
  onEquipped: (id: string) => void;
  onClose: () => void;
}

const REFUSAL: Record<BuyFailure, string> = {
  unknown: "판매하지 않는 아바타입니다",
  owned: "이미 가지고 있습니다",
  broke: "코인이 부족합니다",
};

/** Avatar shop panel — opens on proximity to the hub's shop stand, closes on the close button or Escape. */
export function Shop({ fetchWallet, buyAvatar, equipAvatar, onEquipped, onClose }: Props) {
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    fetchWallet()
      .then(setWallet)
      .catch(() => {
        // Keep whatever we last read — a shop that blanks out on one failed
        // poll is worse than a slightly stale balance.
      });
  }, [fetchWallet]);

  useEffect(reload, [reload]);

  // Escape is the only way out that doesn't need the cursor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onBuy = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await buyAvatar(id);
      if (res.ok) {
        // Use the wallet the write itself returned rather than re-fetching —
        // the offline rig's fetchWallet closes over React state per render and
        // would hand back the pre-purchase balance in the same tick.
        setWallet(res.wallet);
        setMessage("구매했습니다");
      } else {
        setMessage(REFUSAL[res.reason]);
      }
    } catch {
      setMessage("잠시 후 다시 시도해주세요");
    } finally {
      setBusy(false);
    }
  };

  const onEquip = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await equipAvatar(id);
      if (res.ok) {
        setWallet((w) => (w ? { ...w, equipped: id } : w));
        onEquipped(id);
      } else {
        setMessage("장착할 수 없습니다");
      }
    } catch {
      setMessage("잠시 후 다시 시도해주세요");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shop-backdrop" onClick={onClose}>
      <div className="shop" onClick={(e) => e.stopPropagation()}>
        <div className="shop-head">
          <span className="shop-title">아바타 상점</span>
          <span className="shop-coins">{wallet ? `${wallet.coins} 코인` : "…"}</span>
        </div>

        <div className="shop-grid">
          {BODIES.map((b) => {
            const owned = !!wallet?.owned.includes(b.id);
            const equipped = wallet?.equipped === b.id;
            return (
              <div key={b.id} className={"shop-card" + (equipped ? " equipped" : "")}>
                <div className="shop-name">{b.name}</div>
                <div className="shop-price">
                  {b.id === DEFAULT_BODY_ID ? "기본 지급" : `${b.price} 코인`}
                </div>
                {equipped ? (
                  <span className="shop-state">장착 중</span>
                ) : owned ? (
                  <button className="shop-btn" disabled={busy} onClick={() => onEquip(b.id)}>
                    장착
                  </button>
                ) : (
                  <button
                    className="shop-btn buy"
                    disabled={busy || !wallet || wallet.coins < b.price}
                    onClick={() => onBuy(b.id)}
                  >
                    구매
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {message && <div className="shop-message">{message}</div>}

        <div className="shop-foot">
          <span className="shop-hint">옆에 서 있는 마네킹이 실제 크기입니다</span>
          <button className="shop-close" onClick={onClose}>
            닫기 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}

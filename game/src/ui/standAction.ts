import type { WalletView } from "../net/types";

/**
 * What one press of [E] at a stand would do.
 *
 * Pure and separate from the component because it is the whole shop
 * interaction now: with the modal gone there are no buttons whose disabled
 * state documents what is and isn't allowed, just this one keypress. Only
 * `equip` and `buy` do anything.
 *
 * `loading` is a real state, not a defensive branch — the wallet arrives over
 * the network and the player can be standing on a footprint before it lands.
 * Folding it into `broke` would tell them they're short of coins when the
 * balance simply isn't known yet.
 */
export type StandAction = "loading" | "equipped" | "equip" | "buy" | "broke";

export interface StandOffer {
  id: string;
  price: number;
}

export function standAction(stand: StandOffer, wallet: WalletView | null): StandAction {
  if (!wallet) return "loading";
  if (wallet.equipped === stand.id) return "equipped";
  if (wallet.owned.includes(stand.id)) return "equip";
  return wallet.coins >= stand.price ? "buy" : "broke";
}

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_BODY_ID } from "../game/bodies";
import { adsLeft, adReadyAt } from "../game/adRules";
import type { AdClaimResult, AdFailure, AdStartResult, BuyFailure, BuyResult, WalletView } from "../net/types";
import { showAd } from "./adProvider";
import { t } from "./i18n";

/** How long a purchase/equip result stays on the prompt before it clears. */
const MESSAGE_MS = 2200;

/** Gap between attempts to load the wallet. See the fetch effect for why. */
const WALLET_RETRY_MS = 1000;

const REFUSAL: Record<BuyFailure, string> = {
  unknown: t("shop.notForSale"),
  owned: t("shop.owned"),
  broke: t("shop.broke"),
};

/**
 * Every refusal is worded as a thing the player can do something about. The
 * server distinguishes "you have no open ad" from "that one went stale", and
 * from where the player is standing both mean the same: press it again.
 */
const AD_REFUSAL: Record<AdFailure, string> = {
  cooldown: t("ad.cooldown"),
  cap: t("ad.capReached"),
  tooSoon: t("ad.tooSoon"),
  noAd: t("ad.tryAgain"),
  stale: t("ad.tryAgain"),
};

interface Api {
  /**
   * Whether the game server socket is up. The wallet fetch is a remote call and
   * the SDK throws `Cannot read properties of null (reading 'emit')` if the
   * socket has not connected yet — which, on a cold load, it has not.
   */
  connected: boolean;
  fetchWallet: () => Promise<WalletView>;
  buyAvatar: (id: string) => Promise<BuyResult>;
  equipAvatar: (id: string) => Promise<{ ok: boolean }>;
  startAdWatch: () => Promise<AdStartResult>;
  claimAdReward: () => Promise<AdClaimResult>;
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
  /** Re-read persistent coins after an out-of-band server reward. */
  refresh: () => Promise<void>;
  buy: (id: string) => void;
  equip: (id: string) => void;
  /** Rewards left today by the client's own reckoning; display only. */
  adsLeft: number;
  /** True when an ad can be started right now. */
  adReady: boolean;
  watchAd: () => void;
  cancelAd: () => void;
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

  /**
   * Load the wallet, and keep trying until it lands.
   *
   * This used to be a single fetch in a mount effect with no dependencies, and
   * it lost the race with the socket on every cold load: the effect runs as
   * soon as App mounts, the connection is not up yet, and the SDK throws
   * `Cannot read properties of null (reading 'emit')` from inside
   * remoteFunction. The old catch swallowed it as cosmetic, nothing retried,
   * and the shop sat on "Loading…" for the rest of the session — because
   * `standAction` reads a null wallet as "not known yet", which was true and
   * was never going to stop being true.
   *
   * Two things fix it and both are needed. Waiting for `connected` removes the
   * race, and retrying covers the rest: the socket can be up a moment before
   * the server is ready to answer, and it can drop and come back mid-session.
   * The leaderboard never had this bug for the same reason — it polls, so its
   * first failure was always followed by another attempt.
   *
   * Stops the moment a wallet arrives. A wallet is a real thing being waited
   * for, not a poll: it only changes when this client changes it, and every
   * write already returns the new one.
   */
  useEffect(() => {
    if (!api.connected || wallet) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = () => {
      apiRef.current
        .fetchWallet()
        .then((w) => {
          if (!cancelled) setWallet(w);
        })
        .catch(() => {
          // Not cosmetic, but not fatal either — try again shortly. Silent
          // because a failure here is expected during startup, and one that
          // never resolves shows up as the shop saying "Loading…".
          if (!cancelled) timer = setTimeout(attempt, WALLET_RETRY_MS);
        });
    };
    attempt();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api.connected, wallet]);

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

  // Round rewards are written by endRound rather than by a wallet action from
  // this client, so none of buy/equip/watchAd's returned-wallet paths sees
  // them. App calls this after the results phase arrives. It returns a promise
  // so those calls can be kept sequential: an older, slower response must not
  // land after a newer one and put the displayed balance backwards.
  const refresh = useCallback(async () => {
    if (!apiRef.current.connected) return;
    try {
      setWallet(await apiRef.current.fetchWallet());
    } catch {
      // The results screen remains usable if a refresh loses the connection;
      // App retries this call while the server finishes the payout loop.
    }
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

  /**
   * The ad, start to finish, in one place.
   *
   * Three round trips are involved and only two of them are the server's:
   * ask to start, watch, ask for the reward. Splitting them across components
   * would mean a component could be unmounted between the start and the claim —
   * walk off the stand mid-ad and the server keeps an open ticket that the
   * player can never spend. The abort controller is what closes that: leaving
   * cancels, the claim is never sent, and the ticket ages out on its own.
   */
  const adRun = useRef<AbortController | null>(null);

  const watchAd = useCallback(() => {
    if (busy || adRun.current) return;
    const run = new AbortController();
    adRun.current = run;
    setBusy(true);

    const finish = () => {
      if (adRun.current === run) adRun.current = null;
      setBusy(false);
    };

    apiRef.current
      .startAdWatch()
      .then(async (started) => {
        // A refusal still carries a wallet — the server may have cleared a
        // stale ticket on the way, and dropping that would leave the shop
        // showing a count the server no longer agrees with.
        setWallet(started.wallet);
        if (!started.ok) {
          say(AD_REFUSAL[started.reason]);
          return;
        }
        if (run.signal.aborted) return;

        const outcome = await showAd(run.signal);
        // Silent on cancel. The player closed it; they know.
        if (!outcome.completed || run.signal.aborted) return;

        const claimed = await apiRef.current.claimAdReward();
        setWallet(claimed.wallet);
        if (claimed.ok) say(t("ad.earned", { n: claimed.coins }));
        else say(AD_REFUSAL[claimed.reason]);
      })
      .catch(() => say(t("shop.tryAgain")))
      .finally(finish);
  }, [busy, say]);

  const cancelAd = useCallback(() => {
    adRun.current?.abort();
  }, []);

  // Leaving the hub mid-ad has to abort, so a claim is never sent after the
  // player is gone and the server's open ticket ages out on its own.
  useEffect(() => () => adRun.current?.abort(), []);

  const now = Date.now();
  const left = wallet ? adsLeft(wallet, now) : 0;

  return {
    wallet,
    equipped: wallet?.equipped ?? DEFAULT_BODY_ID,
    message,
    busy,
    refresh,
    buy,
    equip,
    adsLeft: left,
    // Both halves are the client's guess and neither is trusted: the server
    // re-decides on every start. This only picks the wording on the prompt.
    adReady: !!wallet && left > 0 && now >= adReadyAt(wallet, now),
    watchAd,
    cancelAd,
  };
}

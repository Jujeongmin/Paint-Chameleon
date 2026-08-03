import { createRoot } from "react-dom/client";
import { Hud } from "./Hud";
import { HubHud } from "./HubHud";
import { PaintTools } from "./PaintTools";
import { ShopPrompt } from "./ShopPrompt";
import { STANDS } from "../hub/hubMap";
import type { Wallet } from "./useWallet";
import { ResultsOverlay, WaitingBanner } from "./Screens";
import type { PlayerState, RoomInfo } from "../net/types";
import "./ui.css";

/**
 * Every HUD state on one page, at /hud-preview.html.
 *
 * The HUD is the one part of this project a check script cannot judge. Whether
 * a control rail reads at a glance is a question about size, contrast and where
 * your eye lands, and the answer only exists on a screen. Getting to it in the
 * game means joining a room, waiting out a hiding phase and being assigned the
 * right role — and the seeker's cell HUD, the seeking rail and the results
 * screen cannot be seen within one round at all, because one player is never
 * all three.
 *
 * So: mount the real components with made-up state instead. Not a mock-up —
 * every pixel here comes from Hud.tsx, KeyHints.tsx and PaintTools.tsx, so the
 * page cannot drift into showing a HUD the game does not have. If a panel moves
 * in the component, it moves here.
 *
 * Each frame below is a scroll-snapped viewport-sized box with the arena's own
 * background behind it, because a HUD judged against white is not judged at all
 * — every panel here is a translucent dark pane and the contrast that matters
 * is against the game, not against paper.
 *
 * Dev only, and it costs the shipped game nothing: `vite build` takes
 * index.html as its single entry, so this page and this file are never in
 * dist. Confirmed by reading the build output, not assumed.
 */

const ACCOUNT = "me";

function player(over: Partial<PlayerState> & { account: string }): PlayerState {
  return { nick: "플레이어", role: "hider", ...over };
}

const PLAYERS: PlayerState[] = [
  player({ account: ACCOUNT, nick: "나", role: "hider" }),
  player({ account: "b", nick: "지민", role: "seeker" }),
  player({ account: "c", nick: "현우" }),
  player({ account: "d", nick: "서연", caught: true }),
  player({ account: "e", nick: "민준" }),
];

function room(over: Partial<RoomInfo>): RoomInfo {
  return {
    kind: "game",
    mode: "tag",
    phase: "hiding",
    phaseEndsAt: 0,
    tickAt: 0,
    round: 3,
    seeker: "b",
    scores: { [ACCOUNT]: 4, b: 7, c: 2, d: 0, e: 1 },
    lastResults: null,
    minPlayers: 2,
    ...over,
  };
}

/** One viewport-sized panel, captioned, over the arena's background colour. */
function Frame({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="preview-frame" id={id}>
      <header className="preview-label">
        <b>{title}</b>
        <span>{note}</span>
      </header>
      {children}
    </section>
  );
}

const HIDER = PLAYERS[0];
const SEEKER = player({ account: ACCOUNT, nick: "나", role: "seeker" });

/**
 * A Wallet with nothing behind it. The preview page has no server and no hub,
 * and the point here is the layout of the two ad surfaces, not the flow that
 * drives them — every callback is deliberately inert.
 */
function fakeWallet(over: Partial<Wallet> = {}): Wallet {
  return {
    wallet: { coins: 40, owned: ["classic"], equipped: "classic", adOpenedAt: 0, adClaimedAt: 0, adDay: 0, adCount: 0 },
    equipped: "classic",
    message: null,
    busy: false,
    refresh: async () => {},
    buy: () => {},
    equip: () => {},
    adsLeft: 7,
    adReady: true,
    watchAd: () => {},
    cancelAd: () => {},
    ...over,
  };
}

function Preview() {
  return (
    <>
      <Frame id="lobby" title="로비" note="하단에 아무것도 없어야 합니다 — 레일도, 자세 표시도, 페인트도">
        <Hud
          room={room({ phase: "lobby" })}
          me={HIDER}
          players={PLAYERS}
          account={ACCOUNT}
          secondsLeft={0}
          pose={0}
          paintMode={false}
          canPaint={false}
          canPose={false}
          charLocked={false}
          ready={false}
          onToggleReady={() => {}}
          mode="tag"
          spectating={false}
          canLeave={false}
          onLeave={() => {}}
          showControls
        />
      </Frame>

      <Frame id="hiding" title="숨는 시간 · 하이더" note="레일 전체가 살아 있고, 우측 중앙 페인트도 켜져 있어야 합니다">
        <Hud
          room={room({ phase: "hiding" })}
          me={HIDER}
          players={PLAYERS}
          account={ACCOUNT}
          secondsLeft={22}
          pose={2}
          paintMode={false}
          canPaint
          canPose
          charLocked={false}
          ready
          onToggleReady={() => {}}
          mode="tag"
          spectating={false}
          canLeave={false}
          onLeave={() => {}}
          showControls
        />
      </Frame>

      <Frame id="locked" title="숨는 시간 · R 고정" note="R 칩만 테두리가 살아나고 이름이 바뀝니다">
        <Hud
          room={room({ phase: "hiding" })}
          me={HIDER}
          players={PLAYERS}
          account={ACCOUNT}
          secondsLeft={8}
          pose={2}
          paintMode={false}
          canPaint
          canPose
          charLocked
          ready
          onToggleReady={() => {}}
          mode="tag"
          spectating={false}
          canLeave={false}
          onLeave={() => {}}
          showControls
        />
      </Frame>

      <Frame id="hunted" title="추적 · 하이더" note="자세와 페인트가 흐려지고, 페인트는 그 이유를 답니다">
        <Hud
          room={room({ phase: "seeking" })}
          me={HIDER}
          players={PLAYERS}
          account={ACCOUNT}
          secondsLeft={9}
          pose={2}
          paintMode={false}
          canPaint={false}
          canPose={false}
          charLocked={false}
          ready
          onToggleReady={() => {}}
          mode="tag"
          spectating={false}
          canLeave={false}
          onLeave={() => {}}
          showControls={false}
        />
      </Frame>

      <Frame id="cell" title="숨는 시간 · 술래(셀)" note="사격은 아직 흐리고, 페인트는 셀 안이라 켜져 있습니다">
        <Hud
          room={room({ phase: "hiding" })}
          me={SEEKER}
          players={PLAYERS}
          account={ACCOUNT}
          secondsLeft={14}
          pose={0}
          paintMode={false}
          canPaint
          canPose={false}
          charLocked={false}
          ready
          onToggleReady={() => {}}
          mode="tag"
          spectating={false}
          canLeave={false}
          onLeave={() => {}}
          showControls={false}
        />
      </Frame>

      <Frame id="seeking" title="추적 · 술래" note="사격만 남고, 타이머가 마지막 10초에 들어가 깜빡입니다">
        <Hud
          room={room({ phase: "seeking" })}
          me={SEEKER}
          players={PLAYERS}
          account={ACCOUNT}
          secondsLeft={6}
          pose={0}
          paintMode={false}
          canPaint={false}
          canPose={false}
          charLocked={false}
          ready
          onToggleReady={() => {}}
          mode="tag"
          spectating={false}
          canLeave={false}
          onLeave={() => {}}
          showControls={false}
        />
      </Frame>

      <Frame id="results" title="결과" note="가운데는 비어 있어야 합니다 — 안 잡힌 하이더가 벽 너머로 빛나는 걸 봐야 하니까">
        <Hud
          room={room({ phase: "results" })}
          me={SEEKER}
          players={PLAYERS}
          account={ACCOUNT}
          secondsLeft={21}
          pose={0}
          paintMode={false}
          canPaint={false}
          canPose={false}
          charLocked={false}
          ready
          onToggleReady={() => {}}
          mode="tag"
          spectating={false}
          canLeave
          onLeave={() => {}}
          showControls={false}
        />
        <ResultsOverlay
          room={room({
            phase: "results",
            lastResults: [
              { account: ACCOUNT, nick: "나", caught: false, gained: 9, seeker: true },
              { account: "c", nick: "현우", caught: true, gained: 5 },
              { account: "d", nick: "서연", caught: true, gained: 5 },
              { account: "e", nick: "민준", caught: false, gained: 10 },
            ],
          })}
          players={PLAYERS}
          account={ACCOUNT}
          secondsLeft={21}
        />
      </Frame>

      <Frame id="spectating" title="탈락 · 생존 모드" note="몸은 사라지고, 나가기 버튼이 살아납니다">
        <Hud
          room={room({ phase: "seeking", mode: "hunt" })}
          me={player({ account: ACCOUNT, nick: "나", role: "hider", caught: true, spectating: true })}
          players={PLAYERS}
          account={ACCOUNT}
          secondsLeft={38}
          pose={0}
          paintMode={false}
          canPaint={false}
          canPose={false}
          charLocked={false}
          ready
          onToggleReady={() => {}}
          mode="hunt"
          spectating
          canLeave
          onLeave={() => {}}
          showControls={false}
        />
      </Frame>

      <Frame id="waiting" title="대기" note="정원이 안 찼을 때">
        <WaitingBanner count={1} needed={2} />
      </Frame>

      <Frame id="hub" title="허브" note="하단은 비고, 상점·포털은 다가갔을 때만 말합니다">
        <HubHud
          portalRef={{ current: { portal: null, progress: 0 } } as any}
          standRef={{ current: null } as any}
          players={[
            { account: ACCOUNT, nick: "나" },
            { account: "b", nick: "지민" },
            { account: "c", nick: "현우" },
          ]}
          account={ACCOUNT}
          joining={false}
          wallet={{ wallet: { coins: 140, owned: ["classic"], equipped: "classic" }, busy: false, message: null } as any}
        />
      </Frame>

      <Frame id="paint" title="페인트 모드" note="HUD는 통째로 물러나고 도구만 남습니다">
        <div className="overlay">
          <PaintTools
            zoom={40}
            onZoom={() => {}}
            brushSize={0.12}
            onBrushSize={() => {}}
            hue={0.08}
            sat={0.8}
            value={0.95}
            onColor={() => {}}
            onValue={() => {}}
            tool="brush"
            onTool={() => {}}
            onFill={() => {}}
            onExit={() => {}}
          />
        </div>
      </Frame>

      <Frame
        id="shop-ad"
        title="아바타 스탠드 · 광고 줄"
        note="구매 줄 아래에 광고 줄이 붙습니다 — 조용해야 하고, 살 수 없는 아바타 앞에서도 보여야 합니다"
      >
        <ShopPrompt stand={STANDS[1]} wallet={fakeWallet({ adReady: true })} />
      </Frame>

      <Frame id="shop-ad-off" title="아바타 스탠드 · 광고 없음" note="쿨다운이거나 오늘 다 봤을 때. 회색이고 F는 안내되지 않습니다">
        <ShopPrompt stand={STANDS[1]} wallet={fakeWallet({ adReady: false })} />
      </Frame>

    </>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);

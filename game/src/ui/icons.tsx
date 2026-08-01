/**
 * The HUD's icon set.
 *
 * Inline SVG rather than an icon font or emoji, for three reasons: nothing is
 * fetched (the arena already spends the network budget on models and
 * textures), every glyph inherits `currentColor` so a chip's state colours its
 * icon for free, and emoji render as somebody else's artwork on every platform
 * — the seeker's blaster would be a water pistol on one machine and a revolver
 * on the next.
 *
 * All of them are drawn on the same 24x24 grid with the same 1.9 stroke, so a
 * row of them reads as one set rather than as seven separate pictures.
 */

const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export type IconName = "move" | "jump" | "look" | "pose" | "paint" | "pin" | "shoot" | "shop";

/** Four arrowheads around a hollow centre — the shape WASD makes on a keyboard. */
function Move() {
  return (
    <svg {...BASE} aria-hidden>
      <path d="M12 3.5 9.6 6.4h4.8L12 3.5Z" fill="currentColor" stroke="none" />
      <path d="M12 20.5 9.6 17.6h4.8L12 20.5Z" fill="currentColor" stroke="none" />
      <path d="M3.5 12 6.4 9.6v4.8L3.5 12Z" fill="currentColor" stroke="none" />
      <path d="M20.5 12 17.6 9.6v4.8L20.5 12Z" fill="currentColor" stroke="none" />
      <rect x="9" y="9" width="6" height="6" rx="1.4" />
    </svg>
  );
}

/** A body leaving the ground, with the ground still drawn under it. */
function Jump() {
  return (
    <svg {...BASE} aria-hidden>
      <path d="M12 14V5" />
      <path d="M8.4 8.6 12 5l3.6 3.6" />
      <path d="M4.5 18.5h15" strokeDasharray="3 3" />
    </svg>
  );
}

/** A mouse, with the arcs that say it turns you rather than clicks. */
function Look() {
  return (
    <svg {...BASE} aria-hidden>
      <rect x="8" y="3.5" width="8" height="13" rx="4" />
      <path d="M12 6.5v3" />
      <path d="M4.5 19.5c1.4 1.2 3 1.2 4.4 0" />
      <path d="M15.1 19.5c1.4 1.2 3 1.2 4.4 0" />
    </svg>
  );
}

/** A figure holding still — what a pose is for. */
function Pose() {
  return (
    <svg {...BASE} aria-hidden>
      <circle cx="12" cy="5.4" r="2.2" />
      <path d="M12 7.8v6.4" />
      <path d="M6.6 10.4 12 9l5.4 1.4" />
      <path d="m12 14.2-2.8 6" />
      <path d="m12 14.2 2.8 6" />
    </svg>
  );
}

/** A brush, loaded. The head is filled because that is the paint. */
function Paint() {
  return (
    <svg {...BASE} aria-hidden>
      <path d="m19.4 4.6-7.6 7.6" />
      <path d="M13.9 9.1 6.4 16.6a3.6 3.6 0 0 0-1 2.1l-.2 1.6 1.6-.2a3.6 3.6 0 0 0 2.1-1l7.5-7.5Z" fill="currentColor" fillOpacity="0.45" />
    </svg>
  );
}

/** A pin through a point — the body stays where it is put. */
function Pin() {
  return (
    <svg {...BASE} aria-hidden>
      <path d="M12 21v-6" />
      <path d="M8.2 4h7.6l-1 4.4 2.2 2.6v1.4H7l0-1.4 2.2-2.6L8.2 4Z" fill="currentColor" fillOpacity="0.35" />
    </svg>
  );
}

/** A reticle with the shot already leaving it. */
function Shoot() {
  return (
    <svg {...BASE} aria-hidden>
      <circle cx="12" cy="12" r="6.4" />
      <path d="M12 2.6v3.2M12 18.2v3.2M2.6 12h3.2M18.2 12h3.2" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A price tag — the stands sell bodies, and the price is the whole decision. */
function Shop() {
  return (
    <svg {...BASE} aria-hidden>
      <path d="M12.6 3.5H20v7.4l-8.5 8.5a1.6 1.6 0 0 1-2.2 0l-5.2-5.2a1.6 1.6 0 0 1 0-2.2l8.5-8.5Z" />
      <circle cx="16.4" cy="7.1" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

const ICONS: Record<IconName, () => JSX.Element> = {
  move: Move,
  jump: Jump,
  look: Look,
  pose: Pose,
  paint: Paint,
  pin: Pin,
  shoot: Shoot,
  shop: Shop,
};

export function Icon({ name }: { name: IconName }) {
  const Glyph = ICONS[name];
  return <Glyph />;
}

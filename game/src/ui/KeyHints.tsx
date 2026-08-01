import { Icon, type IconName } from "./icons";

/**
 * The control rail: one chip per thing you can do right now.
 *
 * It replaces a right-aligned stack of 12px grey sentences that said the same
 * things. Two problems with that stack, and this is shaped around both.
 *
 * It was unreadable at a glance. A player mid-round is looking at the middle of
 * the screen, and the answer to "how do I paint" was four words into the third
 * line of grey text in a corner. A chip is a target the eye can land on: icon
 * first, key second, name third, in that order because that is the order you
 * ask the questions in.
 *
 * And it said nothing about WHEN. Painting and posing only work while you are
 * hiding, the gun only exists during the chase, and the old text simply
 * appeared and vanished — so a control you used last round was gone with no
 * explanation. A chip that is not usable now stays on the rail, dimmed, with
 * its paint stripe drained. You can see the thing exists and that this is not
 * its moment.
 *
 * The chips are 64px squares on purpose: the paint panel's PICKER and FILL
 * buttons are the same size and shape, so the two halves of the game read as
 * one interface instead of two.
 */

export interface KeyHint {
  /** What is printed on the cap. Latin on purpose — it matches the keyboard. */
  cap: string;
  icon: IconName;
  /** Korean, because it names the action rather than the hardware. */
  label: string;
  /** Which stripe colour. Ties the chip to the state it belongs to. */
  tone: "move" | "hider" | "seeker" | "paint" | "pose" | "pin";
  /** Greyed and drained: the control exists, but not in this phase. */
  off?: boolean;
  /** Currently engaged — only the pin uses this so far. */
  on?: boolean;
}

export function KeyHints({ hints }: { hints: KeyHint[] }) {
  if (hints.length === 0) return null;
  return (
    <div className="keyrail">
      {hints.map((h) => (
        <div
          key={h.cap + h.label}
          className={
            "keychip tone-" + h.tone + (h.off ? " is-off" : "") + (h.on ? " is-on" : "")
          }
        >
          <span className="keychip-icon">
            <Icon name={h.icon} />
          </span>
          <span className="keychip-cap">{h.cap}</span>
          <span className="keychip-label">{h.label}</span>
        </div>
      ))}
    </div>
  );
}

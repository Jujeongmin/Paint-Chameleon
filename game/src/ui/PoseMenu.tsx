import { POSES } from "../game/constants";
import { t } from "./i18n";

interface Props {
  current: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}

/** Full-body pose picker — opens with G, closes on selection or Escape. */
export function PoseMenu({ current, onSelect, onClose }: Props) {
  return (
    <div className="pose-menu-backdrop" onClick={onClose}>
      <div className="pose-menu" onClick={(e) => e.stopPropagation()}>
        <div className="pose-menu-title">{t("paint.poseMenu")}</div>
        <div className="pose-grid">
          {POSES.map((spec, i) => (
            <button
              key={spec.id}
              className={"pose-card" + (i === current ? " active" : "")}
              onClick={() => onSelect(i)}
            >
              <PoseGlyph poseId={spec.id} />
              <span>{t(spec.labelKey)}</span>
            </button>
          ))}
        </div>
        <button className="pose-menu-close" onClick={onClose}>
          {t("paint.closeMenu")}
        </button>
      </div>
    </div>
  );
}

/**
 * Tiny stick-figure icons so the grid reads at a glance instead of as a wall
 * of Korean labels. Pure SVG, no asset files.
 */
function PoseGlyph({ poseId }: { poseId: string }) {
  const limbs: Record<string, { arms: string; legs: string; body?: string }> = {
    stand: { arms: "M8 8 L4 15 M16 8 L20 15", legs: "M10 16 L8 23 M14 16 L16 23" },
    lie: {
      arms: "M6 12 L2 9",
      legs: "M16 12 L22 12",
      body: "M6 12 H18",
    },
    banzai: { arms: "M12 6 L5 1 M12 6 L19 1", legs: "M10 16 L8 23 M14 16 L16 23" },
    sit: {
      arms: "M8 11 L4 15",
      legs: "M12 16 L6 16 M6 16 L6 22",
      body: "M12 5 v6",
    },
  };

  const g = limbs[poseId] ?? limbs.stand;

  return (
    <svg viewBox="0 0 24 24" width="30" height="30" className="pose-glyph">
      <circle cx="12" cy="4" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d={g.body ?? "M12 6 v10"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d={g.arms} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d={g.legs} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

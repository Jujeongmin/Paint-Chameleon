import { ColorWheel, hsvToRgb, toCss } from "./ColorWheel";
import { BRUSH } from "../game/constants";
import type { Tool } from "../game/useBrush";
import { t } from "./i18n";

interface Props {
  zoom: number;
  onZoom: (v: number) => void;
  brushSize: number;
  onBrushSize: (v: number) => void;
  hue: number;
  sat: number;
  value: number;
  onColor: (hue: number, sat: number) => void;
  onValue: (value: number) => void;
  tool: Tool;
  onTool: (tool: Tool) => void;
  onFill: () => void;
  onExit: () => void;
}

/** Vertical slider built from a rotated range input — reliable across browsers. */
function VerticalSlider({
  label,
  readout,
  value,
  min,
  max,
  onChange,
  height,
}: {
  label: string;
  readout: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  height: number;
}) {
  return (
    <div className="vslider">
      <span className="vslider-label">{label}</span>
      <div className="vslider-track" style={{ height }}>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: height }}
        />
      </div>
      <span className="vslider-readout">{readout}</span>
    </div>
  );
}

export function PaintTools({
  zoom,
  onZoom,
  brushSize,
  onBrushSize,
  hue,
  sat,
  value,
  onColor,
  onValue,
  tool,
  onTool,
  onFill,
  onExit,
}: Props) {
  return (
    <>
      <div className="paint-left">
        <VerticalSlider
          label="ZOOM"
          readout={`${zoom}%`}
          value={zoom}
          min={0}
          max={100}
          onChange={onZoom}
          height={200}
        />
      </div>

      <div className="paint-right">
        {/* The slider works in whole centimetres because a range input with a
            0.01 step reads back floating-point dust; brush size itself is world
            units, so the two ends are BRUSH.min and BRUSH.max scaled by 100. */}
        <VerticalSlider
          label=""
          readout={`${Math.round(brushSize * 100)}`}
          value={Math.round(brushSize * 100)}
          min={Math.round(BRUSH.min * 100)}
          max={Math.round(BRUSH.max * 100)}
          onChange={(v) => onBrushSize(v / 100)}
          height={190}
        />
        <span className="brush-caption">BRUSH SIZE</span>
      </div>

      <div className="paint-panel-right">
        <div className="wheel-card">
          <ColorWheel
            hue={hue}
            sat={sat}
            value={value}
            onChange={onColor}
            onValueChange={onValue}
          />
        </div>

        <div className="tool-row">
          <button
            className={"tool-square picker" + (tool === "picker" ? " active" : "")}
            onClick={() => onTool(tool === "picker" ? "brush" : "picker")}
            title={t("paint.picker")}
          >
            <span className="tool-glyph">🖉</span>
            <span className="tool-name">PICKER</span>
          </button>

          <button className="tool-square fill" onClick={onFill} title={t("paint.fill")}>
            <span className="tool-glyph" style={{ background: toCss(hsvToRgb(hue, sat, value)) }} />
            <span className="tool-name">FILL</span>
          </button>
        </div>

        <div className="key-hint">[F]</div>

        <button className="paint-exit" onClick={onExit}>
          <span className="paint-exit-glyph">🖌</span>
          <span>PAINT</span>
        </button>
      </div>
    </>
  );
}

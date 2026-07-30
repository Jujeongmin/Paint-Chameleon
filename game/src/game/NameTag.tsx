import { useEffect, useMemo } from "react";
import * as THREE from "three";

/**
 * Billboarded name label.
 *
 * Drawn to a canvas and shown on a sprite rather than pulled in through a text
 * library — the paint system already gives us canvas textures, and troika would
 * add a few hundred kB to the bundle for six words of UI.
 */

const PAD = 16;
const FONT_PX = 44;

function makeTexture(text: string, color: string): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  ctx.font = `700 ${FONT_PX}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const width = Math.ceil(ctx.measureText(text).width) + PAD * 2;
  const height = FONT_PX + PAD * 2;

  canvas.width = width;
  canvas.height = height;

  // Re-set: resizing the canvas resets the 2d context.
  ctx.font = `700 ${FONT_PX}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "rgba(12, 15, 20, 0.55)";
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, 14);
  ctx.fill();

  // Outline first so the label stays readable against any wall colour.
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.strokeText(text, width / 2, height / 2 + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height };
}

interface Props {
  text: string;
  color?: string;
  height?: number;
  /** World-space height above the player's feet. */
  y?: number;
}

export function NameTag({ text, color = "#ffffff", height = 0.34, y = 2.15 }: Props) {
  const { texture, aspect } = useMemo(() => makeTexture(text, color), [text, color]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={[0, y, 0]} scale={[height * aspect, height, 1]}>
      <spriteMaterial
        map={texture}
        transparent
        depthWrite={false}
        // Labels should stay legible even when a wall is between us and them.
        depthTest={false}
        toneMapped={false}
      />
    </sprite>
  );
}

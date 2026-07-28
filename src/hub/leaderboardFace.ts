/**
 * Painting for the leaderboard monument's face.
 *
 * Separate from the component that hangs it in the world so it can be run and
 * looked at on its own — the scene only renders inside an animation frame, and
 * this is 2D canvas work that doesn't need one. It is the part with layout
 * that can be wrong (columns colliding, long nicknames overrunning), so being
 * able to paint it into an image without booting the renderer is the point.
 */

import type { LeaderboardResult, RankedLeaderboardEntry } from "../net/types";

/** Texture resolution. The face is read from a few metres away, so it has to be sharp. */
export const TEX_W = 1024;
export const TEX_H = 592;

const PAD = 28;
const TITLE_H = 62;
const BOTTOM_PAD = 20;
const DIVIDER_H = 14;
/** Top ten, plus your own row when you're outside it. */
const MAX_ROWS = 10;

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const COLOR = {
  panel: "#181d26",
  line: "rgba(255, 255, 255, 0.12)",
  text: "#eef1f6",
  muted: "#98a1b2",
  accent: "#6fbf5c",
  warn: "#e8a13f",
};

function drawRow(
  ctx: CanvasRenderingContext2D,
  entry: RankedLeaderboardEntry,
  account: string,
  y: number,
  rowH: number
): void {
  const mine = entry.account === account;
  const mid = y + rowH / 2;

  if (mine) {
    ctx.fillStyle = "rgba(111, 191, 92, 0.12)";
    ctx.beginPath();
    ctx.roundRect(PAD - 8, y, TEX_W - (PAD - 8) * 2, rowH, 8);
    ctx.fill();
  }

  ctx.textBaseline = "middle";

  // The podium is the reward, so it gets the warm colour.
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = entry.rank <= 3 ? COLOR.warn : COLOR.muted;
  ctx.textAlign = "right";
  ctx.fillText(String(entry.rank), PAD + 46, mid);

  ctx.font = `${mine ? 700 : 600} 30px ${FONT}`;
  ctx.fillStyle = mine ? COLOR.accent : COLOR.text;
  ctx.textAlign = "left";
  // Long nicknames must not run into the score column.
  const nameLeft = PAD + 70;
  const nameRight = TEX_W - PAD - 150;
  let name = (entry.nick || "익명") + (mine ? " (나)" : "");
  if (ctx.measureText(name).width > nameRight - nameLeft) {
    while (name.length > 1 && ctx.measureText(name + "…").width > nameRight - nameLeft) {
      name = name.slice(0, -1);
    }
    name += "…";
  }
  ctx.fillText(name, nameLeft, mid);

  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = mine ? COLOR.accent : COLOR.text;
  ctx.textAlign = "right";
  ctx.fillText(String(entry.total), TEX_W - PAD, mid);
}

/** Paints the whole face. The context must already be TEX_W x TEX_H. */
export function paintLeaderboardFace(
  ctx: CanvasRenderingContext2D,
  data: LeaderboardResult | null,
  account: string
): void {
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  ctx.font = `700 38px ${FONT}`;
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("명예의 전당", TEX_W / 2, PAD + 20);

  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, PAD + TITLE_H - 12);
  ctx.lineTo(TEX_W - PAD, PAD + TITLE_H - 12);
  ctx.stroke();

  const top = data?.top ?? [];

  if (top.length === 0) {
    ctx.font = `500 30px ${FONT}`;
    ctx.fillStyle = COLOR.muted;
    ctx.textAlign = "center";
    ctx.fillText("아직 기록이 없습니다", TEX_W / 2, TEX_H / 2 + 10);
    return;
  }

  // Row height is fixed by the full ten-plus-you layout rather than by how many
  // rows exist today, so the board doesn't resize its own type as people join —
  // a leaderboard filling in must not reflow what's already being read.
  const body = TEX_H - PAD - TITLE_H - BOTTOM_PAD;
  const rowH = (body - DIVIDER_H) / (MAX_ROWS + 1);

  let y = PAD + TITLE_H;
  for (const entry of top.slice(0, MAX_ROWS)) {
    drawRow(ctx, entry, account, y, rowH);
    y += rowH;
  }

  // Your own standing, when you didn't make the top ten.
  if (data?.me && !top.some((e) => e.account === data.me!.account)) {
    const base = PAD + TITLE_H + rowH * MAX_ROWS;
    ctx.strokeStyle = COLOR.line;
    ctx.beginPath();
    ctx.moveTo(PAD, base + DIVIDER_H / 2);
    ctx.lineTo(TEX_W - PAD, base + DIVIDER_H / 2);
    ctx.stroke();
    drawRow(ctx, data.me, account, base + DIVIDER_H, rowH);
  }
}

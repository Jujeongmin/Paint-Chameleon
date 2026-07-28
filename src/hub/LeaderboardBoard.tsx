import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { NameTag } from "../game/NameTag";
import { LEADERBOARD, LEADERBOARD_FACE_Z } from "./hubMap";
import { TEX_H, TEX_W, paintLeaderboardFace } from "./leaderboardFace";
import type { LeaderboardResult } from "../net/types";

/**
 * The all-time leaderboard, painted onto the face of the hub monument.
 *
 * Canvas texture on a plane rather than a text library, for the same reason
 * NameTag does it: the paint system already gives us canvas textures, and
 * troika would cost a few hundred kB for a scoreboard.
 *
 * Unlike NameTag this is NOT a billboard and it DOES depth-test — it's the
 * surface of a physical object, so it has to be occluded by the world and turn
 * away with it. Reading it means walking round to the front. Unlit
 * (meshBasicMaterial) so the text keeps its designed contrast wherever the
 * monument ends up standing relative to the sun.
 */

/** Face size, inset from the board so the frame shows around it. */
const FACE_W = LEADERBOARD.width - 0.5;
const FACE_H = LEADERBOARD.height - 0.6;

function makeTexture(data: LeaderboardResult | null, account: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  paintLeaderboardFace(canvas.getContext("2d")!, data, account);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Props {
  data: LeaderboardResult | null;
  account: string;
}

export function LeaderboardBoard({ data, account }: Props) {
  const texture = useMemo(() => makeTexture(data, account), [data, account]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <>
      <mesh position={[LEADERBOARD.x, LEADERBOARD.height / 2, LEADERBOARD_FACE_Z]}>
        <planeGeometry args={[FACE_W, FACE_H]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      {/* NameTag draws at [0, y, 0] in its parent's space. */}
      <group position={[LEADERBOARD.x, 0, LEADERBOARD.z]}>
        <NameTag text="리더보드" y={3.9} height={0.52} color="#e8a13f" />
      </group>
    </>
  );
}

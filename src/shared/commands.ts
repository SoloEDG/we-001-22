import type { Point, Terrain } from "./types";
export type Command =
  | { kind: "cell"; point: Point }
  | { kind: "select"; id: string }
  | { kind: "skill"; id: string }
  | { kind: "wait" }
  | { kind: "paint"; terrain: Terrain }
  | { kind: "seek"; cursor: number }
  | { kind: "reset" };

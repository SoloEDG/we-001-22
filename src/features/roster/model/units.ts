import type { Unit, Profession } from "../../../shared/types";
import { professions } from "./professions";
export function createUnits(): Unit[] {
  return (
    [
      ["a1", "凛", "ranger", 2, 3, "azure"],
      ["a2", "铎", "guard", 2, 4, "azure"],
      ["a3", "诺亚", "mage", 1, 2, "azure"],
      ["a4", "芙", "medic", 1, 5, "azure"],
      ["e1", "斥候", "ranger", 9, 4, "ember"],
      ["e2", "铁卫", "guard", 8, 3, "ember"],
      ["e3", "焰使", "mage", 10, 2, "ember"],
    ] as [string, string, Profession, number, number, Unit["team"]][]
  ).map(([id, name, job, x, y, team]) => ({
    ...professions[job],
    id,
    name,
    job,
    x,
    y,
    team,
    maxHp: professions[job].hp,
    statuses: [],
    moved: false,
    acted: false,
  }));
}

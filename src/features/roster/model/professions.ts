import type { Profession } from "../../../shared/types";
export const professions: Record<
  Profession,
  {
    name: string;
    hp: number;
    power: number;
    armor: number;
    speed: number;
    move: number;
  }
> = {
  guard: { name: "重装卫士", hp: 36, power: 10, armor: 4, speed: 7, move: 4 },
  ranger: { name: "游侠", hp: 26, power: 9, armor: 1, speed: 12, move: 6 },
  mage: { name: "秘术师", hp: 22, power: 12, armor: 0, speed: 9, move: 4 },
  medic: { name: "医师", hp: 24, power: 8, armor: 1, speed: 8, move: 5 },
};

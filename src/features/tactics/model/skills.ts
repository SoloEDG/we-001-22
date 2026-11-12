import type { Profession, Skill } from "../../../shared/types";
export const skillBook: Record<Profession, Skill[]> = {
  guard: [
    {
      id: "strike",
      name: "重斩",
      range: 1,
      power: 4,
      target: "enemy",
      description: "相邻目标，护甲抵扣伤害",
    },
    {
      id: "brace",
      name: "壁垒",
      range: 0,
      power: 0,
      target: "self",
      status: "guard",
      description: "获得防御，持续 2 次自身行动",
    },
  ],
  ranger: [
    {
      id: "shot",
      name: "穿林箭",
      range: 4,
      power: 2,
      target: "enemy",
      status: "slow",
      description: "直线视野，施加迟缓 2 回合",
    },
  ],
  mage: [
    {
      id: "flame",
      name: "余焰",
      range: 3,
      power: 4,
      target: "enemy",
      status: "burn",
      description: "命中并灼烧，持续 2 次自身行动",
    },
  ],
  medic: [
    {
      id: "heal",
      name: "愈合",
      range: 3,
      power: 8,
      target: "ally",
      description: "恢复生命，不超过生命上限",
    },
    {
      id: "pulse",
      name: "震荡",
      range: 2,
      power: 0,
      target: "enemy",
      description: "近程伤害",
    },
  ],
};
export const getSkill = (job: Profession, id: string) =>
  skillBook[job].find((s) => s.id === id);

/**
 * Offline agent skills: rule-based stand-ins for Claude, selected by AgentDefinition.offlineSkill.
 * Every skill gets its data only through ctx.callTool, so the tool gateway governs it like any agent.
 */
import type { AgentOutput } from "../../kernel/types";
import { architecture, codeReview, devops, docs, implementation, qa, security } from "./code";
import { brand, localization, seo, ux } from "./content";
import { finance, legal } from "./business";
import { commander, memory, planning, research, scheduler } from "./system";
import type { Skill, SkillContext } from "./context";

export type { Skill, SkillContext } from "./context";

const SKILLS: Record<string, Skill> = {
  commander,
  memory,
  security,
  scheduler,
  ux,
  architecture,
  implementation,
  qa,
  code_review: codeReview,
  devops,
  planning,
  docs,
  research,
  localization,
  brand,
  seo,
  legal,
  finance,
};

export const OFFLINE_SKILLS = Object.keys(SKILLS);

export async function runOfflineSkill(name: string, ctx: SkillContext): Promise<AgentOutput> {
  const skill = Object.hasOwn(SKILLS, name) ? SKILLS[name] : undefined;
  if (!skill) {
    return {
      summary: `No offline skill named "${name}".`,
      findings: [],
      artifacts: [],
      confidence: 0,
      source: "offline",
      limitation: `Agent ${ctx.agent.id} has no offline skill; it needs Claude`,
    };
  }
  return skill(ctx);
}

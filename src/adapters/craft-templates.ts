import areaEn from "../../plugin/assets/templates/area.md";
import areaZh from "../../plugin/assets/templates/area.zh-CN.md";
import outputEn from "../../plugin/assets/templates/output.md";
import outputZh from "../../plugin/assets/templates/output.zh-CN.md";
import projectEn from "../../plugin/assets/templates/project.md";
import projectZh from "../../plugin/assets/templates/project.zh-CN.md";
import sourceEn from "../../plugin/assets/templates/source.md";
import sourceZh from "../../plugin/assets/templates/source.zh-CN.md";
import wikiEn from "../../plugin/assets/templates/wiki.md";
import wikiZh from "../../plugin/assets/templates/wiki.zh-CN.md";

/**
 * The bundled entity templates rendered for Craft's Templates area, so a person can
 * create an entity by hand with the same structure the Agent uses. Task stays an
 * inline fragment inside the Project template and is not installed separately.
 * Area and Project drop their Status/primary-Area lines: those are Collection columns.
 */
export type TemplateLanguage = "en" | "zh-CN";
export type CraftTemplateRole = "area" | "project" | "source" | "wiki" | "output";

const SOURCES: Record<CraftTemplateRole, Record<TemplateLanguage, string>> = {
  area: { en: areaEn, "zh-CN": areaZh },
  project: { en: projectEn, "zh-CN": projectZh },
  source: { en: sourceEn, "zh-CN": sourceZh },
  wiki: { en: wikiEn, "zh-CN": wikiZh },
  output: { en: outputEn, "zh-CN": outputZh },
};

export const CRAFT_TEMPLATE_ROLES: readonly CraftTemplateRole[] = ["area", "project", "source", "wiki", "output"];

export function craftTemplateTitle(role: CraftTemplateRole): string {
  return `GPK ${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

export function craftTemplateBody(role: CraftTemplateRole, language: TemplateLanguage): string {
  const collectionBacked = role === "area" || role === "project";
  const lines = SOURCES[role][language]
    .replace(/<!--[\s\S]*?-->\n?/g, "")
    .split("\n")
    .filter(line => !/^# /.test(line))
    .filter(line => !(collectionBacked && /^- (Status|状态|Primary Area|主 Area)[:：]/.test(line)));
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const note = language === "zh-CN"
    ? `GPK ${role} 模板（领域模型 0.4）。${collectionBacked ? "状态和归属是表格列，不在正文里。" : ""}填完后删除本提示、{{占位符}}和未使用的可选小节。`
    : `GPK ${role} template (domain 0.4). ${collectionBacked ? "Status and ownership are Collection columns, not body text. " : ""}Replace the {{slots}}, then delete this note and unused optional sections.`;
  return `<callout>${note}</callout>\n\n${body}`;
}

import areaEn from "../../plugin/assets/templates/area.md";
import outputEn from "../../plugin/assets/templates/output.md";
import projectEn from "../../plugin/assets/templates/project.md";
import sourceEn from "../../plugin/assets/templates/source.md";
import taskEn from "../../plugin/assets/templates/task.md";
import wikiEn from "../../plugin/assets/templates/wiki.md";
import type { TemplateRole } from "../domain/user-control-port.js";

/**
 * Entity templates for Craft's native Templates area and bundled fallback authoring.
 *
 * Setup installs the five document/row templates into Craft's native `templates`
 * location so people can use Craft's "New from Template" / `/template` UI and edit
 * them directly in Craft. Task stays an inline fragment. System fields (Status,
 * primary Area, planned time) live in Collection columns and native Task fields,
 * never parsed from body text, so user edits to template prose cannot break GPK.
 */
export type TemplateLanguage = "en" | "zh-CN";
export type CraftTemplateRole = "area" | "project" | "source" | "wiki" | "output";

const BUNDLED: Record<TemplateRole, string> = {
  area: areaEn,
  project: projectEn,
  task: taskEn,
  source: sourceEn,
  wiki: wikiEn,
  output: outputEn,
};

export const CRAFT_TEMPLATE_ROLES: readonly CraftTemplateRole[] = ["area", "project", "source", "wiki", "output"];

export function craftTemplateTitle(role: CraftTemplateRole): string {
  return `GPK ${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

export function craftTemplateBody(role: CraftTemplateRole): string {
  const collectionBacked = role === "area" || role === "project";
  const lines = BUNDLED[role]
    .replace(/<!--[\s\S]*?-->\n?/g, "")
    .split("\n")
    .filter(line => !/^# /.test(line))
    .filter(line => !(collectionBacked && /^- (Status|Primary Area)[:：]/.test(line)));
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const note = `GPK ${role} template (domain 0.4). ${collectionBacked ? "Status and ownership are Collection columns, not body text. " : ""}Replace the {{slots}}, then delete this note and unused optional sections.`;
  return `<callout>${note}</callout>\n\n${body}`;
}

/**
 * Sanitize a template read from Craft's native Templates area while preserving
 * user-authored Craft dialect blocks (custom `<callout>`s, dividers, headings, lists).
 * - Strips only GPK's own onboarding instruction banner and HTML comments.
 * - Converts non-fenced native task checkboxes (`[ ]` / `[x]`) on non-Task templates
 *   to `☐` / `☑` so body creation does not spawn unmanaged native Task blocks.
 */
export function sanitizeCraftTemplate(raw: string, role: TemplateRole): { content: string; limits: string[] } {
  const limits: string[] = [];
  const stripped = raw
    .replace(/^\s*<callout>\s*GPK\s+\w+\s+template\s*\(domain[^<]*<\/callout>\s*/i, "")
    .replace(/<!--[\s\S]*?-->\n?/g, "")
    .replace(/\\n(?=\s*(?:[-*+]|\d+[.)]|#{1,6}\s|<))/g, "\n");
  let fence = "";
  let convertedCheckboxes = false;
  const lines: string[] = [];
  for (const line of stripped.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker && (marker[1]![0] !== "`" || !marker[2]!.includes("`"))) {
      if (!fence) fence = marker[1]!;
      else if (marker[1]!.startsWith(fence) && line.trim() === marker[1]) fence = "";
      lines.push(line);
      continue;
    }
    if (!fence && role !== "task") {
      const taskMatch = line.match(/^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[([ xX-])\]\s*(.*)$/);
      if (taskMatch) {
        convertedCheckboxes = true;
        const symbol = taskMatch[2] === " " ? "☐" : "☑";
        lines.push(`${taskMatch[1]}${symbol} ${taskMatch[3]}`);
        continue;
      }
    }
    lines.push(line);
  }
  if (convertedCheckboxes && role !== "project") {
    limits.push("Native task checkboxes in the template were converted to ☐/☑ so body prose does not create unmanaged Task blocks.");
  }
  const content = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { content, limits };
}

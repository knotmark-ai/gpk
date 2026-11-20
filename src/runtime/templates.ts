import areaEn from "../../plugin/assets/templates/area.md";
import outputEn from "../../plugin/assets/templates/output.md";
import projectEn from "../../plugin/assets/templates/project.md";
import sourceEn from "../../plugin/assets/templates/source.md";
import taskEn from "../../plugin/assets/templates/task.md";
import wikiEn from "../../plugin/assets/templates/wiki.md";
import type { TemplateRole } from "../domain/user-control-port.js";

const BUNDLED: Record<TemplateRole, string> = {
  area: areaEn,
  project: projectEn,
  task: taskEn,
  source: sourceEn,
  wiki: wikiEn,
  output: outputEn,
};

/** Clean bundled Markdown blueprint for an entity role, with authoring HTML comments removed. */
export function bundledTemplateMarkdown(role: TemplateRole): string {
  return BUNDLED[role]
    .replace(/<!--[\s\S]*?-->\n?/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeComparableLines(markdown: string, role: TemplateRole): string {
  const collectionBacked = role === "area" || role === "project";
  return markdown
    .replace(/<!--[\s\S]*?-->\n?/g, "")
    .replace(/^\s*<callout>\s*GPK\s+\w+\s+template\s*\(domain[^<]*<\/callout>\s*/i, "")
    .replace(/\\n(?=\s*(?:[-*+]|\d+[.)]|#{1,6}\s|<))/g, "\n")
    .replace(/^---$/gm, "<pageBreak />")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^# /.test(line))
    .filter(line => !(collectionBacked && /^- (Status|Primary Area)[:：]/.test(line)))
    .map(line => role === "task"
      ? line
      : line
          .replace(/^((?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[([ xX-])\]\s*/, (_, prefix: string, mark: string) => `${prefix}${mark === " " ? "☐" : "☑"} `)
          .replace(/^((?:>\s*)*)(?:[-*+]|\d+[.)])\s+(☐|☑)\s+/, "$1- $2 "))
    .join("\n");
}

/**
 * True when a sanitized backend template diverges from the unmodified bundled blueprint
 * installed during Setup (accounting for provider block spacing and Collection-column
 * header stripping).
 */
export function isCustomizedTemplate(role: TemplateRole, content: string): boolean {
  if (!content.trim()) return false;
  return normalizeComparableLines(content, role) !== normalizeComparableLines(BUNDLED[role], role);
}

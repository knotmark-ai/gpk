// Craft's command lexer accepts literal newlines inside a quoted Markdown argument.
// Escape quotes and backslashes per line without changing a line break into two characters.
export function markdownArgument(markdown: string): string {
  return '"' + markdown.split(/\r?\n/).map(line => JSON.stringify(line).slice(1, -1)).join("\n") + '"';
}

/** CommonMark fence opener/closer check shared by Craft prose validators and normalizers. */
export function nextFenceState(fence: string, rawLine: string): { insideFence: boolean; nextFence: string } {
  const match = rawLine.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  const delimiter = match?.[1];
  const rest = match?.[2] ?? "";
  if (fence) {
    if (delimiter && delimiter[0] === fence[0] && delimiter.length >= fence.length && rest.trim() === "") {
      return { insideFence: true, nextFence: "" };
    }
    return { insideFence: true, nextFence: fence };
  }
  if (delimiter && (delimiter[0] !== "`" || !rest.includes("`"))) {
    return { insideFence: true, nextFence: delimiter };
  }
  return { insideFence: false, nextFence: "" };
}

/** Craft parses separate paragraphs as native blocks. Preserve soft breaks and
 * fenced examples, and give each authored heading and list item its own block. */
export function craftBodyMarkdown(input: string): string {
  const output: string[] = [];
  let fence = "";
  let previousHeading = false;
  for (const raw of input.split(/\r?\n/)) {
    const state = nextFenceState(fence, raw);
    if (state.insideFence) {
      if (!fence && previousHeading && output.at(-1)?.trim()) output.push("");
      output.push(raw);
      fence = state.nextFence;
      previousHeading = false;
      continue;
    }
    const line = raw.replace(/^( {0,3})[·•] /, "$1- ");
    const heading = /^#{1,4}\s/.test(line);
    const item = /^\s*(?:[-+*]|\d+\.)\s+/.test(line);
    if ((heading || item || previousHeading) && line.trim() && output.at(-1)?.trim()) output.push("");
    output.push(line);
    previousHeading = heading;
  }
  return output.join("\n");
}

/**
 * Bonzai models often wrap JSON in markdown fences despite json_object mode.
 * Returns a trimmed JSON string when parsing succeeds; otherwise the original
 * content so the plugin can still attempt its own parser.
 */
export function normalizeModelJsonContent(content: string): string {
  let text = content.trim();
  const fenced = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i.exec(text);
  if (fenced) {
    text = fenced[1].trim();
  } else if (text.indexOf("```") === 0) {
    text = text
      .replace(/^```(?:json)?\s*\r?\n?/i, "")
      .replace(/\r?\n?```\s*$/i, "")
      .trim();
  }

  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed);
  } catch (firstError) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return JSON.stringify(parsed);
      } catch (innerError) {
        return content;
      }
    }
    return content;
  }
}

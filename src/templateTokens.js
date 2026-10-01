/*
 * Generic `{{TOKEN}}` / `{{TOKEN:arg}}` template engine shared by
 * `broadcastTemplate.js` (debug-menu crew broadcast) and `discordTemplate.js`
 * (Discord webhook embeds). Each caller supplies its own resolver map; the
 * engine itself only knows how to find tokens, dispatch to a resolver, and
 * decide what "unknown" means.
 *
 * A resolver takes `(context, arg)` and returns a string to substitute, or
 * `null` to mean "not a token I can fill" — which leaves the original text in
 * place so a typo is visible instead of silently vanishing.
 */

export const TEMPLATE_TOKEN_RE = /\{\{\s*([A-Za-z_]+)(?::([^}]*?))?\s*\}\}/g;

/**
 * Render one template against one context. Single pass: a token that appears
 * inside a substituted value is left alone rather than expanded again.
 */
export function renderTokens(tokens, template, context = {}) {
  return String(template ?? '').replace(TEMPLATE_TOKEN_RE, (match, name, arg) => {
    const resolver = tokens[String(name).toUpperCase()];
    if (!resolver) return match;
    const value = resolver(context, arg);
    return value == null ? match : String(value);
  });
}

/** Tokens the renderer would leave literal — surfaced for a confirm/preview UI. */
export function unknownTemplateTokens(tokens, template, probeContext = {}) {
  const found = [];
  for (const match of String(template ?? '').matchAll(TEMPLATE_TOKEN_RE)) {
    const resolver = tokens[String(match[1]).toUpperCase()];
    const unresolved = !resolver || resolver(probeContext, match[2]) == null;
    if (unresolved && !found.includes(match[0])) found.push(match[0]);
  }
  return found;
}

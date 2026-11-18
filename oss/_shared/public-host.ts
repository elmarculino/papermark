/**
 * [fork] Where public `/view` links live. Upstream hardcodes papermark.com in
 * labels, previews and a few generated URLs; a self-host serves them from
 * NEXT_PUBLIC_MARKETING_URL (e.g. https://papermark.apto).
 */
export const PUBLIC_LINK_BASE_URL = (
  process.env.NEXT_PUBLIC_MARKETING_URL || "https://www.papermark.com"
).replace(/\/+$/, "");

export const PUBLIC_LINK_HOST = new URL(PUBLIC_LINK_BASE_URL).host;

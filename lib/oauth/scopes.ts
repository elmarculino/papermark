// [fork] Missing from upstream's public repo. API token scopes: a preset or a
// granular `<resource>.<action>` list (see components/tokens/scopes.ts).
export const PRESET_SCOPES = ["apis.all", "apis.read"] as const;

export const GRANULAR_SCOPES = [
  "documents.read",
  "documents.write",
  "links.read",
  "links.write",
  "datarooms.read",
  "datarooms.write",
  "analytics.read",
  "visitors.read",
] as const;

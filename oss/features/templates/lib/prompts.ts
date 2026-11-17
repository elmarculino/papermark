/**
 * Prompts for the AGPL "generate data room structure with AI" route
 * (pages/api/teams/[teamId]/datarooms/generate-ai-structure.ts). Written for this fork.
 */
export async function getDataroomSystemPrompt(): Promise<string> {
  return [
    "You design folder structures for virtual data rooms.",
    "Return a short, practical structure: top-level folders, each with at most 5 subfolders,",
    "and no deeper than 2 levels. Use clear, conventional folder names.",
    "Name the data room after its purpose.",
  ].join(" ");
}

export async function getDataroomUserPrompt(
  description: string,
): Promise<string> {
  return `Create a data room folder structure for: ${description}`;
}

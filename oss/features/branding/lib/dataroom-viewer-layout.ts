import { z } from "zod";

/** How documents and folders are listed in the data-room viewer. */
export const DataroomCardLayoutSchema = z.enum(["LIST", "COMPACT", "GRID"]);
export type DataroomCardLayout = z.infer<typeof DataroomCardLayoutSchema>;

/** Header above the data-room viewer: plain, banner beside title, or full-width banner. */
export const DataroomViewerHeaderStyleSchema = z.enum([
  "DEFAULT",
  "SPLIT",
  "NOTION",
]);
export type DataroomViewerHeaderStyle = z.infer<
  typeof DataroomViewerHeaderStyleSchema
>;

/** Named combinations of the layout settings; CUSTOM when none matches. */
export const DataroomViewerLayoutPresetSchema = z.enum([
  "STANDARD",
  "STRICT",
  "MODERN",
  "NOTION",
  "CUSTOM",
]);
export type DataroomViewerLayoutPreset = z.infer<
  typeof DataroomViewerLayoutPresetSchema
>;
/** Presets offered as cards (everything but CUSTOM). */
export type DataroomLayoutCardId = Exclude<
  DataroomViewerLayoutPreset,
  "CUSTOM"
>;

export const CARD_LAYOUT_OPTIONS: {
  value: DataroomCardLayout;
  label: string;
}[] = [
  { value: "LIST", label: "List" },
  { value: "COMPACT", label: "Compact" },
  { value: "GRID", label: "Grid" },
];

export function asDataroomCardLayout(value: unknown): DataroomCardLayout {
  const parsed = DataroomCardLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : "LIST";
}

export function asDataroomViewerHeaderStyle(
  value: unknown,
): DataroomViewerHeaderStyle {
  const parsed = DataroomViewerHeaderStyleSchema.safeParse(value);
  return parsed.success ? parsed.data : "DEFAULT";
}

type LayoutSettings = {
  cardLayout: DataroomCardLayout;
  showFolderTree: boolean;
  viewerHeaderStyle: DataroomViewerHeaderStyle;
  hideFolderIconsInMain: boolean;
};

/** The settings each preset card applies (kept in sync with the branding pages). */
export const DATAROOM_LAYOUT_PRESETS: Record<
  DataroomLayoutCardId,
  LayoutSettings
> = {
  STANDARD: {
    cardLayout: "LIST",
    showFolderTree: true,
    viewerHeaderStyle: "DEFAULT",
    hideFolderIconsInMain: false,
  },
  STRICT: {
    cardLayout: "COMPACT",
    showFolderTree: false,
    viewerHeaderStyle: "DEFAULT",
    hideFolderIconsInMain: true,
  },
  MODERN: {
    cardLayout: "COMPACT",
    showFolderTree: false,
    viewerHeaderStyle: "SPLIT",
    hideFolderIconsInMain: true,
  },
  NOTION: {
    cardLayout: "GRID",
    showFolderTree: false,
    viewerHeaderStyle: "NOTION",
    hideFolderIconsInMain: false,
  },
};

export function inferDataroomViewerLayoutPreset(
  settings: LayoutSettings,
): DataroomViewerLayoutPreset {
  for (const [id, preset] of Object.entries(DATAROOM_LAYOUT_PRESETS)) {
    if (
      preset.cardLayout === settings.cardLayout &&
      preset.showFolderTree === settings.showFolderTree &&
      preset.viewerHeaderStyle === settings.viewerHeaderStyle &&
      preset.hideFolderIconsInMain === settings.hideFolderIconsInMain
    ) {
      return id as DataroomLayoutCardId;
    }
  }
  return "CUSTOM";
}

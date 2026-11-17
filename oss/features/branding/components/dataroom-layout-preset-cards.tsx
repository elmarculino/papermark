import {
  type DataroomLayoutCardId,
  type DataroomViewerLayoutPreset,
} from "@/ee/features/branding/lib/dataroom-viewer-layout";

import { cn } from "@/lib/utils";

const PRESETS: {
  id: DataroomLayoutCardId;
  name: string;
  description: string;
}[] = [
  {
    id: "STANDARD",
    name: "Standard",
    description: "List with folder tree",
  },
  {
    id: "STRICT",
    name: "Strict",
    description: "Compact table, no tree",
  },
  {
    id: "MODERN",
    name: "Modern",
    description: "Banner beside the title, compact list",
  },
  {
    id: "NOTION",
    name: "Notion",
    description: "Full-width banner, grid",
  },
];

export function DataroomLayoutPresetCards({
  selectedPreset,
  onSelect,
}: {
  selectedPreset: DataroomViewerLayoutPreset;
  onSelect: (id: DataroomLayoutCardId) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onSelect(preset.id)}
          aria-pressed={selectedPreset === preset.id}
          className={cn(
            "rounded-md border border-gray-200 px-3 py-2 text-left text-xs transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900",
            selectedPreset === preset.id &&
              "border-black bg-gray-50 dark:border-white dark:bg-gray-900",
          )}
        >
          <div className="font-medium">{preset.name}</div>
          <div className="text-muted-foreground">{preset.description}</div>
        </button>
      ))}
    </div>
  );
}

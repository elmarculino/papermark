import type { DataroomFolder } from "@prisma/client";

import type { DocumentVersion } from "@/components/view/viewer/dataroom-viewer";

export type PreviewDocument = {
  id: string;
  dataroomDocumentId: string;
  name: string;
  folderName: string | null;
  downloadOnly: boolean;
  canDownload: boolean;
  hierarchicalIndex: string | null;
  versions: DocumentVersion[];
};

const UPDATED = new Date("2026-01-15T10:00:00Z");

const FOLDERS = ["Financials", "Legal", "Product", "Team"];

const DOCUMENTS: { name: string; folder: string | null; type: string }[] = [
  { name: "Company Overview.pdf", folder: null, type: "pdf" },
  { name: "Pitch Deck.pdf", folder: null, type: "pdf" },
  { name: "P&L 2025.xlsx", folder: "Financials", type: "sheet" },
  { name: "Cap Table.xlsx", folder: "Financials", type: "sheet" },
  { name: "Articles of Incorporation.pdf", folder: "Legal", type: "pdf" },
  { name: "Customer Contract Template.docx", folder: "Legal", type: "docs" },
  { name: "Roadmap.pdf", folder: "Product", type: "pdf" },
  { name: "Org Chart.pdf", folder: "Team", type: "pdf" },
];

function folder(name: string, index: number): DataroomFolder {
  return {
    id: `preview-folder-${index + 1}`,
    name,
    path: `/${name.toLowerCase()}`,
    parentId: null,
    icon: null,
    color: null,
    dataroomId: "preview",
    orderIndex: index,
    hierarchicalIndex: null,
    createdAt: UPDATED,
    updatedAt: UPDATED,
  } as DataroomFolder;
}

/** The fixed "Example Virtual Data Room" the branding previews render. */
export function getDataroomPreviewDataset(): {
  folders: DataroomFolder[];
  documents: PreviewDocument[];
} {
  return {
    folders: FOLDERS.map(folder),
    documents: DOCUMENTS.map((doc, index) => ({
      id: `preview-doc-${index + 1}`,
      dataroomDocumentId: `preview-dr-doc-${index + 1}`,
      name: doc.name,
      folderName: doc.folder,
      downloadOnly: false,
      canDownload: false,
      hierarchicalIndex: null,
      versions: [
        {
          id: `preview-version-${index + 1}`,
          versionNumber: 1,
          type: doc.type,
          hasPages: true,
          isVertical: true,
          updatedAt: UPDATED,
        },
      ],
    })),
  };
}

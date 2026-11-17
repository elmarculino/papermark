/** A folder in a generated data-room structure. */
export type FolderTemplate = {
  name: string;
  subfolders?: FolderTemplate[];
};

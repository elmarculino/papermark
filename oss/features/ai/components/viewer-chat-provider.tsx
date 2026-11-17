export {
  PassThrough as ViewerChatProvider,
  PassThrough as ViewerChatLayout,
} from "@/oss/_shared/stub";

/** Viewer AI chat is not available: there is never a chat context. */
export function useViewerChatSafe(): {
  isOpen: boolean;
  isEnabled: boolean;
} | null {
  return null;
}

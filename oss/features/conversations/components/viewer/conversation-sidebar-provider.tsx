export {
  PassThrough as ConversationSidebarProvider,
  PassThrough as ConversationSidebarLayout,
} from "@/oss/_shared/stub";

/** Viewer conversations are not available: there is never a sidebar context. */
export function useConversationSidebarSafe(): { isOpen: boolean } | null {
  return null;
}

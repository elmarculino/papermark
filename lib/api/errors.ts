// [fork] Missing from upstream's public repo. Error type for API-facing code
// (e.g. lib/api/documents/validate-external-url.ts).
import { DocumentError } from "@/lib/errorHandler";

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable_entity"
  | "rate_limit_exceeded"
  | "internal_server_error";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable_entity: 422,
  rate_limit_exceeded: 429,
  internal_server_error: 500,
};

/**
 * Extends DocumentError so the shared `errorhandler` returns its status and
 * message to the client instead of a generic 500.
 */
export class PapermarkApiError extends DocumentError {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PapermarkApiError";
    this.statusCode = STATUS[code];
  }
}

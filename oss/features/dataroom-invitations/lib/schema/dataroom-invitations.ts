import { z } from "zod";

/** One invitee email address. */
export const invitationEmailSchema = z.string().trim().email();

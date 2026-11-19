import { Receiver } from "@upstash/qstash";
import { Client } from "@upstash/qstash";
import Bottleneck from "bottleneck";
import { randomBytes } from "node:crypto";

// we're using Bottleneck to avoid running into Resend's rate limit of 10 req/s
export const limiter = new Bottleneck({
  maxConcurrent: 1, // maximum concurrent requests
  minTime: 100, // minimum time between requests in ms
});

// we're using Upstash's Receiver to verify the request signature
// [fork] A placeholder key ("unused", "add-your-...") would let anyone sign
// a request with it. Replace it, and an empty key, with a random one nothing
// can sign with: the Receiver falls back to the env var when given "".
const signingKey = (value?: string) =>
  value && !/^(unused$|add-your-)/i.test(value.trim())
    ? value
    : randomBytes(32).toString("hex");

export const receiver = new Receiver({
  currentSigningKey: signingKey(process.env.QSTASH_CURRENT_SIGNING_KEY),
  nextSigningKey: signingKey(process.env.QSTASH_NEXT_SIGNING_KEY),
});

export const qstash = new Client({
  token: process.env.QSTASH_TOKEN || "",
});

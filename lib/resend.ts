import { JSXElementConstructor, ReactElement } from "react";

import nodemailer from "nodemailer";
import { render, toPlainText } from "react-email";
import { Resend } from "resend";

import prisma from "@/lib/prisma";
import { log, nanoid } from "@/lib/utils";

export const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// [fork] Self-hosted email over SMTP. When SMTP_HOST is set, sendEmail goes
// through this transport instead of Resend. EMAIL_FROM is the sender for every
// message unless a caller passes `from` (e.g. a team's custom email).
const smtp = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true", // true for port 465
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    })
  : null;

export const isSmtpEnabled = () => !!smtp;

export const sendEmail = async ({
  to,
  subject,
  react,
  from,
  marketing,
  system,
  verify,
  test,
  cc,
  replyTo,
  scheduledAt,
  unsubscribeUrl,
  idempotencyKey,
}: {
  to: string;
  subject: string;
  react: ReactElement<any, string | JSXElementConstructor<any>>;
  from?: string;
  marketing?: boolean;
  system?: boolean;
  verify?: boolean;
  test?: boolean;
  cc?: string | string[];
  replyTo?: string;
  scheduledAt?: string;
  unsubscribeUrl?: string;
  idempotencyKey?: string;
}) => {
  if (smtp) {
    // Papermark's own campaigns (marketing, and the scheduled onboarding /
    // upsell mails "from Marc") aren't meant for a self-hosted install, and
    // SMTP can't schedule. Skip them; send everything else right away.
    if (marketing || scheduledAt) {
      console.info(`[email] skipped "${subject}" (Papermark campaign mail)`);
      return null;
    }
    const sender = from ?? process.env.EMAIL_FROM;
    if (!sender) {
      throw new Error("EMAIL_FROM must be set when sending over SMTP");
    }
    const html = await render(react);
    const info = await smtp.sendMail({
      from: sender,
      to,
      cc,
      replyTo: replyTo ?? process.env.EMAIL_REPLY_TO,
      subject,
      html,
      text: toPlainText(html),
      headers: {
        "X-Entity-Ref-ID": idempotencyKey ?? nanoid(),
        ...(unsubscribeUrl
          ? {
              "List-Unsubscribe": `<${unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            }
          : {}),
      },
    });
    return { id: info.messageId };
  }

  if (!resend) {
    // Throw an error if resend is not initialized
    throw new Error("Resend not initialized");
  }

  const html = await render(react);
  const plainText = toPlainText(html);

  const fromAddress =
    from ??
    (marketing
      ? "Marc from Papermark <marc@updates.papermark.com>"
      : system
        ? "Papermark <system@papermark.com>"
        : verify
          ? "Papermark <system@verify.papermark.com>"
          : !!scheduledAt
            ? "Marc Seitz <marc@papermark.com>"
            : "Marc from Papermark <marc@papermark.com>");

  try {
    const { data, error } = await resend.emails.send(
      {
        from: fromAddress,
        to: test ? "delivered@resend.dev" : to,
        cc: cc,
        replyTo: marketing ? "marc@papermark.com" : replyTo,
        subject,
        react,
        scheduledAt,
        text: plainText,
        headers: {
          // Reusing an idempotency key with a changed payload is a 409, so the
          // ref id has to come from the key rather than a fresh nanoid.
          "X-Entity-Ref-ID": idempotencyKey ?? nanoid(),
          ...(unsubscribeUrl
            ? {
                "List-Unsubscribe": `<${unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              }
            : {}),
        },
      },
      { idempotencyKey },
    );

    // Check if the email sending operation returned an error and throw it
    if (error) {
      log({
        message: `Resend returned error when sending email: ${error.name} \n\n ${error.message}`,
        type: "error",
        mention: true,
      });
      throw error;
    }

    // If there's no error, return the data
    return data;
  } catch (exception) {
    // Log and rethrow any caught exceptions for upstream handling
    log({
      message: `Unexpected error when sending email: ${exception}`,
      type: "error",
      mention: true,
    });
    throw exception; // Rethrow the caught exception
  }
};

export const subscribe = async (email: string): Promise<void> => {
  if (!resend) {
    console.error("RESEND_API_KEY is not set in the .env. Skipping.");
    return;
  }

  const { data, error } = await resend.contacts.create({
    email,
  });

  if (error || !data?.id) {
    console.error("Failed to create contact:", error);
    return;
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.RESEND_MARKETING_SEGMENT_ID
  ) {
    await resend.contacts.segments.add({
      contactId: data.id,
      segmentId: process.env.RESEND_MARKETING_SEGMENT_ID as string,
    });
  }
};

export const unsubscribe = async (email: string): Promise<void> => {
  if (!resend) {
    console.error("RESEND_API_KEY is not set in the .env. Skipping.");
    return;
  }

  if (!email) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { email: true },
  });

  if (!user || !user.email) {
    return;
  }

  await resend.contacts.update({
    email: user.email,
    unsubscribed: true,
  });
};

/**
 * Runtime check that email footers carry the install's company, not
 * Papermark, Inc.:
 *   npx tsx --tsconfig oss/tsconfig.verify.json oss/_shared/email-company.verify.tsx
 */
import { render } from "react-email";

import DataroomNotification from "@/components/emails/dataroom-notification";
import Onboarding1 from "@/components/emails/onboarding-1";
import OtpEmailVerification from "@/components/emails/otp-verification";
import { Footer } from "@/components/emails/shared/footer";
import VerificationLink from "@/components/emails/verification-link";
import Welcome from "@/components/emails/welcome";

import { assert, check } from "../jobs/testing";

const emails = () => ({
  "footer (default)": <Footer />,
  "footer (withAddress)": <Footer withAddress />,
  "welcome (marketing footer)": <Welcome name="Ana" />,
  "onboarding-1": <Onboarding1 />,
  "dataroom-notification": (
    <DataroomNotification
      dataroomName="Q4"
      documentName="Report.pdf"
      senderEmail="a@example.com"
      url="https://example.com"
      unsubscribeUrl="https://example.com/u"
    />
  ),
  "otp-verification": (
    <OtpEmailVerification
      email="a@example.com"
      code="123456"
      isDataroom={false}
    />
  ),
  "verification-link": <VerificationLink email="a@example.com" code="123456" />,
});

async function renderAll(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, el] of Object.entries(emails()))
    out[name] = await render(el);
  return out;
}

async function main() {
  await check("unset: no Papermark, Inc. and no Dover address", async () => {
    delete process.env.EMAIL_COMPANY_NAME;
    delete process.env.EMAIL_COMPANY_ADDRESS;
    for (const [name, html] of Object.entries(await renderAll())) {
      assert(!html.includes("Papermark, Inc"), `${name}: Papermark, Inc.`);
      assert(!html.includes("Governors Ave"), `${name}: Papermark's address`);
      assert(!html.includes("All rights reserved"), `${name}: copyright line`);
    }
  });

  await check("set: the install's company name and address", async () => {
    process.env.EMAIL_COMPANY_NAME = "Acme Ltda.";
    process.env.EMAIL_COMPANY_ADDRESS = "Rua das Flores 10, Recife";
    const year = new Date().getFullYear();
    const html = await renderAll();
    for (const name of [
      "footer (default)",
      "onboarding-1",
      "dataroom-notification",
    ]) {
      assert(
        html[name].includes(`© ${year} Acme Ltda. All rights reserved.`) ||
          html[name].includes(`© <!-- -->${year}<!-- --> <!-- -->Acme Ltda.`),
        `${name}: copyright with company`,
      );
      assert(!html[name].includes("Rua das Flores"), `${name}: no address`);
    }
    for (const name of [
      "footer (withAddress)",
      "welcome (marketing footer)",
      "otp-verification",
      "verification-link",
    ]) {
      assert(html[name].includes("Acme Ltda."), `${name}: company name`);
      assert(
        html[name].includes("Rua das Flores 10, Recife"),
        `${name}: company address`,
      );
    }
    for (const [name, h] of Object.entries(html))
      assert(!h.includes("Papermark, Inc"), `${name}: Papermark, Inc.`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

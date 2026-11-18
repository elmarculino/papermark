/**
 * [fork] Who the emails say they come from. Upstream prints "© Papermark, Inc."
 * and Papermark's postal address in every email footer; a self-host sets its
 * own with EMAIL_COMPANY_NAME and EMAIL_COMPANY_ADDRESS (one line). Unset, the
 * copyright and address lines are left out.
 */
import { Text } from "react-email";

function companyName(): string {
  return process.env.EMAIL_COMPANY_NAME?.trim() ?? "";
}

function companyAddress(): string {
  return process.env.EMAIL_COMPANY_ADDRESS?.trim() ?? "";
}

/** "© <year> <company>. All rights reserved." (+ the address), or nothing. */
export function CompanyCopyrightText({
  withAddress = false,
  className = "text-xs",
}: {
  withAddress?: boolean;
  className?: string;
}) {
  const name = companyName();
  const address = withAddress ? companyAddress() : "";
  if (!name && !address) return null;
  return (
    <Text className={className}>
      {name && (
        <>
          © {new Date().getFullYear()} {name}. All rights reserved.
        </>
      )}
      {name && address && <br />}
      {address}
    </Text>
  );
}

/** The company name and address on two lines, or nothing. */
export function CompanyAddressText({
  className = "text-[12px] text-neutral-500",
}: {
  className?: string;
}) {
  const name = companyName();
  const address = companyAddress();
  if (!name && !address) return null;
  return (
    <Text className={className}>
      {name}
      {name && address && <br />}
      {address}
    </Text>
  );
}

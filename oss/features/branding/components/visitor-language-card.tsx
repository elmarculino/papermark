import {
  SUPPORTED_LOCALES,
  type SupportedLocaleCode,
} from "@/lib/i18n/locales";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Language of the access form and viewer chrome that visitors see. */
export function VisitorLanguageCard({
  defaultLanguage,
  onDefaultLanguageChange,
  hasAccess,
}: {
  defaultLanguage: SupportedLocaleCode;
  onDefaultLanguageChange: (code: SupportedLocaleCode) => void;
  hasAccess: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <Label htmlFor="visitor-language">Visitor language</Label>
        <Select
          value={defaultLanguage}
          onValueChange={(value) =>
            onDefaultLanguageChange(value as SupportedLocaleCode)
          }
          disabled={!hasAccess}
        >
          <SelectTrigger id="visitor-language" className="max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LOCALES.map((locale) => (
              <SelectItem key={locale.code} value={locale.code}>
                {locale.nativeName}
                {locale.nativeName !== locale.englishName
                  ? ` (${locale.englishName})`
                  : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Used for the access screen and the document viewer.
        </p>
      </CardContent>
    </Card>
  );
}

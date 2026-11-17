import type { Brand } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Id of a brand that is being created and isn't saved yet. */
export const DRAFT_TEAM_BRAND_ID = "__draft_brand__";

/** "Brand 2", "Brand 3", … : the first name not used by the team yet. */
export function nextTeamBrandName(brands: Pick<Brand, "name">[]): string {
  const names = new Set(brands.map((brand) => brand.name));
  for (let n = brands.length + 1; ; n++) {
    const candidate = `Brand ${n}`;
    if (!names.has(candidate)) return candidate;
  }
}

/** Pick, name, create, make default and delete team brands. */
export function TeamBrandSwitcher({
  brands,
  selectedBrandId,
  defaultBrandId,
  brandName,
  onBrandNameChange,
  onSelect,
  onCreate,
  onSetDefault,
  onDelete,
  disabled,
}: {
  brands: Brand[];
  selectedBrandId: string | null;
  defaultBrandId: string | null;
  brandName: string;
  onBrandNameChange: (name: string) => void;
  onSelect: (brandId: string) => void;
  onCreate: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const isDraft = selectedBrandId === DRAFT_TEAM_BRAND_ID;
  const isDefault = !!selectedBrandId && selectedBrandId === defaultBrandId;

  return (
    <div className="mb-6 flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Brand</span>
        <Select
          value={selectedBrandId ?? undefined}
          onValueChange={onSelect}
          disabled={disabled}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select a brand" />
          </SelectTrigger>
          <SelectContent>
            {brands.map((brand) => (
              <SelectItem key={brand.id} value={brand.id}>
                {brand.name}
                {brand.id === defaultBrandId ? " (default)" : ""}
              </SelectItem>
            ))}
            {isDraft ? (
              <SelectItem value={DRAFT_TEAM_BRAND_ID}>New brand</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Name</span>
        <Input
          className="w-56"
          value={brandName}
          maxLength={80}
          onChange={(e) => onBrandNameChange(e.target.value)}
          disabled={disabled}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={onCreate}
        disabled={disabled || isDraft}
      >
        New brand
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onSetDefault}
        disabled={disabled || isDraft || isDefault || !selectedBrandId}
      >
        Make default
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={onDelete}
        disabled={disabled || isDraft || !selectedBrandId}
      >
        Delete
      </Button>
    </div>
  );
}

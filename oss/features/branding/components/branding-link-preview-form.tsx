import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** Default social preview (Open Graph) for shared links. */
export function BrandingLinkPreviewForm({
  enabled,
  onEnabledChange,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  imageUrl,
  onImageChange,
  faviconUrl,
  onFaviconChange,
  inheritanceHint,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  imageUrl: string | null;
  onImageChange: (value: string | null) => void;
  faviconUrl: string | null;
  onFaviconChange: (value: string | null) => void;
  inheritanceHint?: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label htmlFor="link-preview-enabled">Custom link preview</Label>
        <Switch
          id="link-preview-enabled"
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
      </div>
      {inheritanceHint ? (
        <p className="text-xs text-muted-foreground">{inheritanceHint}</p>
      ) : null}
      {enabled ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="link-preview-title">Title</Label>
            <Input
              id="link-preview-title"
              value={title}
              maxLength={120}
              onChange={(e) => onTitleChange(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="link-preview-description">Description</Label>
            <Textarea
              id="link-preview-description"
              value={description}
              maxLength={300}
              onChange={(e) => onDescriptionChange(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="link-preview-image">Image URL</Label>
            <Input
              id="link-preview-image"
              type="url"
              placeholder="https://"
              value={imageUrl ?? ""}
              onChange={(e) => onImageChange(e.target.value.trim() || null)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="link-preview-favicon">Favicon URL</Label>
            <Input
              id="link-preview-favicon"
              type="url"
              placeholder="https://"
              value={faviconUrl ?? ""}
              onChange={(e) => onFaviconChange(e.target.value.trim() || null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

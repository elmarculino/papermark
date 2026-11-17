/** How a shared link unfurls in chat apps, from the configured preview values. */
export function BrandingSocialPreviewReadonly({
  title,
  description,
  image,
  favicon,
}: {
  title: string;
  description: string;
  image: string | null;
  favicon: string | null;
}) {
  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-lg border bg-white text-left dark:bg-gray-950">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          className="aspect-[1.91/1] w-full object-cover"
        />
      ) : (
        <div className="aspect-[1.91/1] w-full bg-gray-100 dark:bg-gray-900" />
      )}
      <div className="space-y-1 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={favicon} alt="" className="h-4 w-4" />
          ) : null}
          <span>Shared link</span>
        </div>
        <div className="truncate text-sm font-semibold">
          {title || "Link title"}
        </div>
        <div className="line-clamp-2 text-xs text-muted-foreground">
          {description || "Link description"}
        </div>
      </div>
    </div>
  );
}

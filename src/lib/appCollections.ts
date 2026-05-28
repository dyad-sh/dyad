import type { AppCollectionDto } from "@/ipc/types/app_collections";

type CollectionMembership = Pick<AppCollectionDto, "id" | "name" | "appIds">;

export function buildCollectionNameByAppId(
  collections: readonly CollectionMembership[],
  excludeCollectionId?: number | null,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const collection of collections) {
    if (excludeCollectionId != null && collection.id === excludeCollectionId) {
      continue;
    }
    for (const appId of collection.appIds) {
      map.set(appId, collection.name);
    }
  }
  return map;
}

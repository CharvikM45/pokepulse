import { CollectionPage } from "../../../src/features/consumer/collecting";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ set_id?: string }>;
}) {
  const params = await searchParams;
  return <CollectionPage setId={params.set_id} />;
}

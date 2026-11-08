import { CollectionPage } from "../../../../src/features/consumer/collecting";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <CollectionPage setId={(await params).id} />;
}

import { CatalogIndex } from "../../../../src/features/cards/catalog-index";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogIndex kind="artists" id={id} />;
}

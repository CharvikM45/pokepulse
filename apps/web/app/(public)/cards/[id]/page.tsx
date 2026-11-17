import { CardDetail } from "../../../../src/features/cards/card-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CardDetail id={id} />;
}

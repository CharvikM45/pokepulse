import { ProductDetail } from "../../../../src/features/consumer/discovery";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductDetail id={id} />;
}

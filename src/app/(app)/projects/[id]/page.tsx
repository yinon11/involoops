import { redirect } from "next/navigation";

export default async function ProjectAliasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/outbound/projects/${id}`);
}

import { ConversationScreen } from "@/features/data-explorer/data-screens";

export default async function DataConversationPage({
  params,
}: {
  readonly params: Promise<{ readonly set: string; readonly number: string }>;
}) {
  const { set, number } = await params;
  return <ConversationScreen set={set} number={number} />;
}

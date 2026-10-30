// Copyright 2026 Anviq LLC. All rights reserved.
import type { ThreadSnapshot } from "@anviq/contracts";

/**
 * In a chat shared by several people each bot asks its own owner, so the reader may answer only
 * the questions and approvals of bots they own. In any other chat nothing is filtered.
 */
export function ownAskIds(
  snapshot: ThreadSnapshot | null,
  ids: ReadonlySet<string>,
  shared: boolean,
  userId: string | undefined,
): Set<string> {
  if (!shared || !snapshot) return new Set(ids);
  const owners = new Map(
    (snapshot.members ?? []).map((member) => [member.botId, member.ownerUserId] as const),
  );
  const own = new Set<string>();
  for (const message of snapshot.messages) {
    if (!ids.has(message.id)) continue;
    const owner = message.botId ? owners.get(message.botId) : undefined;
    if (owner === undefined || owner === userId) own.add(message.id);
  }
  return own;
}

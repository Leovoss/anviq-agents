// Copyright 2026 Anviq LLC. All rights reserved.

import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { rpc, selectedSpaceId } from "../lib/rpc";
import { openSpace } from "./TeamSettings";

export type Workspace = { id: string; name: string; current: boolean; open: () => void };

/** Personal plus each team, for switching; empty until the person is in a team. */
export function useWorkspaces(): Workspace[] {
  const { t } = useLingui();
  const teams = useQuery({
    queryKey: ["organizations", "list"],
    queryFn: () => rpc.organizations.list(),
  });
  const personal = useQuery({
    queryKey: ["organizations", "personal"],
    queryFn: () => rpc.organizations.personalSpace(),
  });
  if (!teams.data?.length) return [];
  const selected = selectedSpaceId();
  const inTeam = teams.data.some((team) => team.spaceId === selected);
  const own = personal.data?.spaceId;
  return [
    ...(own
      ? [{ id: "personal", name: t`Personal`, current: !inTeam, open: () => openSpace(own) }]
      : []),
    ...teams.data.map((team) => ({
      id: team.id,
      name: team.name,
      current: team.spaceId === selected,
      open: () => openSpace(team.spaceId),
    })),
  ];
}

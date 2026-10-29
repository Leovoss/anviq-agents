// Copyright 2026 Anviq LLC. All rights reserved.
import type { OrganizationRole, Team } from "@anviq/contracts";
import { Button, Input, NativeSelect, NativeSelectOption } from "@anviq/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { rpc, selectSpace } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

const TEAMS = ["organizations"] as const;
const canManage = (role: OrganizationRole) => role === "owner" || role === "admin";

/** Switches the app into a space; the whole shell reloads because another space is an auth boundary. */
export function openSpace(spaceId: string) {
  if (selectSpace(spaceId)) window.location.assign("/app");
}

function useAction() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const action = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onMutate: () => setError(null),
    onError: (failure) => setError(errorText(failure)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TEAMS }),
  });
  return {
    run: (work: () => Promise<unknown>) => action.mutateAsync(work).catch(() => undefined),
    busy: action.isPending,
    error,
  };
}

export function TeamSettings() {
  const { t } = useLingui();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const { run, busy, error } = useAction();
  const teams = useQuery({ queryKey: [...TEAMS, "list"], queryFn: () => rpc.organizations.list() });
  const personal = useQuery({
    queryKey: [...TEAMS, "personal"],
    queryFn: () => rpc.organizations.personalSpace(),
  });
  const mine = useQuery({
    queryKey: [...TEAMS, "mine"],
    queryFn: () => rpc.organizations.myInvitations(),
  });
  const team = teams.data?.find((item) => item.id === teamId) ?? null;
  if (team) return <TeamDetail team={team} onBack={() => setTeamId(null)} />;

  return (
    <div className="space-y-8">
      {mine.data?.length ? (
        <SettingsGroup title={t`Invitations`}>
          {mine.data.map((invitation) => (
            <SettingsRow
              key={invitation.id}
              label={
                <>
                  <p className="break-words">{invitation.organizationName}</p>
                  <p className="text-[13px] text-muted-foreground">{invitation.inviterName}</p>
                </>
              }
              control={
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      openSpace(
                        (await rpc.organizations.acceptInvitation({ invitationId: invitation.id }))
                          .spaceId,
                      ),
                    )
                  }
                >
                  {t`Join`}
                </Button>
              }
            />
          ))}
        </SettingsGroup>
      ) : null}

      <SettingsGroup title={t`Teams`}>
        {personal.data?.spaceId ? (
          <SettingsRow
            label={t`Personal`}
            control={
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => openSpace(personal.data.spaceId as string)}
              >
                {t`Open`}
              </Button>
            }
          />
        ) : null}
        {teams.data?.map((item) => (
          <SettingsRow
            key={item.id}
            label={<p className="break-words">{item.name}</p>}
            control={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  onClick={() => openSpace(item.spaceId)}
                >
                  {t`Open`}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  aria-label={t`Manage ${item.name}`}
                  onClick={() => setTeamId(item.id)}
                >
                  {t`Manage`}
                </Button>
              </>
            }
          />
        ))}
        <form
          className="flex items-center gap-2 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            const next = name.trim();
            if (!next) return;
            void run(async () => {
              const created = await rpc.organizations.create({ name: next });
              openSpace(created.defaultSpaceId);
            });
          }}
        >
          <Input
            value={name}
            maxLength={60}
            aria-label={t`Team name`}
            placeholder={t`New team`}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" size="sm" className="rounded-full" disabled={busy || !name.trim()}>
            {t`Create`}
          </Button>
        </form>
      </SettingsGroup>
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TeamDetail({ team, onBack }: { team: Team; onBack: () => void }) {
  const { t } = useLingui();
  const { run, busy, error } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const manager = canManage(team.role);
  const members = useQuery({
    queryKey: [...TEAMS, "members", team.id],
    queryFn: () => rpc.organizations.members({ organizationId: team.id }),
  });
  const invitations = useQuery({
    queryKey: [...TEAMS, "invitations", team.id],
    queryFn: () => rpc.organizations.invitations({ organizationId: team.id }),
    enabled: manager,
  });
  const organizationId = team.id;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={t`Back`} onClick={onBack}>
          <ChevronLeft className="rtl:rotate-180" />
        </Button>
        <h3 className="min-w-0 break-words text-[15px] font-medium">{team.name}</h3>
      </div>

      <SettingsGroup title={t`People`}>
        {members.data?.map((member) => {
          const fixed = member.role === "owner";
          return (
            <SettingsRow
              key={member.userId}
              label={
                <>
                  <p className="break-words">{member.name}</p>
                  <p className="break-words text-[13px] text-muted-foreground">{member.email}</p>
                </>
              }
              control={
                <>
                  {team.role === "owner" && !fixed ? (
                    <NativeSelect
                      value={member.role}
                      disabled={busy}
                      aria-label={t`Role of ${member.name}`}
                      onChange={(event) =>
                        void run(() =>
                          rpc.organizations.setRole({
                            organizationId,
                            userId: member.userId,
                            role: event.target.value as "admin" | "member",
                          }),
                        )
                      }
                    >
                      <NativeSelectOption value="member">{t`Member`}</NativeSelectOption>
                      <NativeSelectOption value="admin">{t`Admin`}</NativeSelectOption>
                    </NativeSelect>
                  ) : (
                    <span className="text-[13px] text-muted-foreground">
                      {member.role === "owner"
                        ? t`Owner`
                        : member.role === "admin"
                          ? t`Admin`
                          : t`Member`}
                    </span>
                  )}
                  {manager && !fixed ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      disabled={busy}
                      aria-label={t`Remove ${member.name}`}
                      onClick={() =>
                        void run(() =>
                          rpc.organizations.removeMember({ organizationId, userId: member.userId }),
                        )
                      }
                    >
                      {t`Remove`}
                    </Button>
                  ) : null}
                  {team.role === "owner" && !fixed ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      disabled={busy}
                      aria-label={t`Make ${member.name} the owner`}
                      onClick={() =>
                        void run(() =>
                          rpc.organizations.transferOwnership({
                            organizationId,
                            userId: member.userId,
                          }),
                        )
                      }
                    >
                      {t`Make owner`}
                    </Button>
                  ) : null}
                </>
              }
            />
          );
        })}
      </SettingsGroup>

      {manager ? (
        <SettingsGroup title={t`Invite`}>
          {invitations.data?.map((invitation) => (
            <SettingsRow
              key={invitation.id}
              label={<p className="break-words">{invitation.email}</p>}
              control={
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      rpc.organizations.cancelInvitation({ invitationId: invitation.id }),
                    )
                  }
                >
                  {t`Cancel`}
                </Button>
              }
            />
          ))}
          <form
            className="flex flex-wrap items-center gap-2 px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              const address = email.trim();
              if (!address) return;
              void run(async () => {
                await rpc.organizations.invite({ organizationId, email: address, role });
                setEmail("");
              });
            }}
          >
            <Input
              type="email"
              value={email}
              className="min-w-0 flex-1"
              aria-label={t`Email`}
              placeholder={t`name@company.com`}
              onChange={(event) => setEmail(event.target.value)}
            />
            {team.role === "owner" ? (
              <NativeSelect
                value={role}
                aria-label={t`Role`}
                onChange={(event) => setRole(event.target.value as "admin" | "member")}
              >
                <NativeSelectOption value="member">{t`Member`}</NativeSelectOption>
                <NativeSelectOption value="admin">{t`Admin`}</NativeSelectOption>
              </NativeSelect>
            ) : null}
            <Button
              type="submit"
              size="sm"
              className="rounded-full"
              disabled={busy || !email.trim()}
            >
              {t`Send`}
            </Button>
          </form>
        </SettingsGroup>
      ) : null}

      {team.role !== "owner" ? (
        <Button
          variant="ghost"
          className="text-destructive"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await rpc.organizations.leave({ organizationId });
              onBack();
            })
          }
        >
          {t`Leave team`}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

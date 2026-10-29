// Copyright 2026 Anviq LLC. All rights reserved.
import { Button } from "@anviq/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { PageLoading } from "../components/PageLoading";
import { openSpace } from "../components/TeamSettings";
import { authClient } from "../lib/auth";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

export function AcceptInvitationPage() {
  const { t } = useLingui();
  const { invitationId = "" } = useParams();
  const verified = authClient.useSession().data?.user.emailVerified;
  const invitations = useQuery({
    queryKey: ["organizations", "mine"],
    queryFn: () => rpc.organizations.myInvitations(),
  });
  const accept = useMutation({
    mutationFn: () => rpc.organizations.acceptInvitation({ invitationId }),
    onSuccess: (joined) => openSpace(joined.spaceId),
  });
  if (invitations.isPending) return <PageLoading />;
  const invitation = invitations.data?.find((item) => item.id === invitationId);

  return (
    <div className="grid h-full place-items-center bg-background px-6">
      <div className="w-full max-w-[360px] text-center">
        {invitation ? (
          <>
            <h1 className="text-heading2 font-medium break-words">{invitation.organizationName}</h1>
            <p className="mt-1 text-[14px] text-muted-foreground break-words">
              {invitation.inviterName}
            </p>
            <Button
              className="mt-6 w-full rounded-full"
              disabled={accept.isPending}
              onClick={() => accept.mutate()}
            >
              {t`Join`}
            </Button>
            {accept.isError ? (
              <p role="alert" className="mt-3 text-[13px] text-destructive">
                {errorText(accept.error)}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-[14px] text-muted-foreground">
              {invitations.isError
                ? t`Could not load the invitation`
                : t`This invitation is not available`}
            </p>
            <Button variant="ghost" className="mt-4 rounded-full" render={<Link to="/app" />}>
              {t`Open the app`}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

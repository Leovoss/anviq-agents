-- People other than a chat's host who take part in it, with their own read position.
CREATE TABLE "chat_group_participants" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadSeq" INTEGER NOT NULL DEFAULT -1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_group_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_group_participants_groupId_userId_key"
ON "chat_group_participants"("groupId", "userId");
CREATE INDEX "chat_group_participants_userId_idx" ON "chat_group_participants"("userId");

ALTER TABLE "chat_group_participants"
ADD CONSTRAINT "chat_group_participants_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "chat_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_group_participants"
ADD CONSTRAINT "chat_group_participants_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages" ADD COLUMN "senderUserId" TEXT;
ALTER TABLE "runs" ADD COLUMN "triggeredByUserId" TEXT;

ALTER TABLE "chat_group_participants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_group_participants_tenant ON "chat_group_participants"
  USING (EXISTS (
    SELECT 1 FROM "chat_groups" g
    WHERE g."id" = "chat_group_participants"."groupId"
      AND g."spaceId" = NULLIF(current_setting('app.space_id', true), '')
  ));
CREATE POLICY chat_group_participants_system ON "chat_group_participants"
  USING (current_setting('app.rls_bypass', true) = 'on');

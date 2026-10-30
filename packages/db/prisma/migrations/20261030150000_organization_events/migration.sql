CREATE TABLE "organization_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_events_organizationId_createdAt_idx"
ON "organization_events"("organizationId", "createdAt");

ALTER TABLE "organization_events"
ADD CONSTRAINT "organization_events_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "organization_memory_proposals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_memory_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_memory_proposals_organizationId_status_createdAt_idx"
ON "organization_memory_proposals"("organizationId", "status", "createdAt");

ALTER TABLE "organization_memory_proposals"
ADD CONSTRAINT "organization_memory_proposals_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

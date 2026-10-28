-- A company's own KMS key for wrapping the space keys of its organization.
CREATE TABLE "organization_key_configs" (
    "organizationId" TEXT NOT NULL,
    "keyArn" TEXT NOT NULL,
    "previousKeyArns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_key_configs_pkey" PRIMARY KEY ("organizationId")
);

ALTER TABLE "organization_key_configs"
  ADD CONSTRAINT "organization_key_configs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "organization_key_configs" TO anviq_app;

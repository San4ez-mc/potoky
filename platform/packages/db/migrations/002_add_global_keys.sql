-- CreateTable global_keys
CREATE TABLE "global_keys" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "label" VARCHAR(255),
    "value" TEXT NOT NULL,
    "description" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "global_keys_projectId_key_key" ON "global_keys"("projectId", "key");

-- CreateIndex
CREATE INDEX "global_keys_projectId_idx" ON "global_keys"("projectId");

-- AddForeignKey
ALTER TABLE "global_keys" ADD CONSTRAINT "global_keys_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

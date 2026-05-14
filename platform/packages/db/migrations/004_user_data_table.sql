-- CreateTable user_data
CREATE TABLE "user_data" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramId" BIGINT,
    "botId" TEXT NOT NULL,
    "name" VARCHAR(255),
    "role" VARCHAR(255),
    "company" TEXT,
    "financialProblem" TEXT,
    "outputFileId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_data_userId_idx" ON "user_data"("userId");
CREATE INDEX "user_data_telegramId_idx" ON "user_data"("telegramId");
CREATE INDEX "user_data_botId_idx" ON "user_data"("botId");
CREATE UNIQUE INDEX "user_data_userId_botId_key" ON "user_data"("userId", "botId");

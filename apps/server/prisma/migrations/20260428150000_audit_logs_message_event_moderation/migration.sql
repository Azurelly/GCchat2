CREATE TYPE "AuditAction" AS ENUM (
  'MESSAGE_DELETE',
  'MESSAGE_RESTORE',
  'MESSAGE_EDIT',
  'USER_BAN',
  'USER_UNBAN',
  'USER_ROLE_UPDATE',
  'CALENDAR_EVENT_DELETE',
  'CALENDAR_EVENT_RESTORE'
);

ALTER TABLE "Message" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "deletedById" TEXT;

ALTER TABLE "CalendarEvent" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "action" "AuditAction" NOT NULL,
  "actorId" TEXT,
  "targetUserId" TEXT,
  "messageId" TEXT,
  "channelId" TEXT,
  "calendarEventId" TEXT,
  "metadata" JSONB NOT NULL,
  "restoredAt" TIMESTAMP(3),
  "restoredById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Message_deletedAt_idx" ON "Message"("deletedAt");
CREATE INDEX "CalendarEvent_deletedAt_idx" ON "CalendarEvent"("deletedAt");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX "AuditLog_messageId_idx" ON "AuditLog"("messageId");
CREATE INDEX "AuditLog_calendarEventId_idx" ON "AuditLog"("calendarEventId");
CREATE INDEX "AuditLog_targetUserId_idx" ON "AuditLog"("targetUserId");

ALTER TABLE "Message" ADD CONSTRAINT "Message_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

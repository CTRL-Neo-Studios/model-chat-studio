ALTER TABLE "chatShare" ADD COLUMN "role" text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "userId" uuid;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Until now only a chat's owner sent messages in it.
UPDATE "message" SET "userId" = "chat"."userId" FROM "chat" WHERE "chat"."id" = "message"."chatId" AND "message"."role" = 'user';
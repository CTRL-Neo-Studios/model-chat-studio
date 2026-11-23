ALTER TABLE "character" ADD COLUMN "avatarFileId" uuid;--> statement-breakpoint
ALTER TABLE "character" ADD COLUMN "greetings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "character" ADD COLUMN "examples" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "character" ADD COLUMN "note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "character" ADD COLUMN "creatorNotes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "character" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "character" ADD COLUMN "card" jsonb;--> statement-breakpoint
ALTER TABLE "character" ADD CONSTRAINT "character_avatarFileId_file_id_fk" FOREIGN KEY ("avatarFileId") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;
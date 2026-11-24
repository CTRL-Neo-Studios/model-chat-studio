CREATE TABLE "contextProfile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" uuid,
	"name" text NOT NULL,
	"blocks" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "contextProfileId" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "contextProfileId" uuid;--> statement-breakpoint
ALTER TABLE "contextProfile" ADD CONSTRAINT "contextProfile_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contextProfile_ownerId_index" ON "contextProfile" USING btree ("ownerId");--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_contextProfileId_contextProfile_id_fk" FOREIGN KEY ("contextProfileId") REFERENCES "public"."contextProfile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_contextProfileId_contextProfile_id_fk" FOREIGN KEY ("contextProfileId") REFERENCES "public"."contextProfile"("id") ON DELETE set null ON UPDATE no action;
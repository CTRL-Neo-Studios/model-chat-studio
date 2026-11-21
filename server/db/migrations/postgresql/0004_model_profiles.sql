CREATE TABLE "modelProfile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" uuid,
	"name" text NOT NULL,
	"color" text,
	"platform" text NOT NULL,
	"modelId" text NOT NULL,
	"systemPrompt" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chatModel" ADD COLUMN "profileId" uuid;--> statement-breakpoint
ALTER TABLE "modelProfile" ADD CONSTRAINT "modelProfile_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "modelProfile_ownerId_index" ON "modelProfile" USING btree ("ownerId");--> statement-breakpoint
ALTER TABLE "chatModel" ADD CONSTRAINT "chatModel_profileId_modelProfile_id_fk" FOREIGN KEY ("profileId") REFERENCES "public"."modelProfile"("id") ON DELETE set null ON UPDATE no action;
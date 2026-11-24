CREATE TABLE "character" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" uuid,
	"name" text NOT NULL,
	"color" text,
	"instructions" text DEFAULT '' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characterLibrary" (
	"characterId" uuid NOT NULL,
	"libraryId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "characterLibrary_characterId_libraryId_pk" PRIMARY KEY("characterId","libraryId")
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "userCharacterId" uuid;--> statement-breakpoint
ALTER TABLE "chatModel" ADD COLUMN "characterId" uuid;--> statement-breakpoint
ALTER TABLE "modelProfile" ADD COLUMN "characterId" uuid;--> statement-breakpoint
ALTER TABLE "character" ADD CONSTRAINT "character_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characterLibrary" ADD CONSTRAINT "characterLibrary_characterId_character_id_fk" FOREIGN KEY ("characterId") REFERENCES "public"."character"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characterLibrary" ADD CONSTRAINT "characterLibrary_libraryId_library_id_fk" FOREIGN KEY ("libraryId") REFERENCES "public"."library"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_ownerId_index" ON "character" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "characterLibrary_libraryId_index" ON "characterLibrary" USING btree ("libraryId");--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_userCharacterId_character_id_fk" FOREIGN KEY ("userCharacterId") REFERENCES "public"."character"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatModel" ADD CONSTRAINT "chatModel_characterId_character_id_fk" FOREIGN KEY ("characterId") REFERENCES "public"."character"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelProfile" ADD CONSTRAINT "modelProfile_characterId_character_id_fk" FOREIGN KEY ("characterId") REFERENCES "public"."character"("id") ON DELETE set null ON UPDATE no action;
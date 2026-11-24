CREATE TABLE "chatLibrary" (
	"chatId" uuid NOT NULL,
	"libraryId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatLibrary_chatId_libraryId_pk" PRIMARY KEY("chatId","libraryId")
);
--> statement-breakpoint
CREATE TABLE "library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "libraryEntry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"libraryId" uuid NOT NULL,
	"parentId" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"fileId" uuid,
	"content" text,
	"searchText" text,
	"searchVector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce("searchText", ''))) STORED,
	"createdBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "libraryEntry_libraryId_parentId_name_unique" UNIQUE NULLS NOT DISTINCT("libraryId","parentId","name")
);
--> statement-breakpoint
CREATE TABLE "libraryMember" (
	"libraryId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"role" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "libraryMember_libraryId_userId_pk" PRIMARY KEY("libraryId","userId")
);
--> statement-breakpoint
CREATE TABLE "structureProfile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" uuid,
	"name" text NOT NULL,
	"blocks" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "structureProfileId" uuid;--> statement-breakpoint
ALTER TABLE "chatLibrary" ADD CONSTRAINT "chatLibrary_chatId_chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatLibrary" ADD CONSTRAINT "chatLibrary_libraryId_library_id_fk" FOREIGN KEY ("libraryId") REFERENCES "public"."library"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library" ADD CONSTRAINT "library_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "libraryEntry" ADD CONSTRAINT "libraryEntry_libraryId_library_id_fk" FOREIGN KEY ("libraryId") REFERENCES "public"."library"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "libraryEntry" ADD CONSTRAINT "libraryEntry_parentId_libraryEntry_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."libraryEntry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "libraryEntry" ADD CONSTRAINT "libraryEntry_fileId_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "libraryEntry" ADD CONSTRAINT "libraryEntry_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "libraryMember" ADD CONSTRAINT "libraryMember_libraryId_library_id_fk" FOREIGN KEY ("libraryId") REFERENCES "public"."library"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "libraryMember" ADD CONSTRAINT "libraryMember_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structureProfile" ADD CONSTRAINT "structureProfile_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chatLibrary_libraryId_index" ON "chatLibrary" USING btree ("libraryId");--> statement-breakpoint
CREATE INDEX "library_ownerId_index" ON "library" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "libraryEntry_fileId_index" ON "libraryEntry" USING btree ("fileId");--> statement-breakpoint
CREATE INDEX "libraryEntry_searchVector_index" ON "libraryEntry" USING gin ("searchVector");--> statement-breakpoint
CREATE INDEX "libraryMember_userId_index" ON "libraryMember" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "structureProfile_ownerId_index" ON "structureProfile" USING btree ("ownerId");--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_structureProfileId_structureProfile_id_fk" FOREIGN KEY ("structureProfileId") REFERENCES "public"."structureProfile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Data: projects become libraries, context profiles become structure profiles, project chats keep their files and profile.
INSERT INTO "library" ("id", "ownerId", "name", "description", "createdAt", "updatedAt") SELECT "id", "ownerId", "name", "description", "createdAt", "updatedAt" FROM "project";--> statement-breakpoint
INSERT INTO "libraryMember" ("libraryId", "userId", "role", "createdAt") SELECT "projectId", "userId", CASE WHEN "role" = 'editor' THEN 'editor' ELSE 'viewer' END, "createdAt" FROM "projectMember";--> statement-breakpoint
INSERT INTO "libraryEntry" ("id", "libraryId", "parentId", "kind", "name", "tags", "fileId", "content", "searchText", "createdBy", "createdAt", "updatedAt") SELECT "id", "projectId", "parentId", "kind", "name", "tags", "fileId", "content", "searchText", "createdBy", "createdAt", "updatedAt" FROM "projectEntry";--> statement-breakpoint
INSERT INTO "structureProfile" ("id", "ownerId", "name", "blocks", "createdAt", "updatedAt") SELECT "id", "ownerId", "name", "blocks", "createdAt", "updatedAt" FROM "contextProfile";--> statement-breakpoint
INSERT INTO "chatLibrary" ("chatId", "libraryId", "createdAt") SELECT "id", "projectId", "createdAt" FROM "chat" WHERE "projectId" IS NOT NULL;--> statement-breakpoint
UPDATE "chat" SET "structureProfileId" = coalesce("chat"."contextProfileId", "project"."contextProfileId") FROM "project" WHERE "chat"."projectId" = "project"."id";--> statement-breakpoint
UPDATE "chat" SET "structureProfileId" = "contextProfileId" WHERE "projectId" IS NULL AND "contextProfileId" IS NOT NULL;--> statement-breakpoint
UPDATE "pin" SET "kind" = 'library' WHERE "kind" = 'project';--> statement-breakpoint
UPDATE "pin" SET "kind" = 'structureProfile' WHERE "kind" = 'contextProfile';--> statement-breakpoint
-- The columns first: dropping the tables with CASCADE takes their foreign keys along.
ALTER TABLE "chat" DROP CONSTRAINT "chat_projectId_project_id_fk";--> statement-breakpoint
ALTER TABLE "chat" DROP CONSTRAINT "chat_contextProfileId_contextProfile_id_fk";--> statement-breakpoint
ALTER TABLE "chatFolder" DROP CONSTRAINT "chatFolder_projectId_project_id_fk";--> statement-breakpoint
ALTER TABLE "chat" DROP COLUMN "projectId";--> statement-breakpoint
ALTER TABLE "chat" DROP COLUMN "contextProfileId";--> statement-breakpoint
ALTER TABLE "chat" DROP COLUMN "projectVisible";--> statement-breakpoint
ALTER TABLE "chatFolder" DROP COLUMN "projectId";--> statement-breakpoint
DROP TABLE "projectMember";--> statement-breakpoint
DROP TABLE "projectEntry";--> statement-breakpoint
DROP TABLE "project";--> statement-breakpoint
DROP TABLE "contextProfile";
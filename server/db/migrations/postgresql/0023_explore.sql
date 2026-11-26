CREATE TABLE "acquisition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"listingId" uuid NOT NULL,
	"versionId" uuid,
	"created" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text,
	"status" text DEFAULT 'listed' NOT NULL,
	"statusReason" text,
	"featured" boolean DEFAULT false NOT NULL,
	"currentVersionId" uuid,
	"basedOnId" uuid,
	"source" jsonb NOT NULL,
	"gets" integer DEFAULT 0 NOT NULL,
	"publishedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listingFile" (
	"versionId" uuid NOT NULL,
	"key" text NOT NULL,
	"fileId" uuid NOT NULL,
	CONSTRAINT "listingFile_versionId_key_pk" PRIMARY KEY("versionId","key")
);
--> statement-breakpoint
CREATE TABLE "listingVersion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listingId" uuid NOT NULL,
	"number" integer NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"content" jsonb NOT NULL,
	"size" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listingVersion_listingId_number_unique" UNIQUE("listingId","number")
);
--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_listingId_listing_id_fk" FOREIGN KEY ("listingId") REFERENCES "public"."listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_versionId_listingVersion_id_fk" FOREIGN KEY ("versionId") REFERENCES "public"."listingVersion"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing" ADD CONSTRAINT "listing_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing" ADD CONSTRAINT "listing_currentVersionId_listingVersion_id_fk" FOREIGN KEY ("currentVersionId") REFERENCES "public"."listingVersion"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing" ADD CONSTRAINT "listing_basedOnId_listing_id_fk" FOREIGN KEY ("basedOnId") REFERENCES "public"."listing"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listingFile" ADD CONSTRAINT "listingFile_versionId_listingVersion_id_fk" FOREIGN KEY ("versionId") REFERENCES "public"."listingVersion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listingFile" ADD CONSTRAINT "listingFile_fileId_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listingVersion" ADD CONSTRAINT "listingVersion_listingId_listing_id_fk" FOREIGN KEY ("listingId") REFERENCES "public"."listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acquisition_userId_listingId_index" ON "acquisition" USING btree ("userId","listingId");--> statement-breakpoint
CREATE INDEX "listing_ownerId_index" ON "listing" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "listing_status_publishedAt_index" ON "listing" USING btree ("status","publishedAt");--> statement-breakpoint
CREATE INDEX "listingFile_fileId_index" ON "listingFile" USING btree ("fileId");
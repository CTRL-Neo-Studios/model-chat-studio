CREATE TABLE "contentPackage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" uuid NOT NULL,
	"name" text NOT NULL,
	"items" jsonb DEFAULT '{"characterIds":[],"libraryIds":[],"structureProfileIds":[]}'::jsonb NOT NULL,
	"setup" jsonb,
	"texts" jsonb DEFAULT '{"summary":"","description":"","tags":[],"category":null}'::jsonb NOT NULL,
	"listingId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contentPackage_listingId_unique" UNIQUE("listingId")
);
--> statement-breakpoint
ALTER TABLE "contentPackage" ADD CONSTRAINT "contentPackage_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contentPackage" ADD CONSTRAINT "contentPackage_listingId_listing_id_fk" FOREIGN KEY ("listingId") REFERENCES "public"."listing"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contentPackage_ownerId_index" ON "contentPackage" USING btree ("ownerId");
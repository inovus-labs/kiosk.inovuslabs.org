import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_slides\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`type\` text DEFAULT 'text' NOT NULL,
  	\`title\` text,
  	\`body\` text,
  	\`media_id\` integer,
  	\`publish_at\` text NOT NULL,
  	\`expires_at\` text,
  	\`pinned_order\` numeric,
  	\`status\` text DEFAULT 'draft' NOT NULL,
  	\`created_by_name\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_slides\`("id", "type", "title", "body", "media_id", "publish_at", "expires_at", "pinned_order", "status", "created_by_name", "updated_at", "created_at") SELECT "id", "type", "title", "body", "media_id", "publish_at", "expires_at", "pinned_order", "status", "created_by_name", "updated_at", "created_at" FROM \`slides\`;`)
  await db.run(sql`DROP TABLE \`slides\`;`)
  await db.run(sql`ALTER TABLE \`__new_slides\` RENAME TO \`slides\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`slides_media_idx\` ON \`slides\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`slides_updated_at_idx\` ON \`slides\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`slides_created_at_idx\` ON \`slides\` (\`created_at\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_slides\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`title\` text NOT NULL,
  	\`type\` text DEFAULT 'text' NOT NULL,
  	\`body\` text,
  	\`media_id\` integer,
  	\`accent\` text DEFAULT '#6C63FF',
  	\`publish_at\` text NOT NULL,
  	\`expires_at\` text,
  	\`pinned_order\` numeric,
  	\`status\` text DEFAULT 'draft' NOT NULL,
  	\`created_by_name\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_slides\`("id", "title", "type", "body", "media_id", "accent", "publish_at", "expires_at", "pinned_order", "status", "created_by_name", "updated_at", "created_at") SELECT "id", "title", "type", "body", "media_id", "accent", "publish_at", "expires_at", "pinned_order", "status", "created_by_name", "updated_at", "created_at" FROM \`slides\`;`)
  await db.run(sql`DROP TABLE \`slides\`;`)
  await db.run(sql`ALTER TABLE \`__new_slides\` RENAME TO \`slides\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`slides_media_idx\` ON \`slides\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`slides_updated_at_idx\` ON \`slides\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`slides_created_at_idx\` ON \`slides\` (\`created_at\`);`)
}

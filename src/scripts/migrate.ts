/**
 * Database Migration Script
 *
 * Runs Drizzle migrations programmatically.
 * This script uses drizzle-orm/migrator (production dependency)
 * instead of drizzle-kit (dev dependency).
 *
 * Usage:
 *   npx tsx src/scripts/migrate.ts           # Development
 *   node dist/scripts/migrate.js             # Production
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import path from 'path';

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  console.log('🔄 Starting database migrations...');

  // Create a connection specifically for migrations (max 1 connection)
  const migrationClient = postgres(databaseUrl, { max: 1 });

  try {
    const db = drizzle(migrationClient);

    // Determine migrations folder path
    // In production: /app/drizzle/migrations
    // In development: ./drizzle/migrations
    const migrationsFolder = process.env.NODE_ENV === 'production'
      ? '/app/drizzle/migrations'
      : path.join(process.cwd(), 'drizzle/migrations');

    console.log(`📂 Using migrations path: ${migrationsFolder}`);

    await migrate(db, { migrationsFolder });

    console.log('✅ Migrations completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await migrationClient.end();
  }
}

runMigrations();

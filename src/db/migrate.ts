import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { Pool } from 'pg';

import { getEnv } from '../config/env.js';

interface MigrationFile {
  filename: string;
  sql: string;
  checksum: string;
}

interface AppliedMigrationRow {
  filename: string;
  checksum: string;
}

function hashMigration(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

async function readMigrationFiles(migrationsDirectory: string): Promise<MigrationFile[]> {
  const files = await readdir(migrationsDirectory);

  const sqlFiles = files
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  const migrations: MigrationFile[] = [];

  for (const filename of sqlFiles) {
    const fullPath = path.join(migrationsDirectory, filename);
    const sql = await readFile(fullPath, 'utf8');

    migrations.push({
      filename,
      sql,
      checksum: hashMigration(sql)
    });
  }

  return migrations;
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadAppliedMigrations(pool: Pool): Promise<Map<string, string>> {
  const result = await pool.query<AppliedMigrationRow>('SELECT filename, checksum FROM schema_migrations');
  return new Map(result.rows.map((row) => [row.filename, row.checksum]));
}

async function applyMigration(pool: Pool, migration: MigrationFile): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(migration.sql);
    await client.query(
      `
      INSERT INTO schema_migrations (filename, checksum)
      VALUES ($1, $2)
      `,
      [migration.filename, migration.checksum]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function run(): Promise<void> {
  const env = getEnv();
  const databaseUrl = env.DATABASE_URL;

  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL must be configured to run migrations.');
  }

  const migrationsDirectory = path.resolve(process.cwd(), 'migrations');
  const migrations = await readMigrationFiles(migrationsDirectory);

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await ensureMigrationsTable(pool);
    const applied = await loadAppliedMigrations(pool);

    for (const migration of migrations) {
      const appliedChecksum = applied.get(migration.filename);

      if (appliedChecksum === undefined) {
        console.log(`Applying migration ${migration.filename}...`);
        await applyMigration(pool, migration);
        console.log(`Applied migration ${migration.filename}.`);
        continue;
      }

      if (appliedChecksum !== migration.checksum) {
        throw new Error(
          `Checksum mismatch for migration ${migration.filename}. ` +
          'The migration has changed after being applied.'
        );
      }
    }

    console.log('Migration run complete.');
  } finally {
    await pool.end();
  }
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

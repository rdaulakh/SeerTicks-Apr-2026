#!/usr/bin/env node

/**
 * Database Export Script
 * Exports the complete SEER database schema and data to a SQL file
 * 
 * Usage:
 *   node scripts/export-database.mjs
 * 
 * Requirements:
 *   - DATABASE_URL environment variable must be set
 *   - mysql command-line client must be installed
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const execAsync = promisify(exec);

async function exportDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable not set');
    process.exit(1);
  }

  // Parse MySQL connection string
  // Format: mysql://user:password@host:port/database?ssl=true
  const urlMatch = databaseUrl.match(/mysql:\/\/([^:]+):([^@]+)@([^/:]+)(?::(\d+))?\/([^?]+)/);
  
  if (!urlMatch) {
    console.error('ERROR: Invalid DATABASE_URL format');
    console.error('Expected: mysql://user:password@host:port/database');
    process.exit(1);
  }

  const [, user, password, host, port, database] = urlMatch;
  const portStr = port ? `-P ${port}` : '';
  
  // Build mysql command
  const mysqlCmd = `mysql --ssl-mode=REQUIRED -h ${host} ${portStr} -u ${user} -p${password} ${database} --single-transaction --routines --triggers`;
  
  console.log('Exporting database...');
  console.log(`Host: ${host}`);
  console.log(`Database: ${database}`);
  console.log('');

  try {
    const { stdout, stderr } = await execAsync(mysqlCmd);
    
    const outputFile = resolve('database_export.sql');
    writeFileSync(outputFile, stdout);
    
    console.log(`✓ Database exported successfully to: ${outputFile}`);
    console.log(`  File size: ${(stdout.length / 1024 / 1024).toFixed(2)} MB`);
    
    if (stderr) {
      console.warn('Warnings:', stderr);
    }
  } catch (error) {
    console.error('ERROR: Failed to export database');
    console.error(error.message);
    process.exit(1);
  }
}

exportDatabase();

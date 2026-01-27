#!/usr/bin/env tsx
// =============================================================================
// GCDR Database Seed Runner
// =============================================================================
// CLI tool to execute seed scripts against PostgreSQL database
//
// Usage:
//   npx tsx scripts/db/seed-runner.ts [command] [options]
//
// Commands:
//   seed        Run all seed scripts (default)
//   clear       Clear all data
//   verify      Verify seeded data
//   list        List available seed scripts
//   run <file>  Run a specific seed file
//
// Options:
//   --dry-run   Show what would be executed without running
//   --verbose   Show detailed SQL output
// =============================================================================

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Configuration
const SEEDS_DIR = path.join(__dirname, 'seeds');
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5433';
const DB_NAME = process.env.DB_NAME || 'db_gcdr';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || 'gcdr_dev_password_123';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset): void {
  console.log(`${color}${message}${colors.reset}`);
}

function logHeader(message: string): void {
  console.log('\n' + '='.repeat(60));
  log(message, colors.bright + colors.cyan);
  console.log('='.repeat(60));
}

function logSuccess(message: string): void {
  log(`✓ ${message}`, colors.green);
}

function logError(message: string): void {
  log(`✗ ${message}`, colors.red);
}

function logInfo(message: string): void {
  log(`ℹ ${message}`, colors.blue);
}

function logWarning(message: string): void {
  log(`⚠ ${message}`, colors.yellow);
}

// Get list of seed files in order
function getSeedFiles(): string[] {
  const files = fs.readdirSync(SEEDS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
  return files;
}

// Execute SQL file using psql via Docker
async function executeSqlFile(filename: string, verbose: boolean = false): Promise<{ success: boolean; output: string; duration: number }> {
  const filepath = path.join(SEEDS_DIR, filename);
  const startTime = Date.now();

  try {
    // Read SQL content
    const sqlContent = fs.readFileSync(filepath, 'utf-8');

    // Execute via docker exec
    const command = `docker exec -i gcdr-postgres psql -U ${DB_USER} -d ${DB_NAME} -v ON_ERROR_STOP=1`;

    const result = execSync(command, {
      input: sqlContent,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    const duration = Date.now() - startTime;

    return {
      success: true,
      output: result,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      output: error.stderr || error.message,
      duration,
    };
  }
}

// Run all seed scripts in order
async function runAllSeeds(options: { dryRun?: boolean; verbose?: boolean } = {}): Promise<void> {
  logHeader('GCDR Database Seeder');

  const files = getSeedFiles().filter(f => !f.startsWith('00-') && !f.startsWith('99-'));

  if (options.dryRun) {
    logWarning('DRY RUN - No changes will be made');
    console.log('\nWould execute the following scripts:');
    files.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    return;
  }

  logInfo(`Found ${files.length} seed scripts to execute`);
  console.log('');

  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    process.stdout.write(`Running ${file}... `);

    const result = await executeSqlFile(file, options.verbose);

    if (result.success) {
      logSuccess(`Done (${result.duration}ms)`);
      successCount++;

      if (options.verbose && result.output) {
        console.log(colors.dim + result.output + colors.reset);
      }
    } else {
      logError(`Failed (${result.duration}ms)`);
      failCount++;
      console.log(colors.red + result.output + colors.reset);
    }
  }

  console.log('');
  logHeader('Summary');
  logInfo(`Total: ${files.length} scripts`);
  logSuccess(`Success: ${successCount}`);
  if (failCount > 0) {
    logError(`Failed: ${failCount}`);
  }
}

// Clear all data
async function clearAll(options: { dryRun?: boolean } = {}): Promise<void> {
  logHeader('Clear All Data');

  if (options.dryRun) {
    logWarning('DRY RUN - No changes will be made');
    logInfo('Would execute: 00-clear-all.sql');
    return;
  }

  logWarning('This will DELETE ALL DATA from the database!');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>(resolve => {
    rl.question('Are you sure? (yes/no): ', resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== 'yes') {
    logInfo('Operation cancelled');
    return;
  }

  process.stdout.write('Clearing all data... ');
  const result = await executeSqlFile('00-clear-all.sql');

  if (result.success) {
    logSuccess(`Done (${result.duration}ms)`);
    console.log(result.output);
  } else {
    logError(`Failed (${result.duration}ms)`);
    console.log(colors.red + result.output + colors.reset);
  }
}

// Verify seeded data
async function verify(options: { verbose?: boolean } = {}): Promise<void> {
  logHeader('Verify Seeded Data');

  process.stdout.write('Running verification... ');
  const result = await executeSqlFile('99-verify-all.sql', true);

  if (result.success) {
    logSuccess(`Done (${result.duration}ms)`);
    console.log('\n' + result.output);
  } else {
    logError(`Failed (${result.duration}ms)`);
    console.log(colors.red + result.output + colors.reset);
  }
}

// List available seed scripts
function listScripts(): void {
  logHeader('Available Seed Scripts');

  const files = getSeedFiles();

  files.forEach(file => {
    const filepath = path.join(SEEDS_DIR, file);
    const stats = fs.statSync(filepath);
    const sizeKb = (stats.size / 1024).toFixed(1);

    let color = colors.reset;
    if (file.startsWith('00-')) color = colors.red;
    else if (file.startsWith('99-')) color = colors.magenta;

    console.log(`${color}  ${file.padEnd(30)} ${sizeKb} KB${colors.reset}`);
  });

  console.log('');
  logInfo(`Total: ${files.length} scripts`);
}

// Run a specific seed file
async function runSingle(filename: string, options: { verbose?: boolean } = {}): Promise<void> {
  logHeader(`Running: ${filename}`);

  const files = getSeedFiles();
  if (!files.includes(filename)) {
    logError(`File not found: ${filename}`);
    logInfo('Use "list" command to see available scripts');
    return;
  }

  process.stdout.write(`Executing ${filename}... `);
  const result = await executeSqlFile(filename, true);

  if (result.success) {
    logSuccess(`Done (${result.duration}ms)`);
    console.log('\n' + result.output);
  } else {
    logError(`Failed (${result.duration}ms)`);
    console.log(colors.red + result.output + colors.reset);
  }
}

// Interactive menu
async function interactiveMenu(): Promise<void> {
  logHeader('GCDR Database Seed Runner - Interactive Mode');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  while (true) {
    console.log('\nOptions:');
    console.log('  1. Seed all tables');
    console.log('  2. Clear all data');
    console.log('  3. Verify data');
    console.log('  4. List scripts');
    console.log('  5. Run specific script');
    console.log('  6. Quick reset (clear + seed)');
    console.log('  0. Exit');
    console.log('');

    const choice = await question('Choose an option: ');

    switch (choice) {
      case '1':
        await runAllSeeds({ verbose: true });
        break;
      case '2':
        await clearAll();
        break;
      case '3':
        await verify();
        break;
      case '4':
        listScripts();
        break;
      case '5':
        const files = getSeedFiles();
        console.log('\nAvailable scripts:');
        files.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
        const fileChoice = await question('\nEnter file name or number: ');
        const selectedFile = isNaN(Number(fileChoice))
          ? fileChoice
          : files[Number(fileChoice) - 1];
        if (selectedFile) {
          await runSingle(selectedFile, { verbose: true });
        }
        break;
      case '6':
        logWarning('Quick reset will clear ALL data and reseed!');
        const confirm = await question('Continue? (yes/no): ');
        if (confirm.toLowerCase() === 'yes') {
          // Clear
          process.stdout.write('Clearing all data... ');
          const clearResult = await executeSqlFile('00-clear-all.sql');
          if (clearResult.success) {
            logSuccess('Done');
          } else {
            logError('Failed');
            console.log(clearResult.output);
            break;
          }
          // Seed
          await runAllSeeds({ verbose: false });
          // Verify
          await verify();
        }
        break;
      case '0':
        rl.close();
        logInfo('Goodbye!');
        return;
      default:
        logWarning('Invalid option');
    }
  }
}

// Main entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'interactive';
  const options = {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };

  switch (command) {
    case 'seed':
      await runAllSeeds(options);
      break;
    case 'clear':
      await clearAll(options);
      break;
    case 'verify':
      await verify(options);
      break;
    case 'list':
      listScripts();
      break;
    case 'run':
      const filename = args[1];
      if (!filename) {
        logError('Please specify a file name');
        logInfo('Usage: seed-runner run <filename>');
        process.exit(1);
      }
      await runSingle(filename, options);
      break;
    case 'interactive':
    case 'menu':
    case '-i':
      await interactiveMenu();
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log(`
GCDR Database Seed Runner

Usage:
  npx tsx scripts/db/seed-runner.ts [command] [options]

Commands:
  seed          Run all seed scripts (in order)
  clear         Clear all data (with confirmation)
  verify        Verify seeded data counts
  list          List available seed scripts
  run <file>    Run a specific seed file
  interactive   Interactive menu (default)
  help          Show this help

Options:
  --dry-run     Show what would be executed
  --verbose     Show detailed SQL output

Examples:
  npx tsx scripts/db/seed-runner.ts seed
  npx tsx scripts/db/seed-runner.ts clear
  npx tsx scripts/db/seed-runner.ts run 01-customers.sql
  npx tsx scripts/db/seed-runner.ts seed --verbose
`);
      break;
    default:
      logError(`Unknown command: ${command}`);
      logInfo('Use "help" for available commands');
      process.exit(1);
  }
}

main().catch(error => {
  logError(error.message);
  process.exit(1);
});

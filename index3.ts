import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { desc } from 'drizzle-orm';
import { chromium } from 'playwright';

// 1. Define the Supabase Database Schema
const candidates = pgTable('candidates', {
  id: uuid('id').primaryKey(),
  firstName: text('first_name'), // Update to match your exact column name if different
  lastName: text('last_name'),
  emailId: text('email_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

async function runAutomation() {
  console.log("Connecting to Supabase...");
  
  // 2. Connect to the Database
  const connectionString = process.env.DATABASE_URL!;
  const client = postgres(connectionString);
  const db = drizzle(client);

  try {
    // 3. Fetch the most recent candidate
    console.log("Fetching latest candidate...");
    const latestCandidates = await db.select()
      .from(candidates)
      .orderBy(desc(candidates.createdAt))
      .limit(1);

    if (latestCandidates.length === 0) {
      console.log("No candidates found in the database. Exiting.");
      process.exit(0);
    }

    const candidate = latestCandidates[0];
    const fullName = `${candidate.firstName} ${candidate.lastName}`.trim();
    console.log(`Found candidate: ${fullName} (${candidate.emailId})`);

    // 4. Launch Playwright
    console.log("Launching browser...");
    const browser = await chromium.launch({ headless: false }); // Set to true later to hide browser
    const page = await browser.newPage();

    // 5. Navigate and Login
    console.log("Logging into Aimea...");
    await page.goto(process.env.TARGET_SITE_URL!);

    await page.locator('input[type="email"]').fill(process.env.TARGET_SITE_USER!);
    await page.locator('input[type="password"]').fill(process.env.TARGET_SITE_PASS!);

    // Click login AND wait for the authentication request/navigation to finish completely
    await Promise.all([
      page.waitForURL(url => url.toString().includes('/admin'), { timeout: 15000 }),
      page.getByRole('button', { name: 'Login' }).click()
    ]);

    console.log("Login successful! Current URL:", page.url());

    // 6. Ensure we are on the Candidates page
    if (!page.url().includes('/candidates')) {
      console.log("Navigating to Candidates page...");
      await page.goto('https://dev.aimea.app/admin/candidates');
      await page.waitForLoadState('networkidle');
    }

    console.log("Adding candidate to Aimea...");
    const addBtn = page.getByRole('button', { name: /Add Candidate/i });
    await addBtn.waitFor({ state: 'visible' });
    await addBtn.click();

    await page.getByPlaceholder('e.g., John Doe').fill(fullName);
    await page.getByPlaceholder('e.g., john@example.com').fill(candidate.emailId!);
    await page.getByRole('button', { name: 'Create Candidate' }).click();

    // 7. Open Profile and Schedule
    console.log("Scheduling Interview...");
    // Wait for the modal to disappear and the new name to appear in the list
    await page.getByText(fullName, { exact: true }).first().click();
    
    await page.getByRole('button', { name: 'Create Interview Link' }).click();
    await page.getByRole('button', { name: 'Schedule Interview' }).click();

    // 8. Wait 10 seconds as requested
    console.log("Waiting 10 seconds...");
    await page.waitForTimeout(10000);

    // 9. Send Invite
    console.log("Sending invite...");
    await page.getByRole('button', { name: 'Send Invite' }).click();
    
    // Wait a moment for the success animation/network request to finish
    await page.waitForTimeout(2000);
    console.log("Automation complete!");

    await browser.close();
    process.exit(0);

  } catch (error) {
    console.error("An error occurred during automation:", error);
    process.exit(1);
  }
}

runAutomation();
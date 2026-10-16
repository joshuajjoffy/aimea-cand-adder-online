import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { desc } from 'drizzle-orm';
import { chromium } from 'playwright';

const app = express();
app.use(cors()); // Allows your website/frontend to communicate with this server
app.use(express.json());

// 1. Supabase Database Schema (with jobTitle included)
const candidates = pgTable('candidates', {
  id: uuid('id').primaryKey(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  emailId: text('email_id'),
  jobTitle: text('job_title'), // Added jobTitle column
  createdAt: timestamp('created_at').defaultNow(),
});

// 2. Headless Playwright Automation Sequence
async function runAutomation() {
  console.log("Connecting to Supabase...");
  const connectionString = process.env.DATABASE_URL!;
  const client = postgres(connectionString);
  const db = drizzle(client);

  console.log("Fetching latest candidate from Supabase...");
  const latestCandidates = await db.select()
    .from(candidates)
    .orderBy(desc(candidates.createdAt))
    .limit(1);

  if (latestCandidates.length === 0) {
    console.log("No candidates found in database.");
    return;
  }

  const candidate = latestCandidates[0];
  const fullName = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim();
  const targetJob = candidate.jobTitle || 'Servicetechniker'; // Fallback job title if empty

  console.log(`Found candidate: ${fullName} (${candidate.emailId}) | Job: ${targetJob}`);

  console.log("Launching headless browser for cloud container...");
  const browser = await chromium.launch({
    headless: true, // Updated for cloud execution
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Linux cloud sandbox flags
  });

  const page = await browser.newPage();

  try {
    console.log("Logging into Aimea...");
    await page.goto(process.env.TARGET_SITE_URL!);
    await page.locator('input[type="email"]').fill(process.env.TARGET_SITE_USER!);
    await page.locator('input[type="password"]').fill(process.env.TARGET_SITE_PASS!);

    await Promise.all([
      page.waitForURL(url => url.toString().includes('/admin'), { timeout: 15000 }),
      page.getByRole('button', { name: 'Login' }).click()
    ]);

    if (!page.url().includes('/candidates')) {
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

    console.log("Opening candidate profile...");
    await page.getByText(fullName, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Create Interview Link' }).click();

    console.log(`Selecting job title from dropdown: ${targetJob}...`);
    try {
      // Attempt to select job title from dropdown
      const jobDropdown = page.getByRole('combobox').first();
      await jobDropdown.click();
      await page.getByRole('option', { name: new RegExp(targetJob, 'i') }).click();
    } catch (dropdownErr) {
      console.log(`Dropdown option "${targetJob}" not matched directly, proceeding with standard selection.`);
    }

    console.log("Scheduling Interview...");
    await page.getByRole('button', { name: 'Schedule Interview' }).click();

    console.log("Waiting 10 seconds...");
    await page.waitForTimeout(10000);

    console.log("Sending invite...");
    await page.getByRole('button', { name: 'Send Invite' }).click();
    await page.waitForTimeout(2000);

    console.log("Automation completed successfully!");

  } catch (error) {
    console.error("An error occurred during Playwright automation:", error);
  } finally {
    await browser.close();
  }
}

// 3. Express API Endpoint
app.post('/api/start-interview', async (req, res) => {
  console.log("Received trigger from frontend button!");
  res.json({ message: "Automation triggered successfully" });

  try {
    await runAutomation();
  } catch (err) {
    console.error("Execution error:", err);
  }
});

// 4. Dynamic Port Listening for Render Cloud Hosting
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running and listening on port ${PORT}`);
});
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { desc } from 'drizzle-orm';
import { chromium } from 'playwright';

const app = express();
app.use(cors());
app.use(express.json());

const candidates = pgTable('candidates', {
  id: uuid('id').primaryKey(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  emailId: text('email_id'),
  jobTitle: text('job_title'),
  createdAt: timestamp('created_at').defaultNow(),
});

async function runAutomation() {
  // 1. Initialize our Checkpoint Tracker
  let checkpoint = "Initializing Database Connection...";
  let browser;

  try {
    console.log(`\n▶️ [CHECKPOINT]: ${checkpoint}`);
    const connectionString = process.env.DATABASE_URL!;
    const client = postgres(connectionString, { prepare: false }); // prepare: false required for Supabase pooler
    const db = drizzle(client);

    checkpoint = "Fetching latest candidate from Supabase...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    const latestCandidates = await db.select()
      .from(candidates)
      .orderBy(desc(candidates.createdAt))
      .limit(1);

    if (latestCandidates.length === 0) {
      console.log("⏸️ [STOP]: No candidates found in database. Exiting safely.");
      return;
    }

    const candidate = latestCandidates[0];
    const fullName = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim();
    const targetJob = candidate.jobTitle || 'Servicetechniker';
    console.log(`✅ [DATA FOUND]: ${fullName} | ${candidate.emailId} | ${targetJob}`);

    checkpoint = "Launching Headless Browser...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    browser = await chromium.launch({ 
      headless: true, 
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();

    checkpoint = "Navigating to Login Page...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.goto(process.env.TARGET_SITE_URL!);

    checkpoint = "Filling Login Credentials...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.locator('input[type="email"]').fill(process.env.TARGET_SITE_USER!);
    await page.locator('input[type="password"]').fill(process.env.TARGET_SITE_PASS!);

    checkpoint = "Submitting Login and Waiting for Redirect...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await Promise.all([
      page.waitForURL(url => url.toString().includes('/admin'), { timeout: 15000 }),
      page.getByRole('button', { name: 'Login' }).click()
    ]);

    checkpoint = "Verifying Candidates Page Location...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    if (!page.url().includes('/candidates')) {
      await page.goto('https://dev.aimea.app/admin/candidates');
      await page.waitForLoadState('networkidle');
    }

    checkpoint = "Clicking '+ Add Candidate' Button...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    const addBtn = page.getByRole('button', { name: /Add Candidate/i });
    await addBtn.waitFor({ state: 'visible' });
    await addBtn.click();

    checkpoint = "Filling New Candidate Form...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.getByPlaceholder('e.g., John Doe').fill(fullName);
    await page.getByPlaceholder('e.g., john@example.com').fill(candidate.emailId!);
    await page.getByRole('button', { name: 'Create Candidate' }).click();

    checkpoint = "Opening Candidate Profile...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.waitForTimeout(2000); // Wait for modal to close
    await page.getByText(fullName, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Create Interview Link' }).click();

    checkpoint = `Selecting Job Title: ${targetJob}...`;
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    try {
      const jobDropdown = page.getByRole('combobox').first();
      await jobDropdown.click();
      await page.getByRole('option', { name: new RegExp(targetJob, 'i') }).click();
    } catch (dropdownErr) {
      console.log(`⚠️ [WARNING]: Dropdown option "${targetJob}" not found. Using default.`);
    }

    checkpoint = "Clicking 'Schedule Interview'...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.getByRole('button', { name: 'Schedule Interview' }).click();

    checkpoint = "Waiting 10 seconds for Aimea processing...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.waitForTimeout(10000);

    checkpoint = "Clicking 'Send Invite'...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.getByRole('button', { name: 'Send Invite' }).click();
    await page.waitForTimeout(2000);

    console.log("🎉 [SUCCESS]: Automation completed perfectly!");

  } catch (error) {
    // 2. The Checkpoint Crash Reporter
    console.error(`\n❌ [CRASH REPORT] AUTOMATION BROKE AT CHECKPOINT:`);
    console.error(`👉 ${checkpoint}`);
    console.error(`\n[ERROR DETAILS]:`, error);
  } finally {
    if (browser) {
      console.log("🧹 [CLEANUP]: Closing browser...");
      await browser.close();
    }
  }
}

app.post('/api/start-interview', async (req, res) => {
  console.log("\n🔔 [WEBHOOK RECEIVED]: Triggered from frontend!");
  res.json({ message: "Automation triggered successfully" });

  try {
    await runAutomation();
  } catch (err) {
    console.error("Critical server error:", err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 [SERVER LIVE]: Listening on port ${PORT}`);
});
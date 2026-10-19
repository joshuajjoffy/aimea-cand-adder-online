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

// 1. Supabase Database Schema
const candidates = pgTable('candidates', {
  id: uuid('id').primaryKey(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  emailId: text('email_id'),
  jobTitle: text('job_title'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 2. Playwright Automation Function
async function runAutomation() {
  let checkpoint = "Initializing Database Connection...";
  let browser;

  try {
    console.log(`\n▶️ [CHECKPOINT]: ${checkpoint}`);
    const connectionString = process.env.DATABASE_URL!;
    const client = postgres(connectionString, { prepare: false }); 
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
    console.log(`✅ [DATA FOUND]: ${fullName} | ${candidate.emailId}`);

    checkpoint = "Launching Headless Browser (Cloud Run Active Mode)...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    browser = await chromium.launch({ 
      headless: true, 
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ] 
    });

    const page = await browser.newPage();

    checkpoint = "Navigating directly to Job URL...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.goto(process.env.TARGET_SITE_URL!, { timeout: 60000 });

    checkpoint = "Filling Login Credentials...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('input[type="email"]').fill(process.env.TARGET_SITE_USER!);
    await page.locator('input[type="password"]').fill(process.env.TARGET_SITE_PASS!);

    checkpoint = "Submitting Login...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.getByRole('button', { name: 'Login' }).click();

    checkpoint = "Waiting for Candidates Tab on Job Page...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    const candidatesTab = page.getByText(/Candidates/i).first();
    await candidatesTab.waitFor({ state: 'visible', timeout: 40000 });
    await candidatesTab.click();

    checkpoint = "Clicking 'Add person and invite'...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    const addBtn = page.getByRole('button', { name: /Add person and invite/i });
    await addBtn.waitFor({ state: 'visible', timeout: 20000 });
    await addBtn.click();

    checkpoint = "Switching to 'New person' tab...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.getByText('New person', { exact: true }).click();

    checkpoint = "Filling Candidate Name and Email...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    const dialog = page.getByRole('dialog');
    
    try {
        await dialog.getByLabel('Name').fill(fullName);
        await dialog.getByLabel('Email').fill(candidate.emailId!);
    } catch {
        const textInputs = dialog.locator('input[type="text"]');
        await textInputs.first().fill(fullName);
        await dialog.locator('input[type="email"], input[name="email"]').first().fill(candidate.emailId!);
    }

    checkpoint = "Clicking 'Schedule Interview'...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await dialog.getByRole('button', { name: 'Schedule Interview' }).click();

    checkpoint = "Waiting for Interview Generation...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.getByRole('heading', { name: 'Interview Scheduled!' }).waitFor({ state: 'visible', timeout: 20000 });

    checkpoint = "Clicking 'Send Invite'...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.getByRole('button', { name: 'Send Invite' }).click();

    checkpoint = "Closing Modal...";
    console.log(`▶️ [CHECKPOINT]: ${checkpoint}`);
    await page.getByRole('button', { name: 'Close' }).click();

    console.log("🎉 [SUCCESS]: Automation completed perfectly!");

  } catch (error) {
    console.error(`\n❌ [CRASH REPORT] AUTOMATION BROKE AT CHECKPOINT:`);
    console.error(`👉 ${checkpoint}`);
    console.error(`\n[ERROR DETAILS]:`, error);
    throw error;
  } finally {
    if (browser) {
      console.log("🧹 [CLEANUP]: Closing browser...");
      await browser.close();
    }
  }
}

// 3. Express API Endpoint (Awaits automation BEFORE returning HTTP response)
app.post('/api/start-interview', async (req, res) => {
  console.log("\n🔔 [WEBHOOK RECEIVED]: Triggered from frontend!");

  try {
    await runAutomation();
    res.json({ message: "Automation completed successfully" });
  } catch (err) {
    console.error("Critical server error during automation run:", err);
    res.status(500).json({ error: "Automation process failed" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 [SERVER LIVE]: Listening on port ${PORT}`);
});
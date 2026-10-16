import crypto from 'crypto';
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

  try {
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
      headless: true, // Required for cloud execution
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
      await page.waitForTimeout(2000); // Give the modal a moment to close
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

    } finally {
      await browser.close();
      // Notice: No process.exit() here, so the server doesn't crash after running!
    }
  } catch (error) {
    console.error("An error occurred during automation setup or database query:", error);
  }
}

// 3. Express API Endpoint
app.post('/api/start-interview', async (req, res) => {
  console.log("Received candidate form data from HTML website!");
  
  // Extract the data sent from the HTML form
  const { firstName, lastName, emailId, jobTitle } = req.body;

  try {
    // 1. Save the new candidate to Supabase
    const connectionString = process.env.DATABASE_URL!;
    const client = postgres(connectionString);
    const db = drizzle(client);

    await db.insert(candidates).values({
      id: crypto.randomUUID(),
      firstName: firstName,
      lastName: lastName,
      emailId: emailId,
      jobTitle: jobTitle
    });
    console.log(`Saved ${firstName} ${lastName} to Supabase successfully.`);

    // 2. Tell the HTML website it was successful so the button resets
    res.json({ message: "Candidate saved and automation triggered successfully" });

  } catch (dbError) {
    console.error("Failed to save to Supabase:", dbError);
    return res.status(500).json({ error: "Database error" });
  }

  // 3. Start Playwright in the background (it will fetch the row we just inserted)
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
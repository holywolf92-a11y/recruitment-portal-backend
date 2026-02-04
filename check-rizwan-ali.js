const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkRizwanAli() {
  console.log('\n🔍 Checking for Rizwan Ali CV upload...\n');

  try {
    // Check candidates table for Rizwan Ali
    const { data: candidates, error: candError } = await sb
      .from('candidates')
      .select('*')
      .or("name.ilike.%Rizwan Ali%,name.ilike.%Rizwan%Ali%")
      .order('created_at', { ascending: false });

    if (candError) {
      console.error('❌ Error querying candidates:', candError.message);
    } else if (candidates && candidates.length > 0) {
      console.log(`✅ Found ${candidates.length} candidate(s) matching "Rizwan Ali":\n`);
      
      for (const candidate of candidates) {
        console.log(`Name: ${candidate.name || 'N/A'}`);
        console.log(`Email: ${candidate.email || 'N/A'}`);
        console.log(`Phone: ${candidate.phone || 'N/A'}`);
        console.log(`ID: ${candidate.id}`);
        console.log(`Created: ${new Date(candidate.created_at).toLocaleString()}`);
        console.log(`CV Status: ${candidate.cv_status || 'N/A'}`);
        console.log(`CV File: ${candidate.cv_file_url || 'Not uploaded'}`);
        console.log('---\n');
      }
    } else {
      console.log('❌ No candidates found matching "Rizwan Ali"');
    }

    // Check parsing_jobs for recent jobs
    console.log('\n📋 Checking recent parsing jobs...\n');
    const { data: jobs, error: jobError } = await sb
      .from('parsing_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    if (jobError) {
      console.error('Error querying jobs:', jobError.message);
    } else if (jobs) {
      console.log(`Found ${jobs.length} recent jobs:\n`);
      jobs.forEach((job, i) => {
        console.log(`${i + 1}. Status: ${job.status}, Created: ${new Date(job.created_at).toLocaleString()}`);
      });
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }

  process.exit(0);
}

checkRizwanAli().catch(console.error);

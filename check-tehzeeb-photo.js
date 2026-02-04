const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = 'https://hncvsextwmvjydcukdwx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPhotoStatus() {
    console.log('🔍 Checking Tehzeeb Ali photo status...\n');

    // Check candidate record
    const { data: candidate, error } = await supabase
        .from('candidates')
        .select('id, name, candidate_code, profile_photo_url, profile_photo_bucket, profile_photo_path, created_at')
        .eq('candidate_code', 'FL-2026-889')
        .maybeSingle();

    if (error) {
        console.error('❌ Error:', error.message);
        return;
    }

    if (!candidate) {
        console.log('❌ Candidate FL-2026-889 not found');
        return;
    }

    console.log('✅ Candidate found:');
    console.log('- ID:', candidate.id);
    console.log('- Name:', candidate.name);
    console.log('- Code:', candidate.candidate_code);
    console.log('- Created:', candidate.created_at);
    console.log('');

    console.log('📸 Photo Status:');
    console.log('- profile_photo_url:', candidate.profile_photo_url || 'NULL ❌');
    console.log('- profile_photo_bucket:', candidate.profile_photo_bucket || 'NULL');
    console.log('- profile_photo_path:', candidate.profile_photo_path || 'NULL');
    console.log('');

    if (!candidate.profile_photo_url) {
        console.log('❌ ISSUE CONFIRMED: profile_photo_url is NULL in database');
        console.log('');
        console.log('The backend AI extraction succeeded but did NOT update the database!');
        console.log('Check aiProfilePhotoExtractionService.ts for database update logic.');
    } else {
        console.log('✅ Photo URL exists in database');
        console.log('');
        console.log('Testing accessibility...');

        // Try to access the URL
        try {
            const response = await fetch(candidate.profile_photo_url);
            if (response.ok) {
                console.log('✅ Photo URL is accessible (HTTP', response.status, ')');
            } else {
                console.log('❌ Photo URL returned HTTP', response.status);
                console.log('This suggests a permissions or URL signing issue');
            }
        } catch (err) {
            console.log('❌ Failed to fetch photo:', err.message);
        }
    }
}

checkPhotoStatus().catch(console.error);

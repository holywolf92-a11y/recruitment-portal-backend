const { createClient } = require('@supabase/supabase-js');

const s = createClient(
    'https://hncvsextwmvjydcukdwx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ'
);

async function check() {
    // Check the new candidate
    const { data, error } = await s
        .from('candidates')
        .select('name, candidate_code, profile_photo_url, profile_photo_path, created_at')
        .eq('id', 'e04c1cb1-3d3a-4f41-b25a-c28ce9dc7d74')
        .single();

    if (error) {
        console.log('Error:', error);
        return;
    }

    console.log('New Candidate (Tehzeeb - just uploaded):');
    console.log('- Name:', data.name);
    console.log('- Code:', data.candidate_code);
    console.log('- Created:', data.created_at);
    console.log('- Photo URL:', data.profile_photo_url ? 'EXISTS ✅' : 'NULL ❌');
    console.log('- Photo Path:', data.profile_photo_path || 'NULL');

    if (data.profile_photo_url) {
        console.log('\n✅ BACKEND FIX WORKING! Photo URL is set!');
    } else {
        console.log('\n❌ Backend fix not working - URL still NULL');
    }
}

check();

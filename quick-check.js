const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://hncvsextwmvjydcukdwx.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ'
);

async function check() {
    const { data, error } = await supabase
        .from('candidates')
        .select('profile_photo_url, profile_photo_bucket, profile_photo_path')
        .eq('candidate_code', 'FL-2026-889')
        .single();

    if (error) {
        console.log('Error:', error);
        return;
    }

    console.log(JSON.stringify(data, null, 2));
}

check();

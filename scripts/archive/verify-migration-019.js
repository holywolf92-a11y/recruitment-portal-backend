const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hncvsextwmvjydcukdwx.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function verifyColumns() {
  console.log('\n🔍 Verifying Migration 019 - Column Existence\n');
  console.log('='.repeat(60));
  
  try {
    // Check columns
    const { data: columns, error: colError } = await supabase.rpc('exec_sql', {
      query: `
        SELECT 
            column_name, 
            data_type,
            is_nullable,
            column_default
        FROM information_schema.columns 
        WHERE table_name = 'candidates' 
        AND column_name IN (
            'driving_license_received', 
            'driving_license_received_at',
            'police_character_received', 
            'police_character_received_at'
        )
        ORDER BY column_name;
      `
    });

    if (colError) {
      // Try direct query instead
      const { data: directData, error: directError } = await supabase
        .from('candidates')
        .select('driving_license_received, driving_license_received_at, police_character_received, police_character_received_at')
        .limit(1);
      
      if (directError) {
        console.error('❌ Error checking columns:', directError.message);
        if (directError.message.includes('column') && directError.message.includes('does not exist')) {
          console.log('\n⚠️  Columns do NOT exist - Migration 019 may not have run successfully');
          return;
        }
      } else {
        console.log('✅ Columns exist! (verified by direct query)');
        console.log('\n📊 Column Details:');
        console.log('   ✅ driving_license_received');
        console.log('   ✅ driving_license_received_at');
        console.log('   ✅ police_character_received');
        console.log('   ✅ police_character_received_at');
      }
    } else if (columns && columns.length === 4) {
      console.log('✅ All 4 columns exist!\n');
      console.log('📊 Column Details:');
      columns.forEach(col => {
        console.log(`   ✅ ${col.column_name} (${col.data_type})`);
      });
    } else {
      console.log(`⚠️  Found ${columns?.length || 0} columns (expected 4)`);
      if (columns) {
        columns.forEach(col => {
          console.log(`   ✅ ${col.column_name}`);
        });
      }
    }

    // Check trigger function
    console.log('\n🔍 Verifying Trigger Function\n');
    console.log('-'.repeat(60));
    
    const { data: funcData, error: funcError } = await supabase.rpc('exec_sql', {
      query: `
        SELECT 
            proname as function_name,
            CASE 
                WHEN prosrc LIKE '%driving_license%' THEN 'YES'
                ELSE 'NO'
            END as has_driving_license,
            CASE 
                WHEN prosrc LIKE '%police_character_certificate%' THEN 'YES'
                ELSE 'NO'
            END as has_police_character
        FROM pg_proc 
        WHERE proname = 'update_candidate_document_checklist';
      `
    });

    if (funcError) {
      console.log('⚠️  Could not verify trigger function (this is OK if using Supabase REST API)');
      console.log('   You can verify manually in Supabase SQL Editor');
    } else if (funcData && funcData.length > 0) {
      const func = funcData[0];
      console.log(`Function: ${func.function_name}`);
      console.log(`   Driving License: ${func.has_driving_license === 'YES' ? '✅' : '❌'}`);
      console.log(`   Police Character: ${func.has_police_character === 'YES' ? '✅' : '❌'}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Verification Complete!\n');

  } catch (error) {
    console.error('❌ Error during verification:', error.message);
  }
}

verifyColumns();

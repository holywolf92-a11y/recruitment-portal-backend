const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkInternshipsColumn() {
  try {
    const { data, error } = await supabase
      .from('candidates')
      .select('id, name, education, certifications, internships, previous_employment')
      .limit(5);

    if (error) {
      console.error('❌ Error querying candidates table:', error.message);
      return;
    }

    console.log('✅ Successfully queried candidates table with internships column');
    console.log('\n📊 Sample data (first 5 candidates):');
    console.log(JSON.stringify(data, null, 2));

    // Check if any candidates have internships data
    const withInternships = data.filter(c => c.internships);
    console.log(`\n✅ ${withInternships.length} candidates have internships data`);
    
    if (withInternships.length > 0) {
      console.log('\n📝 Candidates with internships:');
      withInternships.forEach(c => {
        console.log(`- ${c.name}: ${c.internships}`);
      });
    }

  } catch (error) {
    console.error('❌ Exception:', error.message);
  }
}

checkInternshipsColumn();

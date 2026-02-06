const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read .env file with proper handling
const envPath = path.join(__dirname, '.env');
let env = {};

try {
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return; // Skip empty lines and comments
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      // Remove quotes if present
      env[key] = value.replace(/^["']|["']$/g, '');
    }
  });
} catch (error) {
  console.error('❌ Error reading .env file:', error.message);
  process.exit(1);
}

const supabaseUrl = env.SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables in .env file');
  console.error('SUPABASE_URL:', supabaseUrl ? '✓ (' + supabaseUrl.substring(0, 30) + '...)' : '✗');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓' : '✗');
  console.error('\nEnv vars found:', Object.keys(env));
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function seedAdminRole() {
  console.log('🔄 Updating admin user with role metadata...');
  
  try {
    // Get all users
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();
    
    if (listError) {
      console.error('❌ Error listing users:', listError.message);
      process.exit(1);
    }

    const adminUser = users.users.find(u => u.email === 'admin@falisha.com');

    if (!adminUser) {
      console.log('❌ Admin user (admin@falisha.com) not found');
      process.exit(1);
    }

    console.log(`\n✓ Found admin user: ${adminUser.email}`);
    console.log(`  User ID: ${adminUser.id}`);
    console.log(`  Current metadata:`, adminUser.user_metadata || {});

    // Update admin user with role in metadata
    const { data, error: updateError } = await supabase.auth.admin.updateUserById(
      adminUser.id,
      {
        user_metadata: {
          ...(adminUser.user_metadata || {}),
          role: 'admin'
        }
      }
    );

    if (updateError) {
      console.error('❌ Error updating user:', updateError.message);
      process.exit(1);
    }

    console.log('\n✅ Admin user updated successfully!');
    console.log(`  New metadata:`, data.user.user_metadata);
    console.log('\n📝 Next steps:');
    console.log('1. Log out from your current session');
    console.log('2. Log in again as admin (admin@falisha.com / admin123)');
    console.log('3. You should now see the "Admin Panel" button in the sidebar');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    process.exit(1);
  }
}

seedAdminRole();

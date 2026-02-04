/**
 * Create Storage Folders for New Document Categories
 * 
 * This script creates the required storage folders in Supabase
 * for the new document categories.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET_NAME = 'documents';  // Main storage bucket for all documents

// Folders to create
const NEW_FOLDERS = [
  'educational_documents',
  'experience_certificates',
  'navttc_reports',
];

// Folders that should already exist
const EXISTING_FOLDERS = [
  'cv_resume',
  'passport',
  'cnic',
  'driving_license',
  'police_character_certificate',
  'certificates',
  'contracts',
  'medical_reports',
  'other_documents',
];

async function createStorageFolders() {
  console.log('========================================');
  console.log('🔐 Creating Storage Folders');
  console.log('========================================\n');

  // Check environment variables
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ ERROR: Missing environment variables!');
    console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env file\n');
    process.exit(1);
  }

  // Initialize Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log(`📦 Bucket: ${BUCKET_NAME}\n`);

  // Check if bucket exists
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
  if (bucketsError) {
    console.error('❌ Error listing buckets:', bucketsError.message);
    process.exit(1);
  }

  const bucketExists = buckets.some(b => b.name === BUCKET_NAME);
  if (!bucketExists) {
    console.error(`❌ ERROR: Bucket "${BUCKET_NAME}" does not exist!`);
    console.error('Please create it in Supabase Dashboard first.\n');
    process.exit(1);
  }

  console.log('✅ Bucket exists\n');

  // List existing folders
  console.log('📂 Checking existing folders...');
  const { data: existingFiles, error: listError } = await supabase.storage
    .from(BUCKET_NAME)
    .list('', { limit: 1000 });

  if (listError) {
    console.error('❌ Error listing folders:', listError.message);
    process.exit(1);
  }

  const existingFolderNames = existingFiles
    .filter(f => f.name && !f.name.includes('.'))
    .map(f => f.name);

  console.log(`Found ${existingFolderNames.length} existing folders:\n`);
  existingFolderNames.forEach(name => {
    console.log(`  ✅ /${name}`);
  });
  console.log('');

  // Create new folders
  console.log('📁 Creating new folders...\n');

  for (const folderName of NEW_FOLDERS) {
    if (existingFolderNames.includes(folderName)) {
      console.log(`⚠️  /${folderName} - Already exists, skipping`);
      continue;
    }

    // Create a placeholder file to establish the folder
    // Supabase storage creates folders implicitly when files are uploaded
    const placeholderPath = `${folderName}/.placeholder`;
    const placeholderContent = `This folder stores ${folderName.replace(/_/g, ' ')} documents`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(placeholderPath, placeholderContent, {
        contentType: 'text/plain',
        upsert: false,
      });

    if (uploadError) {
      if (uploadError.message.includes('already exists')) {
        console.log(`⚠️  /${folderName} - Already exists (placeholder found)`);
      } else {
        console.error(`❌ /${folderName} - Failed:`, uploadError.message);
      }
    } else {
      console.log(`✅ /${folderName} - Created successfully`);
    }
  }

  console.log('\n========================================');
  console.log('✅ Folder Creation Complete!');
  console.log('========================================\n');

  // Verify new folders were created
  console.log('🔍 Verification (New Folders):\n');

  const { data: finalList, error: finalListError } = await supabase.storage
    .from(BUCKET_NAME)
    .list('', { limit: 1000 });

  if (finalListError) {
    console.error('❌ Error during verification:', finalListError.message);
    process.exit(1);
  }

  const finalFolderNames = finalList
    .filter(f => f.name && !f.name.includes('.'))
    .map(f => f.name);

  let allPresent = true;
  for (const folderName of NEW_FOLDERS) {
    const exists = finalFolderNames.includes(folderName);
    if (exists) {
      console.log(`  ✅ /${folderName}`);
    } else {
      console.log(`  ❌ /${folderName} - MISSING!`);
      allPresent = false;
    }
  }

  console.log('');

  if (allPresent) {
    console.log('✅ All new folders created successfully!\n');
    console.log('📋 Next Steps:');
    console.log('  1. ✅ Database migration complete');
    console.log('  2. ✅ Storage folders created');
    console.log('  3. ✅ Backend code updated');
    console.log('  4. ✅ Frontend code updated');
    console.log('  5. ✅ Python parser updated');
    console.log('  6. 🔄 Restart backend server: cd backend && npm run dev');
    console.log('  7. 🔄 Rebuild frontend: cd .. && npm run build');
    console.log('  8. 🧪 Run tests (especially TODO 5.6 multi-document test)');
    console.log('');
    console.log('📝 Note: Category folders (cv_resume, passport, etc.) are created');
    console.log('   automatically when documents are first uploaded to them.');
    console.log('');
  } else {
    console.log('⚠️  Some new folders failed to create. Please try again or create manually.\n');
    process.exit(1);
  }
}

// Run the script
createStorageFolders().catch(error => {
  console.error('\n❌ Unexpected error:', error.message);
  process.exit(1);
});

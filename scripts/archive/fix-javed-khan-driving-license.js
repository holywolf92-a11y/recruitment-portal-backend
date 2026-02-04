const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function investigateJavedKhan() {
  console.log('🔍 Investigating Javed Khan Driving License Flag Issue\n');
  console.log('='.repeat(80));

  // 1. Find Javed Khan
  console.log('\n📋 Step 1: Finding candidate...');
  const { data: candidates, error: candidateError } = await supabase
    .from('candidates')
    .select('id, name, driving_license_received, driving_license_received_at')
    .or('name.ilike.%javed%khan%,name.ilike.%javed khan%');

  if (candidateError) {
    console.error('❌ Error finding candidate:', candidateError);
    return;
  }

  if (!candidates || candidates.length === 0) {
    console.log('❌ No candidate found with name containing "Javed Khan"');
    return;
  }

  console.log(`✅ Found ${candidates.length} candidate(s):`);
  candidates.forEach((c, i) => {
    console.log(`   ${i + 1}. ${c.name} (ID: ${c.id})`);
    console.log(`      driving_license_received: ${c.driving_license_received}`);
    console.log(`      driving_license_received_at: ${c.driving_license_received_at || 'NULL'}`);
  });

  const candidateId = candidates[0].id;
  const candidate = candidates[0];

  // 2. Find driving license documents (check both tables)
  console.log('\n📄 Step 2: Finding driving license documents...');
  
  // Search for the specific file mentioned by user
  const specificFileName = 'split_driving_license_1769351042428.pdf';
  
  // Check documents table (split-and-categorize flow)
  const { data: documents, error: docError } = await supabase
    .from('documents')
    .select('id, candidate_id, doc_type, file_name, created_at, storage_path')
    .or(`file_name.ilike.%${specificFileName}%,file_name.ilike.%driving_license%,file_name.ilike.%split_driving_license%,doc_type.eq.driving_license,doc_type.ilike.%driving%,doc_type.ilike.%license%`)
    .order('created_at', { ascending: false })
    .limit(100);
  
  // Also check candidate_documents table
  const { data: candidateDocs2, error: docError2 } = await supabase
    .from('candidate_documents')
    .select('id, candidate_id, document_type, category, file_name, created_at')
    .or(`file_name.ilike.%${specificFileName}%,file_name.ilike.%driving_license%,file_name.ilike.%split_driving_license%`)
    .order('created_at', { ascending: false })
    .limit(100);
  
  // Also search by candidate_id directly
  const { data: docsByCandidate, error: docError3 } = await supabase
    .from('documents')
    .select('id, candidate_id, doc_type, file_name, created_at, storage_path')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false })
    .limit(50);
  
  const { data: candidateDocsByCandidate, error: docError4 } = await supabase
    .from('candidate_documents')
    .select('id, candidate_id, document_type, category, file_name, created_at')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (docError) {
    console.error('❌ Error finding documents from documents table:', docError.message);
  }
  
  if (docError2) {
    console.log('⚠️  Note: candidate_documents table query had an issue (enum type), checking all docs for candidate instead');
  }
  
  if (docError3) {
    console.error('❌ Error finding documents by candidate_id:', docError3.message);
  }
  
  if (docError4) {
    console.error('❌ Error finding candidate_documents by candidate_id:', docError4.message);
  }

  // Combine all results
  const allFoundDocs = [
    ...(documents || []),
    ...(docsByCandidate || []),
  ];
  
  const allFoundCandidateDocs = candidateDocs2 || candidateDocsByCandidate || [];
  
  const candidateDocs = allFoundDocs.filter(d => d.candidate_id === candidateId);
  const candidateDocs2Filtered = allFoundCandidateDocs.filter(d => d.candidate_id === candidateId);
  
  console.log(`✅ Found ${allFoundDocs.length} total documents in 'documents' table, ${candidateDocs.length} for this candidate`);
  console.log(`✅ Found ${allFoundCandidateDocs.length} total documents in 'candidate_documents' table, ${candidateDocs2Filtered.length} for this candidate`);
  
  console.log('\n📋 All documents for this candidate from "documents" table:');
  if (candidateDocs.length === 0) {
    console.log('   (none found)');
  } else {
    candidateDocs.forEach((doc, i) => {
      console.log(`   ${i + 1}. ${doc.file_name}`);
      console.log(`      doc_type: "${doc.doc_type}" (lowercase: "${doc.doc_type?.toLowerCase()}")`);
      console.log(`      created_at: ${doc.created_at}`);
    });
  }
  
  console.log('\n📋 All documents for this candidate from "candidate_documents" table:');
  if (candidateDocs2Filtered.length === 0) {
    console.log('   (none found)');
  } else {
    candidateDocs2Filtered.forEach((doc, i) => {
      console.log(`   ${i + 1}. ${doc.file_name}`);
      console.log(`      document_type: "${doc.document_type}"`);
      console.log(`      category: "${doc.category}"`);
      console.log(`      created_at: ${doc.created_at}`);
    });
  }
  
  // Also check if the specific file exists anywhere
  console.log('\n🔍 Searching for specific file:', specificFileName);
  const { data: specificDoc } = await supabase
    .from('documents')
    .select('*')
    .ilike('file_name', `%${specificFileName}%`)
    .limit(5);
  
  if (specificDoc && specificDoc.length > 0) {
    console.log(`✅ Found ${specificDoc.length} document(s) matching "${specificFileName}":`);
    specificDoc.forEach((doc, i) => {
      console.log(`   ${i + 1}. ${doc.file_name}`);
      console.log(`      candidate_id: ${doc.candidate_id}`);
      console.log(`      doc_type: "${doc.doc_type}"`);
      console.log(`      created_at: ${doc.created_at}`);
      if (doc.candidate_id !== candidateId) {
        console.log(`      ⚠️  WARNING: Document belongs to different candidate!`);
      }
    });
  } else {
    console.log(`   (not found)`);
  }
  
  // Combine both for analysis
  const allDocs = [
    ...candidateDocs.map(d => ({ ...d, source: 'documents', type: d.doc_type })),
    ...candidateDocs2Filtered.map(d => ({ ...d, source: 'candidate_documents', type: d.document_type || d.category })),
    ...(specificDoc || []).map(d => ({ ...d, source: 'documents', type: d.doc_type }))
  ];
  
  // Remove duplicates
  const uniqueDocs = allDocs.filter((doc, index, self) => 
    index === self.findIndex(d => d.id === doc.id && d.source === doc.source)
  );

  // 3. Check trigger function (skip - requires direct SQL)
  console.log('\n⚙️  Step 3: Checking trigger function...');
  console.log('⚠️  Trigger check requires direct SQL access (run migration 020 to ensure it exists)');

  // 4. Check trigger (skip - requires direct SQL)
  console.log('\n🔧 Step 4: Checking trigger...');
  console.log('⚠️  Trigger check requires direct SQL access');

  // 5. Analyze the issue
  console.log('\n🔍 Step 5: Analyzing the issue...');
  
  const drivingLicenseDocs = uniqueDocs.filter(doc => {
    const docTypeLower = (doc.type || '').toLowerCase();
    const fileNameLower = (doc.file_name || '').toLowerCase();
    return docTypeLower === 'driving_license' ||
           docTypeLower === 'drivers_license' ||
           docTypeLower === 'driver_license' ||
           fileNameLower.includes('driving_license') ||
           fileNameLower.includes('split_driving_license');
  });

  console.log(`\n📊 Analysis:`);
  console.log(`   - Candidate has driving_license_received: ${candidate.driving_license_received}`);
  console.log(`   - Found ${drivingLicenseDocs.length} driving license document(s)`);
  
  // Check for misclassified documents (file name suggests driving license but category is wrong)
  const misclassifiedDocs = uniqueDocs.filter(doc => {
    const fileNameLower = (doc.file_name || '').toLowerCase();
    const isDrivingLicenseFile = fileNameLower.includes('driving_license') || fileNameLower.includes('split_driving_license');
    const docTypeLower = (doc.type || '').toLowerCase();
    const categoryLower = (doc.category || '').toLowerCase();
    return isDrivingLicenseFile && 
           docTypeLower !== 'driving_license' && 
           categoryLower !== 'driving_license';
  });

  if (drivingLicenseDocs.length > 0 || misclassifiedDocs.length > 0) {
    const docsToFix = drivingLicenseDocs.length > 0 ? drivingLicenseDocs : misclassifiedDocs;
    const latestDoc = docsToFix[0];
    
    // Fix flag if needed
    if (!candidate.driving_license_received) {
      console.log('\n❌ ISSUE IDENTIFIED:');
      console.log('   Document exists but flag is not set!');
      console.log(`   Document: ${latestDoc.file_name}`);
      console.log(`   Document type: "${latestDoc.type || latestDoc.document_type}"`);
      console.log(`   Category: "${latestDoc.category}"`);
      console.log(`   Document created_at: ${latestDoc.created_at}`);
      
      // 6. Fix the issue
      console.log('\n🔧 Step 6: Fixing the flag...');
      
      const { error: updateError } = await supabase
        .from('candidates')
        .update({
          driving_license_received: true,
          driving_license_received_at: latestDoc.created_at || new Date().toISOString()
        })
        .eq('id', candidateId);

      if (updateError) {
        console.error('❌ Error updating flag:', updateError);
      } else {
        console.log('✅ Flag updated successfully!');
      }
    } else {
      console.log('\n✅ Flag is already set correctly');
    }
    
    // Fix document categorization if misclassified
    if (latestDoc.source === 'candidate_documents') {
      const needsUpdate = 
        (latestDoc.category === 'other_documents' && latestDoc.file_name?.includes('driving_license')) ||
        (latestDoc.document_type === 'other' && latestDoc.file_name?.includes('driving_license')) ||
        misclassifiedDocs.length > 0;
      
      if (needsUpdate) {
        console.log('\n🔧 Step 7: Fixing document categorization...');
        console.log(`   Current: document_type="${latestDoc.document_type}", category="${latestDoc.category}"`);
        
        const { error: updateDocError } = await supabase
          .from('candidate_documents')
          .update({
            document_type: 'driving_license',
            category: 'driving_license'
          })
          .eq('id', latestDoc.id);
        
        if (updateDocError) {
          console.error('❌ Error updating document category:', updateDocError);
        } else {
          console.log('✅ Document category updated to "driving_license"');
        }
      }
    }
    
    // Verify
    const { data: updated } = await supabase
      .from('candidates')
      .select('driving_license_received, driving_license_received_at')
      .eq('id', candidateId)
      .single();
    
    console.log('\n✅ Final Verification:');
    console.log(`   driving_license_received: ${updated.driving_license_received}`);
    console.log(`   driving_license_received_at: ${updated.driving_license_received_at}`);
  } else {
    console.log('\n⚠️  No driving license documents found for this candidate');
  }

  // 7. Check doc_type values in database
  console.log('\n📊 Step 7: Checking all doc_type values for driving licenses...');
  const { data: allDrivingDocs } = await supabase
    .from('documents')
    .select('doc_type')
    .or('doc_type.ilike.%driving%,doc_type.ilike.%license%,file_name.ilike.%driving_license%')
    .limit(100);

  if (allDrivingDocs) {
    const docTypes = {};
    allDrivingDocs.forEach(doc => {
      const dt = doc.doc_type || 'NULL';
      docTypes[dt] = (docTypes[dt] || 0) + 1;
    });
    
    console.log('\n📋 Unique doc_type values found:');
    Object.entries(docTypes)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`   "${type}": ${count} document(s)`);
      });
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Investigation complete!');
}

investigateJavedKhan().catch(console.error);

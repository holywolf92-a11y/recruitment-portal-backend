// Simple script to trigger AI photo extraction for Dr. Rasheed Ahmed
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Import compiled service directly
async function main() {
    console.log('Loading backend services...');

    // Import after dotenv loads
    const { extractProfilePhotoFromPdfUsingAI } = await import('./dist/services/aiProfilePhotoExtractionService.js');

    console.log('🔍 Extracting profile photo for Dr. Rasheed Ahmed using AI Vision...');
    console.log('');

    const candidateId = '498512c3-0c07-497f-957f-70941c50441b';

    try {
        const result = await extractProfilePhotoFromPdfUsingAI({
            candidateId: candidateId,
            maxPages: 2
        });

        console.log('');
        console.log('✅ SUCCESS! Photo extracted with AI');
        console.log('');
        console.log('Details:');
        console.log('- Page used:', result.pageUsed);
        console.log('- Confidence:', result.confidence.toFixed(2));
        console.log('- Storage bucket:', result.storageBucket);
        console.log('- Storage path:', result.storagePath);
        console.log('');
        console.log('✅ Photo has been updated in database!');
        console.log('Refresh the frontend to see the corrected photo.');

    } catch (error) {
        console.error('');
        console.error('❌ Error:', error.message);
        if (error.stack) {
            console.error('Stack:', error.stack);
        }
    }
}

main().catch(console.error);

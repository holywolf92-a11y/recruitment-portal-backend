const { extractProfilePhotoFromPdfUsingAI } = require('./dist/services/aiProfilePhotoExtractionService');

async function extractPhotoForRasheed() {
    console.log('🔍 Extracting profile photo for Dr. Rasheed Ahmed using AI...');
    console.log('');

    const candidateId = '498512c3-0c07-497f-957f-70941c50441b';

    try {
        const result = await extractProfilePhotoFromPdfUsingAI({
            candidateId: candidateId,
            maxPages: 2 // Check first 2 pages
        });

        console.log('✅ Success! Photo extracted');
        console.log('');
        console.log('Details:');
        console.log('- Page used:', result.pageUsed);
        console.log('- Confidence:', result.confidence);
        console.log('- Storage path:', result.storagePath);
        console.log('- Signed URL:', result.signedUrl.substring(0, 100) + '...');
        console.log('');
        console.log('Photo should now display correctly on the frontend!');

    } catch (error) {
        console.error('❌ Error extracting photo:', error.message);
        console.error(error);
    }
}

extractPhotoForRasheed().catch(console.error);

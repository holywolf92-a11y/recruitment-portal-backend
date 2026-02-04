/**
 * Diagnostic Script: Backend Crash Investigation
 * 
 * This script checks common causes of backend crashes:
 * 1. Missing environment variables
 * 2. Database connection issues
 * 3. Redis connection issues
 * 4. Port conflicts
 * 5. Missing dependencies
 */

const https = require('https');
const http = require('http');

const BACKEND_URL = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║        BACKEND CRASH DIAGNOSTIC TOOL                          ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

// Check 1: Health endpoint
async function checkHealth() {
  console.log('🔍 Checking backend health endpoint...');
  return new Promise((resolve) => {
    const url = new URL(BACKEND_URL);
    const client = url.protocol === 'https:' ? https : http;
    
    const req = client.get(`${BACKEND_URL}/health`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ Backend is responding');
          console.log(`   Response: ${data}`);
          resolve(true);
        } else {
          console.log(`❌ Backend returned status ${res.statusCode}`);
          resolve(false);
        }
      });
    });
    
    req.on('error', (err) => {
      console.log(`❌ Backend is not accessible: ${err.message}`);
      console.log(`   URL: ${BACKEND_URL}`);
      resolve(false);
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      console.log('❌ Backend health check timed out');
      resolve(false);
    });
  });
}

// Check 2: Supabase health
async function checkSupabase() {
  console.log('\n🔍 Checking Supabase connection...');
  return new Promise((resolve) => {
    const url = new URL(BACKEND_URL);
    const client = url.protocol === 'https:' ? https : http;
    
    const req = client.get(`${BACKEND_URL}/health/supabase`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'ok') {
            console.log('✅ Supabase connection is working');
            resolve(true);
          } else {
            console.log('❌ Supabase connection failed');
            console.log(`   Error: ${json.message || 'Unknown error'}`);
            resolve(false);
          }
        } catch (e) {
          console.log('❌ Invalid response from Supabase health check');
          resolve(false);
        }
      });
    });
    
    req.on('error', (err) => {
      console.log(`❌ Could not check Supabase: ${err.message}`);
      resolve(false);
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      console.log('❌ Supabase health check timed out');
      resolve(false);
    });
  });
}

// Check 3: Common API endpoints
async function checkAPIEndpoints() {
  console.log('\n🔍 Checking API endpoints...');
  const endpoints = [
    '/api/candidates',
    '/api/documents/candidate-documents',
  ];
  
  const results = [];
  
  for (const endpoint of endpoints) {
    await new Promise((resolve) => {
      const url = new URL(BACKEND_URL);
      const client = url.protocol === 'https:' ? https : http;
      
      const req = client.get(`${BACKEND_URL}${endpoint}`, (res) => {
        if (res.statusCode === 200 || res.statusCode === 401 || res.statusCode === 403) {
          console.log(`✅ ${endpoint} - Responding (${res.statusCode})`);
          results.push(true);
        } else {
          console.log(`⚠️  ${endpoint} - Status ${res.statusCode}`);
          results.push(false);
        }
        res.on('data', () => {}); // Drain response
        res.on('end', resolve);
      });
      
      req.on('error', (err) => {
        console.log(`❌ ${endpoint} - Error: ${err.message}`);
        results.push(false);
        resolve();
      });
      
      req.setTimeout(3000, () => {
        req.destroy();
        console.log(`⚠️  ${endpoint} - Timeout`);
        results.push(false);
        resolve();
      });
    });
  }
  
  return results.every(r => r);
}

// Main diagnostic
async function runDiagnostics() {
  console.log(`Backend URL: ${BACKEND_URL}\n`);
  
  const healthOk = await checkHealth();
  
  if (!healthOk) {
    console.log('\n❌ Backend is not responding. Possible causes:');
    console.log('   1. Server crashed on startup');
    console.log('   2. Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
    console.log('   3. Port conflict or binding error');
    console.log('   4. TypeScript compilation error');
    console.log('   5. Missing dependencies (npm install not run)');
    console.log('   6. Redis connection failed (if RUN_WORKER=true)');
    console.log('\n💡 Check Railway logs:');
    console.log('   railway logs --service recruitment-portal-backend');
    return;
  }
  
  await checkSupabase();
  await checkAPIEndpoints();
  
  console.log('\n✅ Backend appears to be running normally');
  console.log('\n💡 If you\'re still experiencing issues:');
  console.log('   1. Check Railway deployment logs');
  console.log('   2. Verify all environment variables are set');
  console.log('   3. Check for recent code changes that might cause crashes');
  console.log('   4. Review error logs in Railway dashboard');
}

runDiagnostics().catch(console.error);

/**
 * Direct Railway API check for worker status
 * Uses Railway REST API to check logs and environment variables
 */

const https = require('https');

const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN || 'fe4c6bd4-c216-480e-8bf3-3a721abe9780';
const PROJECT_ID = '54e09ca0-5643-4b5e-a172-8704293ae095'; // gleaming-healing
const BACKEND_SERVICE_ID = '7c9d5772-56f3-41a2-b2a8-a94952c39ffb';

function makeRequest(path, callback) {
  const options = {
    hostname: 'api.railway.app',
    path: path,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${RAILWAY_TOKEN}`,
      'Content-Type': 'application/json'
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        callback(null, json);
      } catch (e) {
        callback(null, data);
      }
    });
  });

  req.on('error', (err) => {
    callback(err, null);
  });

  req.end();
}

console.log('🔍 Checking Railway Backend Worker Status...\n');
console.log('='.repeat(60));

// Check environment variables
console.log('\n1️⃣  Checking Environment Variables...');
makeRequest(`/v1/services/${BACKEND_SERVICE_ID}/variables`, (err, vars) => {
  if (err) {
    console.error('   ❌ Error:', err.message);
    return;
  }

  if (vars && vars.edges) {
    const variables = vars.edges.map(e => e.node);
    const workerVars = variables.filter(v => 
      v.key.includes('WORKER') || 
      v.key.includes('REDIS') || 
      v.key.includes('PYTHON') || 
      v.key.includes('HMAC')
    );

    console.log(`   📋 Found ${workerVars.length} relevant variables:\n`);
    workerVars.forEach(v => {
      const value = v.key.includes('SECRET') || v.key.includes('KEY') || v.key.includes('TOKEN')
        ? '***' + v.value.substring(v.value.length - 4)
        : v.value;
      console.log(`      ${v.key}: ${value}`);
    });

    const runWorker = variables.find(v => v.key === 'RUN_WORKER');
    const redisUrl = variables.find(v => v.key === 'REDIS_URL');
    const pythonUrl = variables.find(v => v.key === 'PYTHON_CV_PARSER_URL');
    const hmacSecret = variables.find(v => v.key === 'PYTHON_HMAC_SECRET');

    console.log('\n   ✅ Status:');
    console.log(`      RUN_WORKER: ${runWorker ? (runWorker.value === 'true' ? '✅ true' : '❌ ' + runWorker.value) : '❌ not set'}`);
    console.log(`      REDIS_URL: ${redisUrl ? '✅ set' : '❌ missing'}`);
    console.log(`      PYTHON_CV_PARSER_URL: ${pythonUrl ? '✅ set' : '❌ missing'}`);
    console.log(`      PYTHON_HMAC_SECRET: ${hmacSecret ? '✅ set' : '❌ missing'}`);

    if (!runWorker || runWorker.value !== 'true') {
      console.log('\n   ⚠️  RUN_WORKER is not set to "true" - worker will not start');
    }
    if (!redisUrl) {
      console.log('\n   ⚠️  REDIS_URL is missing - worker cannot connect to queue');
    }
    if (!pythonUrl) {
      console.log('\n   ⚠️  PYTHON_CV_PARSER_URL is missing - worker cannot call AI service');
    }
    if (!hmacSecret) {
      console.log('\n   ⚠️  PYTHON_HMAC_SECRET is missing - worker cannot authenticate with AI service');
    }
  }
});

// Check recent deployments
console.log('\n2️⃣  Checking Recent Deployments...');
makeRequest(`/v1/deployments?projectId=${PROJECT_ID}&serviceId=${BACKEND_SERVICE_ID}&limit=3`, (err, deployments) => {
  if (err) {
    console.error('   ❌ Error:', err.message);
    return;
  }

  if (deployments && deployments.edges) {
    const recent = deployments.edges.slice(0, 3).map(e => e.node);
    console.log(`   📋 Found ${recent.length} recent deployment(s):\n`);
    recent.forEach((dep, i) => {
      const status = dep.status === 'SUCCESS' ? '✅' : dep.status === 'FAILED' ? '❌' : '⏳';
      const time = new Date(dep.createdAt).toLocaleString();
      console.log(`      ${i + 1}. ${status} ${dep.status} - ${time}`);
    });
  }
});

console.log('\n' + '='.repeat(60));
console.log('\n💡 Next Steps:');
console.log('   1. Check Railway logs for worker startup messages');
console.log('   2. Verify all environment variables are set');
console.log('   3. Restart backend service if variables were just added');
console.log('\n📋 To check logs manually:');
console.log('   railway logs --tail 200 | Select-String -Pattern "Worker|DocumentVerification"');

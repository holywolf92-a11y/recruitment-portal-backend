/**
 * Check Railway Logs via API
 * Uses Railway REST API to fetch logs
 */

const https = require('https');

const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN || 'a0e017f6-4126-4f99-8bdc-e3911c357d82';
const PROJECT_ID = '54e09ca0-5643-4b5e-a172-8704293ae095'; // gleaming-healing
const BACKEND_SERVICE_ID = '7c9d5772-56f3-41a2-b2a8-a94952c39ffb';
const PYTHON_PARSER_SERVICE_ID = '2f85c008-6730-4731-bb41-8c3ef59f90ae';

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

console.log('Checking Railway API access...\n');

// Check projects
makeRequest('/v1/projects', (err, data) => {
  if (err) {
    console.error('Error:', err.message);
    return;
  }
  
  console.log('Projects:', JSON.stringify(data, null, 2));
  
  // Try to get deployments
  makeRequest(`/v1/deployments?projectId=${PROJECT_ID}&limit=5`, (err, deployments) => {
    if (err) {
      console.error('Error getting deployments:', err.message);
      return;
    }
    
    console.log('\nRecent Deployments:', JSON.stringify(deployments, null, 2));
  });
});

// Test if isGovernmentEmail catches the problematic email

function isGovernmentEmail(email) {
  if (!email || typeof email !== 'string') return false;
  
  const normalized = email.toLowerCase().trim();
  const patterns = [
    // Police/law enforcement patterns
    'police', 'jhelum', 'lahore', 'islamabad', 'karachi', 'faisalabad',
    'rawalpindi', 'multan', 'peshawar', 'quetta', 'gjtpolice',
    // Government/official patterns  
    'govt', 'gov.', '@gov', 'government', 'department', 'ministry',
    // Generic organizational emails that shouldn't be personal
    'admin@', 'info@', 'contact@', 'support@', 'noinformation',
  ];
  
  return patterns.some(pattern => normalized.includes(pattern));
}

const testEmails = [
  'gjtpolice@gmail.com',
  'jhelumpolice@gmail.com',
  'gitpolice@gmail.com',
  'test@gmail.com',
];

console.log('\n🧪 Testing isGovernmentEmail() function:\n');

testEmails.forEach(email => {
  const result = isGovernmentEmail(email);
  const emoji = result ? '✅ FILTERED' : '❌ NOT FILTERED';
  console.log(`${emoji}: ${email}`);
});

console.log('');

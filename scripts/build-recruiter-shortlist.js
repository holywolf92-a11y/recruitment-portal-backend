const fs = require('fs');
const path = require('path');

const OUTPUT_ROOT = path.resolve(process.env.MAILBOX_OUTPUT_DIR || path.join(__dirname, 'output', 'mailbox-export'));
const SOURCE_FILE = path.join(OUTPUT_ROOT, 'recruiter_contacts_2024_onward.csv');
const TARGET_CSV = path.join(OUTPUT_ROOT, 'recruiter_outreach_shortlist.csv');
const TARGET_MD = path.join(OUTPUT_ROOT, 'recruiter_outreach_shortlist.md');

const BUSINESS_IDENTITY_PATTERN = /(recruit|recruitment|recruiter|recruiting|manpower|staff|staffing|talent|placement|agency|employment|hr|human resources)/i;
const BUSINESS_SUBJECT_PATTERN = /(recruit|recruitment|recruiting|manpower|staff|staffing|candidate submissions|candidate inquiry|partnership|collaboration|hiring guidelines|workers needed|manpower requirement|recruitment services|employment services|business proposal)/i;
const EXCLUDE_PATTERN = /(newsletter|noreply|no-reply|mailer-daemon|mail delivery|accountprotection|webmail|helpdesk|it support|glassdoor|indeed|naukrigulf|broadwayworld|creative market|updates\.|support@thebrain|hosting\.com|docushare|docusign|admin falishamanpower|falishamanpower webmail|falishamanpower-it helpdesk|falishaoep4035@gmail\.com|candidate ready|i need a job|seeking a job|looking for a job|job required|apply for|resume|cv upload)/i;
const GENERIC_FREE_MAIL_PATTERN = /@(gmail\.com|outlook\.com|hotmail\.com|yahoo\.com)$/i;

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (inQuotes) {
      if (character === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        current += character;
      }
      continue;
    }

    if (character === ',') {
      values.push(current);
      current = '';
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function loadRows(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());
  const rows = lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });

  return { headers, rows };
}

function looksLikeRecruiter(row) {
  const identityHaystack = [row.email, row.name, row.domain].join(' | ');
  const subject = String(row.last_subject || '');
  const haystack = `${identityHaystack} | ${subject}`;

  if (EXCLUDE_PATTERN.test(haystack)) {
    return false;
  }

  if (/falisha/i.test(identityHaystack)) {
    return false;
  }

  const identityMatch = BUSINESS_IDENTITY_PATTERN.test(identityHaystack);
  const subjectMatch = BUSINESS_SUBJECT_PATTERN.test(subject);

  if (GENERIC_FREE_MAIL_PATTERN.test(row.email)) {
    return identityMatch;
  }

  return identityMatch || subjectMatch;
}

function main() {
  const { headers, rows } = loadRows(SOURCE_FILE);
  const shortlisted = rows
    .filter(looksLikeRecruiter)
    .sort((left, right) => String(right.last_contacted_at || '').localeCompare(String(left.last_contacted_at || '')));

  fs.writeFileSync(
    TARGET_CSV,
    `${headers.join(',')}\n${shortlisted.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}\n`,
    'utf8'
  );

  const markdownLines = [
    '# Recruiter Outreach Shortlist',
    '',
    `Total shortlisted contacts: ${shortlisted.length}`,
    '',
    'Top recent entries:',
    '',
    ...shortlisted.slice(0, 40).map((row, index) => `${index + 1}. ${row.email} | ${row.name || '-'} | ${row.domain} | ${row.last_contacted_at} | ${row.last_subject || '-'}`),
  ];

  fs.writeFileSync(TARGET_MD, `${markdownLines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ shortlisted: shortlisted.length, targetCsv: TARGET_CSV, targetMd: TARGET_MD }, null, 2));
}

main();
// Talent-pool normalization: collapse messy free-text CV fields into a clean,
// browsable taxonomy for the public falishamanpower.com recruiter search.
//
// The `position` field is CV-parsed free text — ~1,900 distinct strings for
// ~90 real jobs ("driver", "Driver HTV", "heavy driver" are all Drivers). These
// ordered rules map each raw string to { category, profession }. ORDER MATTERS:
// specific rules (e.g. "electrical engineer") must come before broad ones
// ("electrician", then the catch-all "worker"/"helper"). First match wins.

export interface NormalizedProfession {
  category: string;
  profession: string;
}

interface Rule {
  category: string;
  profession: string;
  re: RegExp;
}

const RULES: Rule[] = [
  // ── Engineering (match 'engineer' + specialty BEFORE the trades) ───────────
  { category: 'Engineering', profession: 'Civil Engineer', re: /civil\s*eng/i },
  { category: 'Engineering', profession: 'Electrical Engineer', re: /(electr\w*\s*eng|eng\w*\s*electr)/i },
  { category: 'Engineering', profession: 'Mechanical Engineer', re: /mechanical\s*eng/i },
  { category: 'Engineering', profession: 'Software Engineer', re: /(software\s*eng|software\s*dev)/i },
  { category: 'Engineering', profession: 'Site Engineer', re: /site\s*eng/i },
  { category: 'Engineering', profession: 'Petroleum Engineer', re: /(petroleum|reservoir|drilling)\s*eng/i },
  { category: 'Engineering', profession: 'QA/QC Engineer', re: /(qa.?qc|quality)\s*(eng|control|inspector)/i },
  { category: 'Engineering', profession: 'Surveyor', re: /surveyor|quantity\s*survey|land\s*survey/i },
  { category: 'Engineering', profession: 'Architect', re: /architect/i },
  { category: 'Engineering', profession: 'Engineer (Other)', re: /\beng(ineer|r)\b|engineering/i },

  // ── Oil & Gas / Rig ────────────────────────────────────────────────────────
  { category: 'Oil & Gas', profession: 'Floorman', re: /floor\s*man|floorman/i },
  { category: 'Oil & Gas', profession: 'Roustabout', re: /roustabout/i },
  { category: 'Oil & Gas', profession: 'Roughneck', re: /roughneck/i },
  { category: 'Oil & Gas', profession: 'Derrickman', re: /derrick/i },
  { category: 'Oil & Gas', profession: 'Driller', re: /driller|drilling|rig\s*(worker|operator)/i },

  // ── Healthcare (specific before generic) ───────────────────────────────────
  { category: 'Healthcare', profession: 'Nurse', re: /nurse|\brn\b/i },
  { category: 'Healthcare', profession: 'Physiotherapist', re: /physio|physical\s*therap/i },
  { category: 'Healthcare', profession: 'Pharmacist', re: /pharmac|dispenser/i },
  { category: 'Healthcare', profession: 'Dentist / Dental Assistant', re: /dental|dentist/i },
  { category: 'Healthcare', profession: 'Midwife', re: /midwife|midwifery/i },
  { category: 'Healthcare', profession: 'Optometrist', re: /optometr|optician/i },
  { category: 'Healthcare', profession: 'Nutritionist / Dietitian', re: /nutrition|dietit|dietician/i },
  { category: 'Healthcare', profession: 'Veterinary', re: /veterinar|\bvet\b/i },
  { category: 'Healthcare', profession: 'Doctor', re: /doctor|physician|surgeon|medical\s*officer|\bmbbs\b|general\s*practitioner|\bgp\b/i },
  { category: 'Healthcare', profession: 'Lab Technician', re: /lab\s*tech|laboratory|phlebotom/i },
  { category: 'Healthcare', profession: 'Medical Technologist', re: /anesthesia|anaesthesia|operation\s*theat|\bot\s*tech|medical\s*tech|surgical\s*tech/i },
  { category: 'Healthcare', profession: 'Caregiver', re: /caregiver|care\s*taker|caretaker|patient\s*care/i },
  { category: 'Healthcare', profession: 'Radiographer', re: /radiograph|x.?ray|radiolog/i },
  { category: 'Healthcare', profession: 'Healthcare Assistant', re: /nursing\s*assistant|health\s*?care\s*assistant|clinical\s*assistant|nurse\s*aide|patient\s*attendant/i },
  { category: 'Healthcare', profession: 'Medical / Healthcare (Other)', re: /medical|health\s*?care|clinical|\bhospital\b/i },

  // ── Safety / HSE ───────────────────────────────────────────────────────────
  { category: 'Safety / HSE', profession: 'HSE / Safety Officer', re: /\bhse\b|safety\s*(officer|engineer|supervisor|inspector)|\bsafety\b/i },

  // ── Drivers & Logistics (heavy/light before the generic Driver) ────────────
  { category: 'Drivers & Logistics', profession: 'Heavy Driver (HTV)', re: /\bhtv\b|heavy.*driv|driv.*heavy|trailer\s*driv|truck\s*driv/i },
  { category: 'Drivers & Logistics', profession: 'Light Driver (LTV)', re: /\bltv\b|light.*driv|driv.*light/i },
  { category: 'Drivers & Logistics', profession: 'Bus Driver', re: /bus\s*driv|coaster\s*driv/i },
  { category: 'Drivers & Logistics', profession: 'Forklift Operator', re: /fork\s*lift|forklift/i },
  { category: 'Drivers & Logistics', profession: 'Crane Operator', re: /crane/i },
  { category: 'Drivers & Logistics', profession: 'Heavy Equipment Operator', re: /heavy\s*equipment|excavator|dozer|\bjcb\b|loader\s*oper|shovel\s*oper|\brtg\b/i },
  { category: 'Drivers & Logistics', profession: 'Delivery Rider', re: /\brider\b|delivery\s*(boy|driver|rider)/i },
  { category: 'Drivers & Logistics', profession: 'Driver', re: /driver|chauffeur|driving/i },
  { category: 'Drivers & Logistics', profession: 'Logistics / Supply Chain', re: /logistic|supply\s*chain/i },

  // ── Construction Trades ────────────────────────────────────────────────────
  { category: 'Construction Trades', profession: 'Rigger / Steel Erector', re: /rigger|steel\s*erect|\berector\b/i },
  { category: 'Construction Trades', profession: 'Electrician', re: /electric/i },
  { category: 'Construction Trades', profession: 'Welder / Fabricator', re: /weld|fabricat/i },
  { category: 'Construction Trades', profession: 'Plumber', re: /plumb/i },
  { category: 'Construction Trades', profession: 'Mason', re: /mason|masonry|bricklay|brick\s*lay/i },
  { category: 'Construction Trades', profession: 'Carpenter', re: /carpenter|carpentry|shuttering|joiner/i },
  { category: 'Construction Trades', profession: 'Steel Fixer', re: /steel\s*fix|steelfix|rebar|rod\s*binder|rodbinder/i },
  { category: 'Construction Trades', profession: 'Painter', re: /painter|painting/i },
  { category: 'Construction Trades', profession: 'Scaffolder', re: /scaffold/i },
  { category: 'Construction Trades', profession: 'Tile Fitter', re: /\btile|tiler|tiling/i },
  { category: 'Construction Trades', profession: 'Gypsum / Plasterer', re: /gypsum|plaster/i },

  // ── Mechanical & Technical ─────────────────────────────────────────────────
  { category: 'Mechanical & Technical', profession: 'AC/HVAC Technician', re: /\bac\b|hvac|air\s*cond|refriger|\bac\s*tech/i },
  { category: 'Mechanical & Technical', profession: 'Auto Mechanic', re: /mechanic|auto\s*tech|automobile/i },
  { category: 'Mechanical & Technical', profession: 'CNC Operator', re: /\bcnc\b/i },
  { category: 'Mechanical & Technical', profession: 'Machine Operator', re: /machine\s*oper|machinist/i },
  { category: 'Mechanical & Technical', profession: 'Mechanical Technician', re: /mechanical\s*tech/i },
  { category: 'Mechanical & Technical', profession: 'Pipe Fitter / Fitter', re: /\bfitter|pipe\s*fit/i },
  { category: 'Mechanical & Technical', profession: 'Instrument Technician', re: /instrument\s*tech|instrumentation/i },
  { category: 'Mechanical & Technical', profession: 'Technician (Other)', re: /technician|\btech\b/i },
  { category: 'Mechanical & Technical', profession: 'Plant / Machine Operator', re: /\boperator\b/i },

  // ── Hospitality & Food ─────────────────────────────────────────────────────
  { category: 'Hospitality & Food', profession: 'Chef / Cook', re: /chef|\bcook\b|cooking|kitchen\s*(staff|helper)/i },
  { category: 'Hospitality & Food', profession: 'Waiter / Steward', re: /waiter|waitress|steward|server\b|f&b/i },
  { category: 'Hospitality & Food', profession: 'Baker', re: /baker|bakery|pastry/i },
  { category: 'Hospitality & Food', profession: 'Barista', re: /barista/i },
  { category: 'Hospitality & Food', profession: 'Housekeeping / Cleaner', re: /housekeep|house\s*keeping|room\s*boy|room\s*attendant|cleaner|cleaning|janitor|office\s*boy/i },
  { category: 'Hospitality & Food', profession: 'Hospitality Staff', re: /hospitality/i },

  // ── Beauty & Wellness ──────────────────────────────────────────────────────
  { category: 'Beauty & Wellness', profession: 'Beautician / Barber', re: /beautician|beauty|barber|hairdress|\bsalon\b|makeup|cosmetolog/i },

  // ── Creative & Marketing ───────────────────────────────────────────────────
  { category: 'Creative & Marketing', profession: 'Graphic / Web Designer', re: /graphic\s*design|web\s*design|\bdesigner\b/i },
  { category: 'Creative & Marketing', profession: 'Marketing Specialist', re: /digital\s*market|marketing|\bseo\b|social\s*media/i },

  // ── Office, Admin & Sales ──────────────────────────────────────────────────
  { category: 'Office & Admin', profession: 'Accountant / Finance', re: /account|\bfinance\b|financial|\baudit|\bteller\b/i },
  { category: 'Office & Admin', profession: 'Document Controller', re: /document\s*control/i },
  { category: 'Office & Admin', profession: 'Data Entry Operator', re: /data\s*entry/i },
  { category: 'Office & Admin', profession: 'Computer Operator', re: /computer\s*oper/i },
  { category: 'Office & Admin', profession: 'Customer Service', re: /customer\s*(service|support|care|relation)|call\s*cent|\bcsr\b/i },
  { category: 'Office & Admin', profession: 'Procurement / Buyer', re: /procurement|purchasing|\bbuyer\b/i },
  { category: 'Office & Admin', profession: 'HR Officer', re: /human\s*resource|\bhr\b|recruit/i },
  { category: 'Office & Admin', profession: 'Receptionist', re: /reception/i },
  { category: 'Office & Admin', profession: 'Secretary', re: /secretary/i },
  { category: 'Office & Admin', profession: 'Timekeeper', re: /time\s*keep/i },
  { category: 'Office & Admin', profession: 'Storekeeper', re: /store\s*keep|storekeeper|store\s*man|inventory/i },
  { category: 'Office & Admin', profession: 'Administrator / Assistant', re: /administrat|\badmin\b|executive\s*assistant|virtual\s*assistant|personal\s*assistant|office\s*assistant/i },
  { category: 'Sales & Retail', profession: 'Sales / Cashier', re: /sales|salesman|cashier|merchandiser|retail|shop\s*keep|shopkeeper/i },
  { category: 'Office & Admin', profession: 'Manager / Supervisor', re: /manager|supervisor|coordinator|foreman|team\s*lead|managing\s*director|\bceo\b|chief\s*executive|\bdirector\b|business\s*development|general\s*manager/i },

  // ── IT & Data ──────────────────────────────────────────────────────────────
  { category: 'IT', profession: 'IT / Developer', re: /\bit\b|software|developer|programmer|network\s*(eng|admin)|system\s*admin|\bweb\b/i },
  { category: 'IT', profession: 'Data Analyst', re: /data\s*(analyst|scien)|business\s*analyst|\banalyst\b/i },

  // ── Education ──────────────────────────────────────────────────────────────
  { category: 'Education', profession: 'Teacher / Lecturer', re: /teacher|lecturer|instructor|tutor|professor|faculty|educator|teaching/i },
  { category: 'Education', profession: 'Research Assistant', re: /research/i },

  // ── Security ───────────────────────────────────────────────────────────────
  { category: 'Security', profession: 'Security Guard', re: /security|\bguard\b|watchman/i },

  // ── Domestic ───────────────────────────────────────────────────────────────
  { category: 'Domestic', profession: 'Domestic Helper', re: /domestic|house\s*maid|housemaid|\bmaid\b|nanny|babysitter/i },

  // ── Textile & Garment ──────────────────────────────────────────────────────
  { category: 'Textile & Garment', profession: 'Tailor', re: /tailor|sewing|stitch/i },
  { category: 'Textile & Garment', profession: 'Garment Worker', re: /garment|textile|knitting/i },

  // ── Agriculture ────────────────────────────────────────────────────────────
  { category: 'Agriculture', profession: 'Agronomist / Farm Worker', re: /agronom|agricultur|\bfarm\b|horticultur/i },

  // ── Warehouse & Labour (broadest — keep LAST) ──────────────────────────────
  { category: 'Warehouse & Labour', profession: 'Warehouse Worker', re: /warehouse|picker|packer|packing|loader\b/i },
  { category: 'Warehouse & Labour', profession: 'Construction Worker', re: /construction/i },
  { category: 'Warehouse & Labour', profession: 'General Labourer / Helper', re: /labou?r|helper|general\s*work|\bworker\b|operative/i },
];

const TITLE = (s: string) =>
  s.replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);

export function normalizeProfession(raw: string | null | undefined): NormalizedProfession {
  const s = String(raw || '').trim();
  if (!s) return { category: 'Unspecified', profession: 'Not specified' };
  for (const rule of RULES) {
    if (rule.re.test(s)) return { category: rule.category, profession: rule.profession };
  }
  // Long tail: keep the (cleaned) raw title so it's still browsable, bucket as Other.
  return { category: 'Other', profession: TITLE(s) || 'Other' };
}

// ── Nationality: collapse Pakistan/Pakistani/PAKISTANI + strip parser garbage ──
export function normalizeNationality(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === '�' || /[�]/.test(s) || /^(unknown|not detected|n\/?a|null|none|-)$/.test(s)) return null;
  if (/pakistan/.test(s)) return 'Pakistan';
  if (/indian?|india/.test(s)) return 'India';
  if (/bangladesh/.test(s)) return 'Bangladesh';
  if (/nepal/.test(s)) return 'Nepal';
  if (/sri\s*lanka|srilanka/.test(s)) return 'Sri Lanka';
  if (/philippin|filipin/.test(s)) return 'Philippines';
  if (/kenya/.test(s)) return 'Kenya';
  if (/afghan/.test(s)) return 'Afghanistan';
  return TITLE(s);
}

// ── Country of interest: collapse UAE / United Arab Emirates, KSA / Saudi, etc. ─
export function normalizeCountry(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === '�' || /[�]/.test(s) || /^(missing|unknown|not detected|n\/?a|null|none|-)$/.test(s)) return null;
  if (/u\.?a\.?e|united\s*arab|dubai|abu\s*dhabi|emirat/.test(s)) return 'UAE';
  if (/saudi|k\.?s\.?a|riyadh|jeddah|dammam/.test(s)) return 'Saudi Arabia';
  if (/qatar|doha/.test(s)) return 'Qatar';
  if (/kuwait/.test(s)) return 'Kuwait';
  if (/oman|muscat/.test(s)) return 'Oman';
  if (/bahrain/.test(s)) return 'Bahrain';
  if (/turk|t[uü]rki/.test(s)) return 'Türkiye';
  if (/romania/.test(s)) return 'Romania';
  if (/poland/.test(s)) return 'Poland';
  if (/germany/.test(s)) return 'Germany';
  if (/kosovo/.test(s)) return 'Kosovo';
  if (/malaysia/.test(s)) return 'Malaysia';
  return TITLE(s);
}

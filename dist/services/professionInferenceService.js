"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferProfessionFromCvData = inferProfessionFromCvData;
exports.inferProfessionFromExperienceCertificate = inferProfessionFromExperienceCertificate;
const documentCategories_1 = require("../config/documentCategories");
const INVALID_VALUES = new Set([
    '',
    'missing',
    'null',
    'undefined',
    'n/a',
    'na',
    'none',
    'not provided',
    'unknown',
]);
const PROFESSION_RULES = [
    {
        role: 'Domestic Helper',
        keywords: ['domestic helper', 'housemaid', 'house maid', 'house help', 'household', 'cleaning', 'housekeeping', 'babysitting', 'childcare'],
    },
    {
        role: 'Housekeeper',
        keywords: ['housekeeper', 'housekeeping', 'cleaner', 'cleaning & housekeeping'],
    },
    {
        role: 'Caregiver',
        keywords: ['caregiver', 'care giving', 'elderly care', 'home care', 'patient care'],
    },
    {
        role: 'Nanny / Babysitter',
        keywords: ['nanny', 'babysitter', 'babysitting', 'childcare', 'child care'],
    },
    {
        role: 'Driver',
        keywords: ['driver', 'driving', 'chauffeur'],
    },
    {
        role: 'Cook / Kitchen Helper',
        keywords: ['cook', 'cooking', 'chef', 'kitchen helper', 'meal preparation', 'kitchen'],
    },
    {
        role: 'Security Guard',
        keywords: ['security guard', 'security', 'guard', 'patrol'],
    },
    {
        role: 'Electrician',
        keywords: ['electrician', 'electrical'],
    },
    {
        role: 'Plumber',
        keywords: ['plumber', 'plumbing'],
    },
    {
        role: 'Carpenter',
        keywords: ['carpenter', 'carpentry'],
    },
    {
        role: 'Welder',
        keywords: ['welder', 'welding'],
    },
    {
        role: 'Mason',
        keywords: ['mason', 'masonry', 'bricklayer', 'brick laying'],
    },
    {
        role: 'Painter',
        keywords: ['painter', 'painting'],
    },
    {
        role: 'Mechanic',
        keywords: ['mechanic', 'automotive'],
    },
    {
        role: 'Construction Worker',
        keywords: ['construction', 'builder', 'site worker', 'construction worker'],
    },
];
function hasMeaningfulText(value) {
    if (typeof value !== 'string')
        return false;
    const normalized = value.trim().toLowerCase();
    return !INVALID_VALUES.has(normalized);
}
function normalizeTextList(value) {
    if (!value)
        return [];
    if (Array.isArray(value)) {
        return value
            .map((entry) => {
            if (typeof entry === 'string')
                return entry;
            if (entry && typeof entry === 'object') {
                return entry.title || entry.job_title || entry.position || entry.name || entry.description || '';
            }
            return String(entry);
        })
            .map((entry) => String(entry).trim())
            .filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(/\r?\n|,|;|\||\u2022|•/)
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    return [String(value).trim()].filter(Boolean);
}
function cleanProfessionLabel(value) {
    return value
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^[-:]+/, '')
        .replace(/\b(missing|null|undefined|not provided)\b/gi, '')
        .trim();
}
function extractExperienceTitles(experience) {
    if (!Array.isArray(experience))
        return [];
    return experience
        .map((entry) => entry?.job_title || entry?.title || entry?.position || '')
        .map((entry) => (typeof entry === 'string' ? cleanProfessionLabel(entry) : ''))
        .filter(Boolean);
}
function inferProfessionFromCvData(parsedCandidate) {
    const explicitCandidates = [
        parsedCandidate?.position,
        parsedCandidate?.target_role,
        parsedCandidate?.current_position,
        parsedCandidate?.desired_position,
        extractExperienceTitles(parsedCandidate?.experience)[0],
    ]
        .filter(hasMeaningfulText)
        .map(cleanProfessionLabel)
        .filter(Boolean);
    if (explicitCandidates.length > 0) {
        return explicitCandidates[0];
    }
    const skills = normalizeTextList(parsedCandidate?.skills);
    const experienceTitles = extractExperienceTitles(parsedCandidate?.experience);
    const experienceDescriptions = Array.isArray(parsedCandidate?.experience)
        ? parsedCandidate.experience
            .map((entry) => [entry?.description, ...(Array.isArray(entry?.responsibilities) ? entry.responsibilities : [])].filter(Boolean).join(' '))
            .filter(Boolean)
        : [];
    const corpus = [
        ...skills,
        ...experienceTitles,
        ...experienceDescriptions,
        ...normalizeTextList(parsedCandidate?.previous_employment),
        ...normalizeTextList(parsedCandidate?.professional_summary || parsedCandidate?.summary),
    ].join(' ').toLowerCase();
    let bestMatch;
    let bestScore = 0;
    for (const rule of PROFESSION_RULES) {
        const score = rule.keywords.reduce((total, keyword) => total + (corpus.includes(keyword) ? 1 : 0), 0);
        if (score > bestScore) {
            bestMatch = rule.role;
            bestScore = score;
        }
    }
    return bestScore > 0 ? bestMatch : undefined;
}
function inferProfessionFromExperienceCertificate(fileName, category) {
    if (category && category !== documentCategories_1.DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES) {
        return undefined;
    }
    const name = (fileName || '').toLowerCase();
    if (!name.trim())
        return undefined;
    let bestMatch;
    let bestScore = 0;
    for (const rule of PROFESSION_RULES) {
        const score = rule.keywords.reduce((total, keyword) => total + (name.includes(keyword) ? 1 : 0), 0);
        if (score > bestScore) {
            bestMatch = rule.role;
            bestScore = score;
        }
    }
    return bestScore > 0 ? bestMatch : undefined;
}

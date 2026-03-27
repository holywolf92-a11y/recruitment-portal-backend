import dotenv from 'dotenv';
dotenv.config();

const { enrichCandidateData, updateMissingFields } = await import('../dist/services/progressiveDataCompletionService.js');

const candidateId = '713b6428-42e9-432c-bcb4-1170d6aab316';
const attachmentId = '306ffa8f-3b18-48c1-b7f0-e04e6961f4e9';

const combinedData = {
  name: 'SOHAIL RASHEED MUGHAL',
  email: 'solimonan789@gmail.com',
  phone: null,
  nationality: 'Pakistani',
  father_name: 'Abdul Rasheed Mughal',
  cnic: '61101-2001783-9',
  passport: null,
  date_of_birth: null,
  marital_status: 'Married',
  position: 'Security Officer',
  experience_years: null,
  skills: ['Computer Troubleshoot and Installation', "Installation of software's (Windows XP, Windows Seven, and other software)", 'Conflict Resolution', 'First Aid', 'Security conscious'],
  languages: [],
  education: [
    { degree: 'BA', institution: null, graduation_date: null },
    { degree: 'F.A', institution: 'Federal Board', graduation_date: null },
    { degree: 'MATRIC', institution: 'Federal Board', graduation_date: null }
  ],
  certifications: null,
  internships: null,
  previous_employment: '2 years as Billing Assistant and FDO Supervisor at Salma and Afeel Medical Center; 2 years as Computer Operator at Aviation Army Public School; 4 years as Salesman Cashier at ABC Computers; 2 years as Store Incharge at Malik Autos Pakistan; 8 years hardware/software installation',
  passport_expiry: null,
  professional_summary: 'Energetic hardworking security officer with proven track record of safeguarding property and assets against theft, fire, flood and vandalism.',
  address: '215/L Askri Street Kamalabad Rawalpindi',
};

const result = await enrichCandidateData(candidateId, combinedData, 'cv', attachmentId, 'cv');
console.log('Updated fields:', result.updated);
console.log('Skipped fields:', result.skipped);

await updateMissingFields(candidateId);
console.log('Done - missing_fields recalculated');

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationErrors = void 0;
exports.validateEmail = validateEmail;
exports.validateCNIC = validateCNIC;
exports.validatePassport = validatePassport;
exports.validatePhone = validatePhone;
exports.validateDateOfBirth = validateDateOfBirth;
exports.validateName = validateName;
exports.validateGender = validateGender;
exports.validateMaritalStatus = validateMaritalStatus;
exports.validateAddress = validateAddress;
exports.validateCandidateData = validateCandidateData;
exports.validateCandidate = validateCandidate;
// Email validation pattern
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// CNIC validation - 13 digits
const CNIC_REGEX = /^\d{13}$/;
// Passport validation - alphanumeric, 2-9 chars
const PASSPORT_REGEX = /^[A-Z0-9]{2,9}$/;
// Phone validation - should be 10+ digits
const PHONE_REGEX = /^\d{10,}$/;
// Date of birth validation - YYYY-MM-DD format
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
class ValidationErrors extends Error {
    constructor(errors) {
        super('Validation failed');
        this.errors = errors;
        this.name = 'ValidationError';
    }
}
exports.ValidationErrors = ValidationErrors;
function validateEmail(email) {
    if (!email || email.trim().length === 0) {
        return { field: 'email', message: 'Email cannot be empty' };
    }
    if (!EMAIL_REGEX.test(email)) {
        return { field: 'email', message: 'Invalid email format' };
    }
    if (email.length > 255) {
        return { field: 'email', message: 'Email is too long (max 255 characters)' };
    }
    return null;
}
function validateCNIC(cnic) {
    if (!cnic || cnic.trim().length === 0) {
        return null; // CNIC is optional
    }
    const digitsOnly = cnic.replace(/\D/g, '');
    if (!CNIC_REGEX.test(digitsOnly)) {
        return { field: 'cnic', message: 'CNIC must be exactly 13 digits' };
    }
    return null;
}
function validatePassport(passport) {
    if (!passport || passport.trim().length === 0) {
        return null; // Passport is optional
    }
    const normalized = passport.trim().toUpperCase();
    if (!PASSPORT_REGEX.test(normalized)) {
        return { field: 'passport', message: 'Passport must be 2-9 alphanumeric characters' };
    }
    return null;
}
function validatePhone(phone) {
    if (!phone || phone.trim().length === 0) {
        return null; // Phone is optional
    }
    const digitsOnly = phone.replace(/\D/g, '');
    if (!PHONE_REGEX.test(digitsOnly)) {
        return { field: 'phone', message: 'Phone number must contain at least 10 digits' };
    }
    if (digitsOnly.length > 15) {
        return { field: 'phone', message: 'Phone number is too long (max 15 digits)' };
    }
    return null;
}
function validateDateOfBirth(dateStr) {
    if (!dateStr || dateStr.trim().length === 0) {
        return null; // Date of birth is optional
    }
    if (!DATE_REGEX.test(dateStr)) {
        return { field: 'date_of_birth', message: 'Date of birth must be in YYYY-MM-DD format' };
    }
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
        return { field: 'date_of_birth', message: 'Invalid date of birth' };
    }
    // Check if date is not in future
    if (date > new Date()) {
        return { field: 'date_of_birth', message: 'Date of birth cannot be in the future' };
    }
    // Check if person is at least 16 years old
    const age = new Date().getFullYear() - date.getFullYear();
    if (age < 16) {
        return { field: 'date_of_birth', message: 'Candidate must be at least 16 years old' };
    }
    return null;
}
function validateName(name) {
    if (!name || name.trim().length === 0) {
        return { field: 'name', message: 'Name is required' };
    }
    if (name.length > 255) {
        return { field: 'name', message: 'Name is too long (max 255 characters)' };
    }
    if (name.length < 2) {
        return { field: 'name', message: 'Name must be at least 2 characters' };
    }
    return null;
}
function validateGender(gender) {
    if (!gender || gender.trim().length === 0) {
        return null; // Gender is optional
    }
    const validGenders = ['Male', 'Female', 'Other'];
    if (!validGenders.includes(gender)) {
        return { field: 'gender', message: `Gender must be one of: ${validGenders.join(', ')}` };
    }
    return null;
}
function validateMaritalStatus(status) {
    if (!status || status.trim().length === 0) {
        return null; // Marital status is optional
    }
    const validStatuses = ['Single', 'Married', 'Divorced', 'Widowed'];
    if (!validStatuses.includes(status)) {
        return { field: 'marital_status', message: `Marital status must be one of: ${validStatuses.join(', ')}` };
    }
    return null;
}
function validateAddress(address) {
    if (!address || address.trim().length === 0) {
        return null; // Address is optional
    }
    if (address.length > 500) {
        return { field: 'address', message: 'Address is too long (max 500 characters)' };
    }
    return null;
}
function validateCandidateData(data) {
    const errors = [];
    // Required field validation
    if (data.name !== undefined) {
        const nameError = validateName(data.name);
        if (nameError)
            errors.push(nameError);
    }
    // Optional field validation
    if (data.email !== undefined) {
        const emailError = validateEmail(data.email);
        if (emailError)
            errors.push(emailError);
    }
    if (data.cnic !== undefined) {
        const cnicError = validateCNIC(data.cnic);
        if (cnicError)
            errors.push(cnicError);
    }
    if (data.passport !== undefined) {
        const passportError = validatePassport(data.passport);
        if (passportError)
            errors.push(passportError);
    }
    if (data.phone !== undefined) {
        const phoneError = validatePhone(data.phone);
        if (phoneError)
            errors.push(phoneError);
    }
    if (data.date_of_birth !== undefined) {
        const dobError = validateDateOfBirth(data.date_of_birth);
        if (dobError)
            errors.push(dobError);
    }
    if (data.gender !== undefined) {
        const genderError = validateGender(data.gender);
        if (genderError)
            errors.push(genderError);
    }
    if (data.marital_status !== undefined) {
        const statusError = validateMaritalStatus(data.marital_status);
        if (statusError)
            errors.push(statusError);
    }
    if (data.address !== undefined) {
        const addressError = validateAddress(data.address);
        if (addressError)
            errors.push(addressError);
    }
    return errors;
}
/**
 * Express middleware for validating candidate data
 */
function validateCandidate(req, res, next) {
    const errors = validateCandidateData(req.body);
    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors
        });
    }
    next();
}

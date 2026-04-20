"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const publicPortalService_1 = require("../services/publicPortalService");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
router.post('/candidate', upload.single('cv'), async (req, res) => {
    try {
        const result = await (0, publicPortalService_1.submitCandidatePublicIntake)({
            fullName: String(req.body.fullName || '').trim(),
            email: String(req.body.email || '').trim(),
            phone: String(req.body.phone || '').trim(),
            nationality: String(req.body.nationality || '').trim() || undefined,
            currentLocation: String(req.body.currentLocation || '').trim() || undefined,
            countryOfInterest: String(req.body.countryOfInterest || '').trim() || undefined,
            position: String(req.body.position || '').trim() || undefined,
            experience: String(req.body.experience || '').trim() || undefined,
            skills: String(req.body.skills || '').trim() || undefined,
            languages: String(req.body.languages || '').trim() || undefined,
            additionalInfo: String(req.body.additionalInfo || '').trim() || undefined,
            comments: String(req.body.comments || '').trim() || undefined,
        }, req.file);
        return res.json({ success: true, ...result });
    }
    catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to submit candidate form' });
    }
});
router.post('/employer', async (req, res) => {
    try {
        const result = await (0, publicPortalService_1.submitEmployerPublicIntake)({
            companyName: String(req.body.companyName || '').trim(),
            contactName: String(req.body.contactName || '').trim(),
            email: String(req.body.email || '').trim(),
            phone: String(req.body.phone || '').trim(),
            country: String(req.body.country || '').trim() || undefined,
            city: String(req.body.city || '').trim() || undefined,
            professions: String(req.body.professions || '').trim() || undefined,
            quantity: String(req.body.quantity || '').trim() || undefined,
            salaryRange: String(req.body.salaryRange || '').trim() || undefined,
            dutyHours: String(req.body.dutyHours || '').trim() || undefined,
            contractDuration: String(req.body.contractDuration || '').trim() || undefined,
            benefitsIncluded: String(req.body.benefitsIncluded || '').trim() || undefined,
            comments: String(req.body.comments || '').trim() || undefined,
        });
        return res.json({ success: true, ...result });
    }
    catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to submit employer form' });
    }
});
router.post('/partner', async (req, res) => {
    try {
        const result = await (0, publicPortalService_1.submitPartnerPublicIntake)({
            applicantName: String(req.body.applicantName || '').trim(),
            email: String(req.body.email || '').trim(),
            phone: String(req.body.phone || '').trim(),
            companyName: String(req.body.companyName || '').trim() || undefined,
            cityCountry: String(req.body.cityCountry || '').trim() || undefined,
            district: String(req.body.district || '').trim() || undefined,
            cnic: String(req.body.cnic || '').trim() || undefined,
            partnerType: String(req.body.partnerType || '').trim() || undefined,
        });
        return res.json({ success: true, ...result });
    }
    catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to submit partner form' });
    }
});
exports.default = router;

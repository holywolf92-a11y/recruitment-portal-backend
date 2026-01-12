"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
// import { authenticate } from '../middleware/auth';
const documentController_1 = require("../controllers/documentController");
const router = (0, express_1.Router)();
// Configure multer for memory storage
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
    },
    fileFilter: (req, file, cb) => {
        // Allow common document types
        const allowedMimeTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/png',
            'image/jpg',
            'text/plain',
        ];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, PNG, and TXT files are allowed.'));
        }
    },
});
// All routes require authentication
// router.use(authenticate);
// Upload document
router.post('/', upload.single('file'), documentController_1.uploadDocumentController);
// Get document metadata
router.get('/:id', documentController_1.getDocumentController);
// List all documents for a candidate
router.get('/candidate/:candidateId', documentController_1.listCandidateDocumentsController);
// Get signed URL for document download
router.get('/:id/download', documentController_1.getDocumentSignedUrlController);
// Delete document
router.delete('/:id', documentController_1.deleteDocumentController);
exports.default = router;

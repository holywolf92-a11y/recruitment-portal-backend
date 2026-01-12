"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
// import { authenticate } from '../middleware/auth';
const communicationController_1 = require("../controllers/communicationController");
const router = (0, express_1.Router)();
// All routes require authentication
// router.use(authenticate);
// Create template
router.post('/', communicationController_1.createTemplateController);
// List templates
router.get('/', communicationController_1.listTemplatesController);
// Get template
router.get('/:id', communicationController_1.getTemplateController);
// Update template
router.put('/:id', communicationController_1.updateTemplateController);
// Delete template
router.delete('/:id', communicationController_1.deleteTemplateController);
// Send message using template
router.post('/:templateId/send/:candidateId', communicationController_1.sendTemplateMessageController);
exports.default = router;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTemplateController = createTemplateController;
exports.getTemplateController = getTemplateController;
exports.listTemplatesController = listTemplatesController;
exports.updateTemplateController = updateTemplateController;
exports.deleteTemplateController = deleteTemplateController;
exports.sendTemplateMessageController = sendTemplateMessageController;
const communicationService_1 = require("../services/communicationService");
async function createTemplateController(req, res) {
    try {
        const userId = 'test-user-id';
        const templateData = req.body;
        const template = await (0, communicationService_1.createTemplate)(templateData, userId);
        res.status(201).json({ template });
    }
    catch (error) {
        console.error('Error creating template:', error);
        if (error.message?.includes('already exists')) {
            res.status(409).json({ error: error.message });
        }
        else {
            res.status(400).json({ error: error.message || 'Failed to create template' });
        }
    }
}
async function getTemplateController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Template ID is required' });
        }
        const template = await (0, communicationService_1.getTemplateById)(id, userId);
        res.json({ template });
    }
    catch (error) {
        console.error('Error fetching template:', error);
        if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Template not found' });
        }
        else {
            res.status(500).json({ error: 'Failed to fetch template' });
        }
    }
}
async function listTemplatesController(req, res) {
    try {
        const userId = 'test-user-id';
        const filters = {
            search: req.query.search,
            channel: req.query.channel,
            limit: req.query.limit ? parseInt(req.query.limit) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset) : undefined,
        };
        const result = await (0, communicationService_1.listTemplates)(filters, userId);
        res.json(result);
    }
    catch (error) {
        console.error('Error listing templates:', error);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
}
async function updateTemplateController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Template ID is required' });
        }
        const updateData = req.body;
        const template = await (0, communicationService_1.updateTemplate)(id, updateData, userId);
        res.json({ template });
    }
    catch (error) {
        console.error('Error updating template:', error);
        if (error.message?.includes('already exists')) {
            res.status(409).json({ error: error.message });
        }
        else if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Template not found' });
        }
        else {
            res.status(400).json({ error: error.message || 'Failed to update template' });
        }
    }
}
async function deleteTemplateController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Template ID is required' });
        }
        await (0, communicationService_1.deleteTemplate)(id, userId);
        res.json({ message: 'Template deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting template:', error);
        if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Template not found' });
        }
        else {
            res.status(500).json({ error: 'Failed to delete template' });
        }
    }
}
async function sendTemplateMessageController(req, res) {
    try {
        const userId = 'test-user-id';
        const { templateId, candidateId } = req.params;
        const { variables } = req.body;
        if (!templateId) {
            return res.status(400).json({ error: 'Template ID is required' });
        }
        if (!candidateId) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const result = await (0, communicationService_1.sendTemplateMessage)(templateId, candidateId, variables || {}, userId);
        res.json(result);
    }
    catch (error) {
        console.error('Error sending message:', error);
        if (error.message?.includes('not found')) {
            res.status(404).json({ error: error.message });
        }
        else {
            res.status(500).json({ error: error.message || 'Failed to send message' });
        }
    }
}

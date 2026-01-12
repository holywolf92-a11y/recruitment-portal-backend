"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
// import { authenticate } from '../middleware/auth';
const employerController_1 = require("../controllers/employerController");
const router = (0, express_1.Router)();
// All routes require authentication
// router.use(authenticate);
// Create employer
router.post('/', employerController_1.createEmployerController);
// List employers with optional filters
router.get('/', employerController_1.listEmployersController);
// Get single employer
router.get('/:id', employerController_1.getEmployerController);
// Update employer
router.put('/:id', employerController_1.updateEmployerController);
// Delete employer
router.delete('/:id', employerController_1.deleteEmployerController);
exports.default = router;

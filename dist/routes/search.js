"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
// import { authenticate } from '../middleware/auth';
const searchController_1 = require("../controllers/searchController");
const router = (0, express_1.Router)();
// All routes require authentication
// router.use(authenticate);
// Advanced search
router.post('/advanced', searchController_1.advancedSearchController);
// Search suggestions
router.get('/suggestions', searchController_1.searchSuggestionsController);
exports.default = router;

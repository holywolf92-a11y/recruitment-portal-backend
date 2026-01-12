"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.advancedSearchController = advancedSearchController;
exports.searchSuggestionsController = searchSuggestionsController;
const searchService_1 = require("../services/searchService");
async function advancedSearchController(req, res) {
    try {
        const userId = 'test-user-id';
        const params = {
            query: req.query.q,
            filters: req.body.filters,
            sort: req.body.sort,
            limit: req.query.limit ? parseInt(req.query.limit) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset) : undefined,
        };
        const result = await (0, searchService_1.advancedCandidateSearch)(params, userId);
        res.json(result);
    }
    catch (error) {
        console.error('Error in advanced search:', error);
        res.status(500).json({ error: 'Search failed' });
    }
}
async function searchSuggestionsController(req, res) {
    try {
        const userId = 'test-user-id';
        const query = req.query.q;
        if (!query || query.length < 2) {
            return res.json({ suggestions: [] });
        }
        const suggestions = await (0, searchService_1.getSearchSuggestions)(query, userId);
        res.json({ suggestions });
    }
    catch (error) {
        console.error('Error getting suggestions:', error);
        res.status(500).json({ error: 'Failed to get suggestions' });
    }
}

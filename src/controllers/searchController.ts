import { Request, Response } from 'express';
import { advancedCandidateSearch, getSearchSuggestions, AdvancedSearchParams } from '../services/searchService';

export async function advancedSearchController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';

    const params: AdvancedSearchParams = {
      query: req.query.q as string,
      filters: req.body.filters,
      sort: req.body.sort,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    };

    const result = await advancedCandidateSearch(params, userId);
    res.json(result);
  } catch (error: any) {
    console.error('Error in advanced search:', error);
    res.status(500).json({ error: 'Search failed' });
  }
}

export async function searchSuggestionsController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const query = req.query.q as string;

    if (!query || query.length < 2) {
      return res.json({ suggestions: [] });
    }

    const suggestions = await getSearchSuggestions(query, userId);
    res.json({ suggestions });
  } catch (error: any) {
    console.error('Error getting suggestions:', error);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
}

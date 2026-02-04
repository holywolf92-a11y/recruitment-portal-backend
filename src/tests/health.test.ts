import request from 'supertest';
import express from 'express';

describe('Health Check', () => {
    let app: express.Application;

    beforeAll(() => {
        app = express();
        app.get('/health', (req, res) => res.json({ status: 'ok' }));
    });

    it('should return 200 OK', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok' });
    });
});

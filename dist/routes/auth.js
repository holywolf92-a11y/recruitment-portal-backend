"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const userService_1 = require("../services/userService");
const router = (0, express_1.Router)();
router.get('/me', auth_1.authenticate, async (req, res) => {
    const user = req.user;
    if (!user)
        return res.status(401).json({ error: 'Unauthorized' });
    const profile = await (0, userService_1.getUserProfile)(user.id);
    res.json({ user: profile });
});
exports.default = router;

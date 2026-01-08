import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getUserProfile } from '../services/userService';

const router = Router();

router.get('/me', authenticate, async (req: AuthRequest, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const profile = await getUserProfile(user.id);
  res.json({ user: profile });
});

export default router;

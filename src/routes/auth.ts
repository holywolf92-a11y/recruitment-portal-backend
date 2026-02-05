import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getUserProfile } from '../services/userService';
import { supabaseAdminClient } from '../config/database';

const router = Router();

router.get('/me', authenticate, async (req: AuthRequest, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const profile = await getUserProfile(user.id);
  res.json({ user: profile });
});

// Register/Create employee account
router.post('/register-employee', async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const supabase = supabaseAdminClient();

    // Create user in Supabase with employee role
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        firstName,
        lastName,
        phone,
        role: 'employee'
      }
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Return created user info
    res.status(201).json({
      message: 'Employee account created successfully',
      user: {
        id: data.user.id,
        email: data.user.email,
        role: 'employee'
      }
    });
  } catch (error: any) {
    console.error('Error creating employee account:', error);
    res.status(500).json({ error: 'Failed to create employee account' });
  }
});

// Seed demo employee accounts
router.post('/seed-demo-employees', async (req, res) => {
  try {
    const demoEmployees = [
      {
        email: 'employee1@falisha.com',
        password: 'employee123',
        firstName: 'Ahmed',
        lastName: 'Khan',
        phone: '+971501234567'
      },
      {
        email: 'employee2@falisha.com',
        password: 'employee123',
        firstName: 'Fatima',
        lastName: 'Ali',
        phone: '+971502345678'
      },
      {
        email: 'employee3@falisha.com',
        password: 'employee123',
        firstName: 'Mohammad',
        lastName: 'Hassan',
        phone: '+971503456789'
      }
    ];

    const supabase = supabaseAdminClient();
    const results = [];

    for (const employee of demoEmployees) {
      try {
        const { data, error } = await supabase.auth.admin.createUser({
          email: employee.email,
          password: employee.password,
          email_confirm: true,
          user_metadata: {
            firstName: employee.firstName,
            lastName: employee.lastName,
            phone: employee.phone,
            role: 'employee'
          }
        });

        if (error) {
          results.push({
            email: employee.email,
            success: false,
            message: error.message
          });
        } else {
          results.push({
            email: employee.email,
            success: true,
            userId: data.user.id
          });
        }
      } catch (err: any) {
        results.push({
          email: employee.email,
          success: false,
          message: err.message
        });
      }
    }

    res.json({ message: 'Demo employees seeding complete', results });
  } catch (error: any) {
    console.error('Error seeding demo employees:', error);
    res.status(500).json({ error: 'Failed to seed demo employees' });
  }
});

// Change employee password (admin only)
router.post('/change-employee-password', authenticate, async (req: AuthRequest, res) => {
  try {
    const { employeeId, newPassword } = req.body;

    if (!employeeId || !newPassword) {
      return res.status(400).json({ error: 'Employee ID and new password are required' });
    }

    // Verify requester is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can change employee passwords' });
    }

    const supabase = supabaseAdminClient();

    // Update user password via admin API
    const { error } = await supabase.auth.admin.updateUserById(employeeId, {
      password: newPassword
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Employee password updated successfully'
    });
  } catch (error: any) {
    console.error('Error changing employee password:', error);
    res.status(500).json({ error: 'Failed to change employee password' });
  }
});

// Delete employee account (admin only)
router.post('/delete-employee', authenticate, async (req: AuthRequest, res) => {
  try {
    const { employeeId } = req.body;

    if (!employeeId) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    // Verify requester is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete employees' });
    }

    const supabase = supabaseAdminClient();

    // Delete user via admin API
    const { error } = await supabase.auth.admin.deleteUser(employeeId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Employee account deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

// Get all employees (admin only)
router.get('/employees', authenticate, async (req: AuthRequest, res) => {
  try {
    // Verify requester is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can view all employees' });
    }

    const supabase = supabaseAdminClient();

    // Get all users with employee role
    const { data: users, error } = await supabase.auth.admin.listUsers();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Filter to only employees
    const employees = users.users
      .filter((user) => user.user_metadata?.role === 'employee')
      .map((user) => ({
        id: user.id,
        email: user.email,
        firstName: user.user_metadata?.firstName || '',
        lastName: user.user_metadata?.lastName || '',
        phone: user.user_metadata?.phone || '',
        createdAt: user.created_at
      }));

    res.json({
      count: employees.length,
      employees
    });
  } catch (error: any) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

export default router;

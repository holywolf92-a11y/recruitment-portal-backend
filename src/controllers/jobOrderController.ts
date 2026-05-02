import { Request, Response } from 'express';
import {
  createJobOrder,
  getJobOrderById,
  listJobOrders,
  updateJobOrder,
  deleteJobOrder,
  generateJobCode,
  CreateJobOrderData,
  JobOrderFilters,
} from '../services/jobOrderService';
import { emailService } from '../services/emailService';

export async function generateJobCodeController(req: Request, res: Response) {
  try {
    const jobCode = await generateJobCode();
    res.json({ jobCode });
  } catch (error: any) {
    console.error('Error generating job code:', error);
    res.status(500).json({ error: 'Failed to generate job code' });
  }
}

export async function createJobOrderController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const jobOrderData: CreateJobOrderData = req.body;

    if (!jobOrderData.job_code) {
      return res.status(400).json({ error: 'Job code is required' });
    }

    if (!jobOrderData.employer_id) {
      return res.status(400).json({ error: 'Employer ID is required' });
    }

    const jobOrder = await createJobOrder(jobOrderData, userId);

    // Notify admin about new job order
    emailService.sendEmail({
      to: 'info@falishamanpower.com',
      subject: `New Job Order Posted: ${jobOrder.job_code}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#1d4ed8;">New Job Order Posted</h2>
          <p>A new job order has been created on the Falisha Manpower portal.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;">
            <tr>
              <td style="padding:8px;background:#f1f5f9;font-weight:bold;width:140px;">Job Code</td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${jobOrder.job_code}</td>
            </tr>
            <tr>
              <td style="padding:8px;background:#f1f5f9;font-weight:bold;">Job Order ID</td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${jobOrder.id}</td>
            </tr>
            <tr>
              <td style="padding:8px;background:#f1f5f9;font-weight:bold;">Employer ID</td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${jobOrder.employer_id}</td>
            </tr>
            <tr>
              <td style="padding:8px;background:#f1f5f9;font-weight:bold;">Posted At</td>
              <td style="padding:8px;">${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} (PKT)</td>
            </tr>
          </table>
          <p style="margin-top:24px;">
            <a href="https://falishajobs.up.railway.app/admin/job-orders" style="background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">View in Portal →</a>
          </p>
        </div>
      `,
      text: `New job order posted: ${jobOrder.job_code}\nJob ID: ${jobOrder.id}\nEmployer ID: ${jobOrder.employer_id}\nPosted at: ${new Date().toISOString()}`,
    }).catch(err => console.error('[JobOrder] Failed to send admin notification email:', err));

    res.status(201).json({ jobOrder });
  } catch (error: any) {
    console.error('Error creating job order:', error);
    if (error.message?.includes('already exists')) {
      res.status(409).json({ error: error.message });
    } else if (error.message?.includes('Employer not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(400).json({ error: error.message || 'Failed to create job order' });
    }
  }
}

export async function getJobOrderController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;
    const includeEmployer = req.query.includeEmployer === 'true';

    if (!id) {
      return res.status(400).json({ error: 'Job order ID is required' });
    }

    const jobOrder = await getJobOrderById(id, userId, includeEmployer);
    res.json({ jobOrder });
  } catch (error: any) {
    console.error('Error fetching job order:', error);
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Job order not found' });
    } else {
      res.status(500).json({ error: 'Failed to fetch job order' });
    }
  }
}

export async function listJobOrdersController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const includeEmployer = req.query.includeEmployer === 'true';

    const filters: JobOrderFilters = {
      search: req.query.search as string,
      employer_id: req.query.employer_id as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    };

    const result = await listJobOrders(filters, userId, includeEmployer);
    res.json(result);
  } catch (error: any) {
    console.error('Error listing job orders:', error);
    res.status(500).json({ error: 'Failed to fetch job orders' });
  }
}

export async function updateJobOrderController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Job order ID is required' });
    }

    const updateData: Partial<CreateJobOrderData> = req.body;

    const jobOrder = await updateJobOrder(id, updateData, userId);
    res.json({ jobOrder });
  } catch (error: any) {
    console.error('Error updating job order:', error);
    if (error.message?.includes('already exists')) {
      res.status(409).json({ error: error.message });
    } else if (error.message?.includes('Employer not found')) {
      res.status(404).json({ error: error.message });
    } else if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Job order not found' });
    } else {
      res.status(400).json({ error: error.message || 'Failed to update job order' });
    }
  }
}

export async function deleteJobOrderController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Job order ID is required' });
    }

    await deleteJobOrder(id, userId);
    res.json({ message: 'Job order deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting job order:', error);
    if (error.message?.includes('Cannot delete job order')) {
      res.status(409).json({ error: error.message });
    } else if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Job order not found' });
    } else {
      res.status(500).json({ error: 'Failed to delete job order' });
    }
  }
}

/**
 * Admin Dashboard Routes
 * Provides admin-only endpoints for membership data and session info.
 */
import { tracedFetch } from '../config/appContext.js';
import { Router } from 'express';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.js';
import { supabaseBreaker, HAS_SUPABASE } from '../storage/supabaseClient.js';
import { financialService } from '../services/financialService.js';
import {
  validateConfigChange,
  createChangeHistory,
  rollbackConfig,
} from '../utils/configApproval.js';
import { apiRateLimiter } from '../middleware/rateLimiter.js';
import { CircuitBreaker, circuitBreakerRegistry } from '../utils/circuitBreaker.js';
import {
  runIntegrityCheck,
  detectCorruption,
  generateRecoveryRecommendation,
  createRecoveryAuditLog,
} from '../utils/dataIntegrityValidator.js';
import {
  activateReadOnlyMode,
  deactivateReadOnlyMode,
  getReadOnlyStatus,
  createIncidentLog,
} from '../routes/readOnlyMode.js';
import {
  getServiceStatus,
  getIncidentTimeline,
  getMaintenanceSchedule,
  getHistoricalUptime,
  getSubscriberNotifications,
} from '../utils/serviceStatus.js';
import {
  runConsistencyCheck,
  getSynchronizationStatus,
  detectConflicts,
  generateIntegrityReport,
  getConsistencyAlerts,
} from '../utils/consistencyVerifier.js';

const router = Router();
const adminAuth = [apiRateLimiter, adminAuthMiddleware.requireAdmin];

/**
 * Raw membership fetch helper, wrapped in a circuit breaker to protect
 * against repeated failures from the upstream Google Apps Script endpoint.
 */
async function _rawMembershipFetch(scriptUrl, secret) {
  const response = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'getResponses', token: secret }),
  });
  if (!response.ok) {
    throw new Error(`Google Apps Script returned ${response.status}`);
  }
  return response.json();
}

const membershipBreaker = circuitBreakerRegistry.register(
  'membership-gas',
  new CircuitBreaker(_rawMembershipFetch, {
    name: 'membership-gas',
    failureThreshold: 3,
    successThreshold: 2,
    coolDownPeriod: 15000,
    maxCoolDownPeriod: 120000,
  })
);

/**
 * GET /membership — Fetch membership responses from Supabase (primary source of truth).
 * Falls back to Google Apps Script if Supabase is unavailable.
 * This ensures form submissions are always visible to admins even when
 * Google Sheets writes fail (quota, network, etc.).
 */
router.get('/membership', adminAuth, async (req, res) => {
  // Primary: Read from Supabase (source of truth)
  if (HAS_SUPABASE) {
    try {
      const data = await supabaseBreaker.execute(
        'form_submissions?form_type=eq.membership&order=created_at.desc',
        {
          method: 'GET',
        }
      );
      const responses = (data || []).map((row) => ({
        submittedAt: row.created_at,
        formType: row.form_type,
        fullName: row.full_name,
        collegeEmail: row.college_email,
        whatsapp: row.whatsapp,
        ...row.payload,
      }));
      return res.json({ responses });
    } catch (err) {
      if (err.code === 'CIRCUIT_OPEN') {
        console.warn(
          '[Membership] Supabase circuit breaker is OPEN, falling back to Google Apps Script'
        );
      } else {
        console.error('[Membership] Failed to fetch from Supabase:', err.message);
      }
      // Fall through to Google Apps Script fallback
    }
  }

  // Fallback: Google Apps Script (legacy path)
  const scriptUrl = process.env.MEMBERSHIP_SCRIPT_URL;
  const secret = process.env.MEMBERSHIP_SECRET;

  if (!scriptUrl || !secret) {
    return res.json({ responses: [] });
  }

  try {
    const data = await membershipBreaker.execute(scriptUrl, secret);
    return res.json({ responses: data.responses || [] });
  } catch (err) {
    if (err.code === 'CIRCUIT_OPEN') {
      console.warn(
        '[Membership] Google Apps Script circuit breaker is OPEN, returning empty responses'
      );
      return res.json({ responses: [] });
    }
    console.error('[Membership] Failed to fetch responses from Google Apps Script:', err.message);
    return res.status(500).json({ error: 'Failed to fetch membership responses' });
  }
});

/**
 * GET /me — Returns the authenticated admin's username.
 */
router.get('/me', adminAuth, (req, res) => {
  return res.json({ username: req.adminSession.username });
});

/**
 * POST /api/admin/config-review
 * Validate critical configuration changes
 */
router.post('/api/admin/config-review', adminAuth, (req, res) => {
  const validation = validateConfigChange(req.body);

  const history = createChangeHistory(req.body);

  const rollback = rollbackConfig(req.body);

  return res.json({
    success: true,
    validation,
    history,
    rollback,
  });
});

router.get('/api/admin/database-health', adminAuth, (req, res) => {
  res.json(runIntegrityCheck());
});

router.get('/api/admin/database-corruption', adminAuth, (req, res) => {
  res.json(detectCorruption());
});

router.get('/api/admin/database-recovery', adminAuth, (req, res) => {
  res.json(generateRecoveryRecommendation());
});

router.get('/api/admin/database-audit-log', adminAuth, (req, res) => {
  res.json(createRecoveryAuditLog());
});

router.get('/api/admin/read-only-status', adminAuth, (req, res) => {
  res.json(getReadOnlyStatus());
});

router.post('/api/admin/read-only-enable', adminAuth, (req, res) => {
  res.json(activateReadOnlyMode());
});

router.post('/api/admin/read-only-disable', adminAuth, (req, res) => {
  res.json(deactivateReadOnlyMode());
});

router.get('/api/admin/read-only-log', adminAuth, (req, res) => {
  res.json(createIncidentLog());
});

router.get('/api/admin/service-status', adminAuth, (req, res) => {
  res.json(getServiceStatus());
});

router.get('/api/admin/incidents', adminAuth, (req, res) => {
  res.json(getIncidentTimeline());
});

router.get('/api/admin/maintenance', adminAuth, (req, res) => {
  res.json(getMaintenanceSchedule());
});

router.get('/api/admin/uptime-report', adminAuth, (req, res) => {
  res.json(getHistoricalUptime());
});

router.get('/api/admin/status-subscribers', adminAuth, (req, res) => {
  res.json(getSubscriberNotifications());
});

router.get('/api/admin/consistency-check', adminAuth, (req, res) => {
  res.json(runConsistencyCheck());
});

router.get('/api/admin/sync-status', adminAuth, (req, res) => {
  res.json(getSynchronizationStatus());
});

router.get('/api/admin/conflicts', adminAuth, (req, res) => {
  res.json(detectConflicts());
});

router.get('/api/admin/integrity-report', adminAuth, (req, res) => {
  res.json(generateIntegrityReport());
});

router.get('/api/admin/consistency-alerts', adminAuth, (req, res) => {
  res.json(getConsistencyAlerts());
});

router.get('/api/admin/dependency-report', adminAuth, async (req, res) => {
  // dependency monitoring report
});

router.get('/api/admin/security-analytics', adminAuth, async (req, res) => {
  res.json({
    blockedIPs,
    riskScores,
    suspiciousRequests,
  });
});

router.get('/api/admin/reports/engagement', adminAuth, async (req, res) => {
  // Generate simulated user engagement stats
  const seedUsers = Array.from({ length: 45 }, (_, i) => {
    const eventsAttended = Math.floor(Math.random() * 15);
    const portfolioCompletion = Math.floor(Math.random() * 101);
    const activeDays30 = Math.floor(Math.random() * 31);
    const activeDays90 = Math.floor(Math.random() * 91);
    const score30 = Math.min((activeDays30 / 30) * 40, 40);
    const scoreEvents = Math.min((eventsAttended / 10) * 30, 30);
    const scorePortfolio = (portfolioCompletion / 100) * 30;
    const engagementScore = Math.round(score30 + scoreEvents + scorePortfolio);
    const isInactive = activeDays30 < 2 && eventsAttended === 0;

    return {
      id: `user-${i + 1}`,
      name: `Community Member ${i + 1}`,
      eventsAttended,
      portfolioCompletion,
      activeDays30,
      activeDays90,
      engagementScore,
      status: isInactive ? 'Inactive' : 'Active',
    };
  });
  seedUsers.sort((a, b) => b.engagementScore - a.engagementScore);
  res.json({ users: seedUsers });
});

router.get('/api/admin/reports/revenue', adminAuth, async (req, res) => {
  try {
    const user = { id: req.adminSession.username, role: 'admin' };
    const report = await financialService.getRevenueReport(user);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to generate revenue report' });
  }
});

import jwt from 'jsonwebtoken';

router.post('/api/admin/sso-invite', adminAuth, (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ error: 'JWT_SECRET is not configured on the server' });
  }

  // Generate a token valid for 24 hours
  const token = jwt.sign({ email: email.toLowerCase(), bypassSso: true }, jwtSecret, {
    expiresIn: '24h',
  });

  const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
  const inviteUrl = `${baseUrl}/api/auth/google?token=${token}`;

  return res.json({ token, inviteUrl });
});

router.get('/sessions', adminAuth, adminAuthMiddleware.getSecurityOverview);
router.delete('/sessions/:sessionId', adminAuth, adminAuthMiddleware.revokeSession);
router.delete('/sessions', adminAuth, adminAuthMiddleware.logoutOtherSessions);

export default router;

/**
 * Progress SSE Route (D03)
 *
 * Server-Sent Events endpoint for real-time campaign send progress.
 *
 * Endpoints:
 *   GET /api/progress/campaign/:campaignId  — Stream progress updates for a campaign
 *   GET /api/progress/stats                 — Overall queue/worker statistics
 *
 * Usage (frontend):
 *   const es = new EventSource('/api/progress/campaign/uuid-here');
 *   es.onmessage = (e) => { const data = JSON.parse(e.data); ... };
 *   es.onerror = () => { es.close(); };
 */

const express = require('express');
const router = express.Router();

const { verifyToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.use(verifyToken);

// ============================================
// GET /api/progress/campaign/:campaignId - SSE Stream
// ============================================
router.get('/campaign/:campaignId', (req, res) => {
  const campaignId = req.params.campaignId;
  const emailQueue = req.app.get('emailQueue');

  if (!emailQueue) {
    return res.status(503).json({
      success: false,
      error: 'QUEUE_NOT_AVAILABLE',
      message: 'Email queue is not initialized',
    });
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial state
  const initialProgress = emailQueue.getCampaignProgress(campaignId);
  res.write(`data: ${JSON.stringify({ type: 'init', ...initialProgress })}\n\n`);

  // If already complete, send final and close
  if (initialProgress.total > 0 && (initialProgress.completed + initialProgress.failed) >= initialProgress.total) {
    res.write(`data: ${JSON.stringify({ type: 'complete', ...initialProgress })}\n\n`);
    res.end();
    return;
  }

  // Subscribe to queue events for this campaign
  const eventHandlers = {
    started: (job) => {
      if (job.campaignId === campaignId) {
        const p = emailQueue.getCampaignProgress(campaignId);
        res.write(`data: ${JSON.stringify({ type: 'progress', job: job.id, status: 'processing', ...p })}\n\n`);
      }
    },
    completed: (job) => {
      if (job.campaignId === campaignId) {
        const p = emailQueue.getCampaignProgress(campaignId);
        res.write(`data: ${JSON.stringify({ type: 'progress', job: job.id, status: 'completed', result: job.result, ...p })}\n\n`);
      }
    },
    failed: (job) => {
      if (job.campaignId === campaignId) {
        const p = emailQueue.getCampaignProgress(campaignId);
        res.write(`data: ${JSON.stringify({ type: 'progress', job: job.id, status: 'failed', error: job.error, ...p })}\n\n`);
      }
    },
    retry: (job) => {
      if (job.campaignId === campaignId) {
        res.write(`data: ${JSON.stringify({ type: 'retry', job: job.id, attempt: job.retryCount })}\n\n`);
      }
    },
    campaignComplete: (data) => {
      if (data.campaignId === campaignId) {
        res.write(`data: ${JSON.stringify({ type: 'complete', ...data })}\n\n`);
        res.end();
      }
    },
  };

  // Register listeners
  for (const [event, handler] of Object.entries(eventHandlers)) {
    emailQueue.on(event, handler);
  }

  // Keep-alive heartbeat every 15 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (_) {
      // Client disconnected
    }
  }, 15000);

  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    for (const [event, handler] of Object.entries(eventHandlers)) {
      emailQueue.removeListener(event, handler);
    }
  });
});

// ============================================
// GET /api/progress/stats - Queue & Worker stats
// ============================================
router.get('/stats', (req, res) => {
  const emailQueue = req.app.get('emailQueue');
  const sendWorker = req.app.get('sendWorker');

  if (!emailQueue) {
    return res.status(503).json({
      success: false,
      error: 'QUEUE_NOT_AVAILABLE',
      message: 'Email queue not initialized',
    });
  }

  res.json({
    success: true,
    data: {
      queue: emailQueue.getStats(),
      worker: sendWorker ? sendWorker.getStats() : null,
      timestamp: new Date().toISOString(),
    },
  });
});

// ============================================
// POST /api/progress/campaign/:campaignId/cancel - Cancel a running campaign
// ============================================
router.post('/campaign/:campaignId/cancel', asyncHandler(async (req, res) => {
  const emailQueue = req.app.get('emailQueue');

  if (!emailQueue) {
    return res.status(503).json({
      success: false,
      error: 'QUEUE_NOT_AVAILABLE',
    });
  }

  const cancelled = emailQueue.cancelCampaign(req.params.campaignId);

  // Update campaign DB status
  const db = require('../db');
  await db.Campaign.update(
    { status: 'CANCELLED' },
    { where: { id: req.params.campaignId, userId: req.user.id } }
  );

  res.json({
    success: true,
    data: { cancelled, campaignId: req.params.campaignId },
    message: `${cancelled} pending jobs cancelled`,
  });
}));

module.exports = router;

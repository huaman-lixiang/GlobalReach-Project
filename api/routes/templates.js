const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');
const { templateService } = require('../services/templateService');
const { asyncHandler } = require('../middleware/errorHandler');

// S152: 标准安全中间件链
router.use(rateLimiter);
router.use(verifyToken);

router.post('/', verifyToken, asyncHandler(async (req, res) => {
  const { name, subject, body, description, isDefault } = req.body;
  const template = await templateService.createTemplate(
    req.user.id, name, subject, body, description, isDefault
  );
  res.status(201).json({ success: true, data: template });
}));

router.get('/', verifyToken, asyncHandler(async (req, res) => {
  const templates = await templateService.getTemplates(req.user.id);
  res.json({ success: true, data: templates });
}));

router.get('/:id', verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const template = await templateService.getTemplateById(id, req.user.id);
  if (!template) {
    return res.status(404).json({ success: false, error: 'TEMPLATE_NOT_FOUND' });
  }
  res.json({ success: true, data: template });
}));

router.put('/:id', verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, subject, body, description, isDefault } = req.body;
  const updates = {};
  if (name) updates.name = name;
  if (subject) updates.subject = subject;
  if (body) updates.body = body;
  if (description !== undefined) updates.description = description;
  if (isDefault !== undefined) updates.isDefault = isDefault;

  await templateService.updateTemplate(id, req.user.id, updates);
  res.json({ success: true, message: 'Template updated successfully' }));
}));

router.delete('/:id', verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await templateService.deleteTemplate(id, req.user.id);
  res.json({ success: true, message: 'Template deleted successfully' });
}));

router.post('/:id/default', verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await templateService.setDefaultTemplate(id, req.user.id);
  res.json({ success: true, message: 'Template set as default' });
}));

router.post('/:id/render', verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { data } = req.body;
  const result = await templateService.renderTemplateById(id, req.user.id, data);
  res.json({ success: true, data: result });
}));

router.get('/variables/list', verifyToken, asyncHandler(async (req, res) => {
  const variables = templateService.getAvailableVariables();
  res.json({ success: true, data: variables });
}));

module.exports = router;

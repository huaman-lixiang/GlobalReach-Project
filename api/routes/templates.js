const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { templateService } = require('../services/templateService');

router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, subject, body, description, isDefault } = req.body;
    const template = await templateService.createTemplate(
      req.user.id, name, subject, body, description, isDefault
    );
    res.status(201).json({ success: true, data: template });
  } catch (error) {
    console.error('[Templates] Create error:', error);
    res.status(500).json({ success: false, error: 'TEMPLATE_CREATE_FAILED', message: error.message });
  }
});

router.get('/', verifyToken, async (req, res) => {
  try {
    const templates = await templateService.getTemplates(req.user.id);
    res.json({ success: true, data: templates });
  } catch (error) {
    console.error('[Templates] List error:', error);
    res.status(500).json({ success: false, error: 'TEMPLATE_LIST_FAILED', message: error.message });
  }
});

router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const template = await templateService.getTemplateById(id, req.user.id);
    if (!template) {
      return res.status(404).json({ success: false, error: 'TEMPLATE_NOT_FOUND' });
    }
    res.json({ success: true, data: template });
  } catch (error) {
    console.error('[Templates] Get error:', error);
    res.status(500).json({ success: false, error: 'TEMPLATE_GET_FAILED', message: error.message });
  }
});

router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, subject, body, description, isDefault } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (subject) updates.subject = subject;
    if (body) updates.body = body;
    if (description !== undefined) updates.description = description;
    if (isDefault !== undefined) updates.isDefault = isDefault;
    
    await templateService.updateTemplate(id, req.user.id, updates);
    res.json({ success: true, message: 'Template updated successfully' });
  } catch (error) {
    console.error('[Templates] Update error:', error);
    res.status(500).json({ success: false, error: 'TEMPLATE_UPDATE_FAILED', message: error.message });
  }
});

router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    await templateService.deleteTemplate(id, req.user.id);
    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (error) {
    console.error('[Templates] Delete error:', error);
    res.status(500).json({ success: false, error: 'TEMPLATE_DELETE_FAILED', message: error.message });
  }
});

router.post('/:id/default', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    await templateService.setDefaultTemplate(id, req.user.id);
    res.json({ success: true, message: 'Template set as default' });
  } catch (error) {
    console.error('[Templates] Set default error:', error);
    res.status(500).json({ success: false, error: 'TEMPLATE_SET_DEFAULT_FAILED', message: error.message });
  }
});

router.post('/:id/render', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { data } = req.body;
    const result = await templateService.renderTemplateById(id, req.user.id, data);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[Templates] Render error:', error);
    if (error.message === 'TEMPLATE_NOT_FOUND') {
      res.status(404).json({ success: false, error: 'TEMPLATE_NOT_FOUND' });
    } else {
      res.status(500).json({ success: false, error: 'TEMPLATE_RENDER_FAILED', message: error.message });
    }
  }
});

router.get('/variables/list', verifyToken, async (req, res) => {
  try {
    const variables = templateService.getAvailableVariables();
    res.json({ success: true, data: variables });
  } catch (error) {
    console.error('[Templates] Variables error:', error);
    res.status(500).json({ success: false, error: 'TEMPLATE_VARIABLES_FAILED', message: error.message });
  }
});

module.exports = router;
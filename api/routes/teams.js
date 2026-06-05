const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { teamService } = require('../services/teamService');

router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    const team = await teamService.createTeam(req.user.id, name, description);
    res.status(201).json({ success: true, data: team });
  } catch (error) {
    console.error('[Teams] Create error:', error);
    res.status(500).json({ success: false, error: 'TEAM_CREATE_FAILED', message: error.message });
  }
});

router.get('/', verifyToken, async (req, res) => {
  try {
    const teams = await teamService.getTeams(req.user.id);
    res.json({ success: true, data: teams });
  } catch (error) {
    console.error('[Teams] List error:', error);
    res.status(500).json({ success: false, error: 'TEAM_LIST_FAILED', message: error.message });
  }
});

router.get('/:teamId', verifyToken, async (req, res) => {
  try {
    const { teamId } = req.params;
    const team = await teamService.getTeamById(teamId, req.user.id);
    res.json({ success: true, data: team });
  } catch (error) {
    console.error('[Teams] Get error:', error);
    if (error.message === 'TEAM_ACCESS_DENIED') {
      res.status(403).json({ success: false, error: 'TEAM_ACCESS_DENIED', message: 'Access denied' });
    } else {
      res.status(500).json({ success: false, error: 'TEAM_GET_FAILED', message: error.message });
    }
  }
});

router.delete('/:teamId', verifyToken, async (req, res) => {
  try {
    const { teamId } = req.params;
    await teamService.deleteTeam(teamId, req.user.id);
    res.json({ success: true, message: 'Team deleted successfully' });
  } catch (error) {
    console.error('[Teams] Delete error:', error);
    if (error.message === 'TEAM_ACCESS_DENIED') {
      res.status(403).json({ success: false, error: 'TEAM_ACCESS_DENIED', message: 'Access denied' });
    } else {
      res.status(500).json({ success: false, error: 'TEAM_DELETE_FAILED', message: error.message });
    }
  }
});

router.post('/:teamId/members', verifyToken, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { userId, role = 'MEMBER' } = req.body;
    await teamService.addMember(teamId, userId, role, req.user.id);
    res.status(201).json({ success: true, message: 'Member added successfully' });
  } catch (error) {
    console.error('[Teams] Add member error:', error);
    if (error.message === 'TEAM_ACCESS_DENIED') {
      res.status(403).json({ success: false, error: 'TEAM_ACCESS_DENIED', message: 'Access denied' });
    } else if (error.message === 'MEMBER_ALREADY_EXISTS') {
      res.status(400).json({ success: false, error: 'MEMBER_ALREADY_EXISTS', message: 'Member already exists' });
    } else {
      res.status(500).json({ success: false, error: 'TEAM_ADD_MEMBER_FAILED', message: error.message });
    }
  }
});

router.delete('/:teamId/members/:userId', verifyToken, async (req, res) => {
  try {
    const { teamId, userId } = req.params;
    await teamService.removeMember(teamId, userId, req.user.id);
    res.json({ success: true, message: 'Member removed successfully' });
  } catch (error) {
    console.error('[Teams] Remove member error:', error);
    if (error.message === 'TEAM_ACCESS_DENIED') {
      res.status(403).json({ success: false, error: 'TEAM_ACCESS_DENIED', message: 'Access denied' });
    } else if (error.message === 'CANNOT_REMOVE_OWNER') {
      res.status(400).json({ success: false, error: 'CANNOT_REMOVE_OWNER', message: 'Cannot remove owner' });
    } else {
      res.status(500).json({ success: false, error: 'TEAM_REMOVE_MEMBER_FAILED', message: error.message });
    }
  }
});

router.put('/:teamId/members/:userId/role', verifyToken, async (req, res) => {
  try {
    const { teamId, userId } = req.params;
    const { role } = req.body;
    await teamService.updateMemberRole(teamId, userId, role, req.user.id);
    res.json({ success: true, message: 'Member role updated successfully' });
  } catch (error) {
    console.error('[Teams] Update role error:', error);
    if (error.message === 'TEAM_ACCESS_DENIED') {
      res.status(403).json({ success: false, error: 'TEAM_ACCESS_DENIED', message: 'Access denied' });
    } else {
      res.status(500).json({ success: false, error: 'TEAM_UPDATE_ROLE_FAILED', message: error.message });
    }
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { teamService } = require('../services/teamService');

router.post('/', verifyToken, asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const team = await teamService.createTeam(req.user.id, name, description);
  res.status(201).json({ success: true, data: team });
}));

router.get('/', verifyToken, asyncHandler(async (req, res) => {
  const teams = await teamService.getTeams(req.user.id);
  res.json({ success: true, data: teams });
}));

router.get('/:teamId', verifyToken, asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const team = await teamService.getTeamById(teamId, req.user.id);
  res.json({ success: true, data: team });
}));

router.delete('/:teamId', verifyToken, asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  await teamService.deleteTeam(teamId, req.user.id);
  res.json({ success: true, message: 'Team deleted successfully' });
}));

router.post('/:teamId/members', verifyToken, asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const { userId, role = 'MEMBER' } = req.body;
  await teamService.addMember(teamId, userId, role, req.user.id);
  res.status(201).json({ success: true, message: 'Member added successfully' });
}));

router.delete('/:teamId/members/:userId', verifyToken, asyncHandler(async (req, res) => {
  const { teamId, userId } = req.params;
  await teamService.removeMember(teamId, userId, req.user.id);
  res.json({ success: true, message: 'Member removed successfully' });
}));

router.put('/:teamId/members/:userId/role', verifyToken, asyncHandler(async (req, res) => {
  const { teamId, userId } = req.params;
  const { role } = req.body;
  await teamService.updateMemberRole(teamId, userId, role, req.user.id);
  res.json({ success: true, message: 'Member role updated successfully' });
}));

module.exports = router;

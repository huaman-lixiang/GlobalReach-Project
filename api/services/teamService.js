const db = require('../db');
const { Op } = require('sequelize');

class TeamService {
  async createTeam(userId, name, description = '') {
    const team = await db.Team.create({
      name,
      description,
      ownerId: userId,
    });

    await db.TeamMember.create({
      teamId: team.id,
      userId,
      role: 'OWNER',
    });

    return team;
  }

  async getTeams(userId) {
    const memberships = await db.TeamMember.findAll({
      where: { userId },
      include: [{ model: db.Team }],
    });

    return memberships.map(m => ({
      id: m.Team.id,
      name: m.Team.name,
      description: m.Team.description,
      role: m.role,
      createdAt: m.Team.createdAt,
      memberCount: null,
    }));
  }

  async getTeamById(teamId, userId) {
    const membership = await db.TeamMember.findOne({
      where: { teamId, userId },
      include: [{ model: db.Team }],
    });

    if (!membership) {
      throw new Error('TEAM_ACCESS_DENIED');
    }

    const team = membership.Team;
    const members = await db.TeamMember.findAll({
      where: { teamId },
      include: [{ model: db.User, attributes: ['id', 'email', 'name'] }],
    });

    const campaigns = await db.Campaign.findAll({
      where: { teamId },
      attributes: ['id', 'name', 'status', 'createdAt'],
    });

    return {
      id: team.id,
      name: team.name,
      description: team.description,
      ownerId: team.ownerId,
      role: membership.role,
      createdAt: team.createdAt,
      members: members.map(m => ({
        id: m.userId,
        email: m.User.email,
        name: m.User.name,
        role: m.role,
        joinedAt: m.createdAt,
      })),
      campaigns,
    };
  }

  async addMember(teamId, userId, role = 'MEMBER', requesterId) {
    const membership = await db.TeamMember.findOne({
      where: { teamId, userId: requesterId },
    });

    if (!membership || membership.role !== 'OWNER') {
      throw new Error('TEAM_ACCESS_DENIED');
    }

    const existingMember = await db.TeamMember.findOne({
      where: { teamId, userId },
    });

    if (existingMember) {
      throw new Error('MEMBER_ALREADY_EXISTS');
    }

    return db.TeamMember.create({ teamId, userId, role });
  }

  async removeMember(teamId, userIdToRemove, requesterId) {
    const requesterMembership = await db.TeamMember.findOne({
      where: { teamId, userId: requesterId },
    });

    if (!requesterMembership || requesterMembership.role !== 'OWNER') {
      throw new Error('TEAM_ACCESS_DENIED');
    }

    if (requesterId === userIdToRemove) {
      throw new Error('CANNOT_REMOVE_OWNER');
    }

    return db.TeamMember.destroy({
      where: { teamId, userId: userIdToRemove },
    });
  }

  async updateMemberRole(teamId, userId, newRole, requesterId) {
    const requesterMembership = await db.TeamMember.findOne({
      where: { teamId, userId: requesterId },
    });

    if (!requesterMembership || requesterMembership.role !== 'OWNER') {
      throw new Error('TEAM_ACCESS_DENIED');
    }

    return db.TeamMember.update(
      { role: newRole },
      { where: { teamId, userId } }
    );
  }

  async deleteTeam(teamId, userId) {
    const membership = await db.TeamMember.findOne({
      where: { teamId, userId },
    });

    if (!membership || membership.role !== 'OWNER') {
      throw new Error('TEAM_ACCESS_DENIED');
    }

    await db.TeamMember.destroy({ where: { teamId } });
    return db.Team.destroy({ where: { id: teamId } });
  }

  async shareCampaign(campaignId, teamId, userId) {
    const campaign = await db.Campaign.findOne({ where: { id: campaignId } });
    
    if (!campaign) {
      throw new Error('CAMPAIGN_NOT_FOUND');
    }

    if (campaign.userId !== userId) {
      const teamMembership = await db.TeamMember.findOne({
        where: { teamId, userId },
      });
      if (!teamMembership) {
        throw new Error('TEAM_ACCESS_DENIED');
      }
    }

    return db.Campaign.update(
      { teamId },
      { where: { id: campaignId } }
    );
  }
}

const teamService = new TeamService();

module.exports = {
  TeamService,
  teamService,
};
'use strict';

const teamStore = require('./teamStore');
const memberStore = require('./memberStore');
const { getUserIdFromEvent, corsHeaders } = require('../holidays/authorizer');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

let clientConfig = {};

if (process.env.IS_OFFLINE) {
  clientConfig = {
    region: 'localhost',
    endpoint: 'http://localhost:8000',
    credentials: {
      accessKeyId: 'local',
      secretAccessKey: 'local',
    },
  };
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig));

module.exports.getHolidays = async (event) => {
  const userId = getUserIdFromEvent(event);
  
  if (!userId) {
    return {
      statusCode: 401,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  try {
    const queryParams = event.queryStringParameters || {};
    const requestedTeamIds = queryParams.teamId 
      ? (Array.isArray(queryParams.teamId) ? queryParams.teamId : [queryParams.teamId])
      : [];
    const requestedMemberIds = queryParams.memberId
      ? (Array.isArray(queryParams.memberId) ? queryParams.memberId : [queryParams.memberId])
      : [];

    const userMemberships = await memberStore.getMembershipsByUser(userId);
    const userTeamIds = userMemberships
      .filter(m => m.status === 'active')
      .map(m => m.teamId);

    let teamsToFetch = userTeamIds;
    if (requestedTeamIds.length > 0) {
      teamsToFetch = teamsToFetch.filter(id => requestedTeamIds.includes(id));
      
      if (teamsToFetch.length === 0) {
        return {
          statusCode: 403,
          headers: corsHeaders(event),
          body: JSON.stringify({ error: 'You are not a member of the requested teams' }),
        };
      }
    }

    const teams = await Promise.all(
      teamsToFetch.map(id => teamStore.getTeam(id))
    );
    const validTeams = teams.filter(t => t != null);

    const memberMap = new Map();
    
    for (const team of validTeams) {
      const teamMemberships = await memberStore.getMembershipsByTeam(team.id);
      
      for (const membership of teamMemberships) {
        if (membership.status === 'active') {
          if (!memberMap.has(membership.userId)) {
            memberMap.set(membership.userId, {
              id: membership.userId,
              email: membership.email,
              name: membership.name,
              picture: membership.picture,
              role: membership.role,
              teamIds: [team.id],
            });
          } else {
            const existing = memberMap.get(membership.userId);
            if (!existing.teamIds.includes(team.id)) {
              existing.teamIds.push(team.id);
            }
          }
        }
      }
    }

    let members = Array.from(memberMap.values());
    
    if (requestedMemberIds.length > 0) {
      members = members.filter(m => requestedMemberIds.includes(m.id));
    }

    const holidays = [];
    const userIds = members.map(m => m.id);

    for (const uid of userIds) {
      try {
        const result = await client.send(new GetCommand({
          TableName: `${process.env.DYNAMODB_TABLE}-${process.env.STAGE}`,
          Key: { id: uid },
        }));
        
        if (result.Item && result.Item.text) {
          const userHolidays = parseHolidaysFromUserData(result.Item.text, uid);
          holidays.push(...userHolidays);
        }
      } catch (error) {
        console.error(`Error fetching holidays for user ${uid}:`, error);
      }
    }

    const bankHolidays = getBankHolidays();
    holidays.push(...bankHolidays);

    const teamsWithMemberIds = validTeams.map(team => ({
      ...team,
      memberIds: members.filter(m => m.teamIds.includes(team.id)).map(m => m.id),
    }));

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({
        members,
        teams: teamsWithMemberIds,
        holidays,
      }),
    };
  } catch (error) {
    console.error('Error getting team holidays:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Failed to get team holidays' }),
    };
  }
};

function parseHolidaysFromUserData(userData, userId) {
  const holidays = [];
  
  if (userData.booked && Array.isArray(userData.booked)) {
    userData.booked.forEach((dateOrRange, index) => {
      if (typeof dateOrRange === 'string') {
        holidays.push({
          id: `${userId}-${index}`,
          userId,
          startDate: dateOrRange,
          endDate: dateOrRange,
          type: 'holiday',
          title: 'Holiday',
        });
      } else if (dateOrRange && typeof dateOrRange === 'object') {
        if (dateOrRange.start && dateOrRange.end) {
          holidays.push({
            id: `${userId}-${index}`,
            userId,
            startDate: dateOrRange.start,
            endDate: dateOrRange.end,
            type: 'holiday',
            title: dateOrRange.title || 'Holiday',
          });
        } else if (dateOrRange.date) {
          holidays.push({
            id: `${userId}-${index}`,
            userId,
            startDate: dateOrRange.date,
            endDate: dateOrRange.date,
            type: 'holiday',
            title: dateOrRange.title || 'Holiday',
          });
        }
      }
    });
  }
  
  if (userData.holidays && Array.isArray(userData.holidays)) {
    userData.holidays.forEach((holiday, index) => {
      holidays.push({
        id: `${userId}-h-${index}`,
        userId,
        startDate: holiday.startDate || holiday.date,
        endDate: holiday.endDate || holiday.date,
        type: 'holiday',
        title: holiday.title || 'Holiday',
      });
    });
  }
  
  return holidays;
}

function getBankHolidays() {
  return [
    {
      id: 'bh-2026-01-01',
      userId: 'system',
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      type: 'bank-holiday',
      title: "New Year's Day",
    },
    {
      id: 'bh-2026-04-03',
      userId: 'system',
      startDate: '2026-04-03',
      endDate: '2026-04-03',
      type: 'bank-holiday',
      title: 'Good Friday',
    },
    {
      id: 'bh-2026-04-06',
      userId: 'system',
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      type: 'bank-holiday',
      title: 'Easter Monday',
    },
    {
      id: 'bh-2026-05-04',
      userId: 'system',
      startDate: '2026-05-04',
      endDate: '2026-05-04',
      type: 'bank-holiday',
      title: 'Early May Bank Holiday',
    },
    {
      id: 'bh-2026-05-25',
      userId: 'system',
      startDate: '2026-05-25',
      endDate: '2026-05-25',
      type: 'bank-holiday',
      title: 'Spring Bank Holiday',
    },
    {
      id: 'bh-2026-08-31',
      userId: 'system',
      startDate: '2026-08-31',
      endDate: '2026-08-31',
      type: 'bank-holiday',
      title: 'Summer Bank Holiday',
    },
    {
      id: 'bh-2026-12-25',
      userId: 'system',
      startDate: '2026-12-25',
      endDate: '2026-12-25',
      type: 'bank-holiday',
      title: 'Christmas Day',
    },
    {
      id: 'bh-2026-12-26',
      userId: 'system',
      startDate: '2026-12-26',
      endDate: '2026-12-26',
      type: 'bank-holiday',
      title: 'Boxing Day',
    },
    {
      id: 'bh-2027-01-01',
      userId: 'system',
      startDate: '2027-01-01',
      endDate: '2027-01-01',
      type: 'bank-holiday',
      title: "New Year's Day",
    },
    {
      id: 'bh-2027-03-26',
      userId: 'system',
      startDate: '2027-03-26',
      endDate: '2027-03-26',
      type: 'bank-holiday',
      title: 'Good Friday',
    },
    {
      id: 'bh-2027-03-29',
      userId: 'system',
      startDate: '2027-03-29',
      endDate: '2027-03-29',
      type: 'bank-holiday',
      title: 'Easter Monday',
    },
    {
      id: 'bh-2027-05-03',
      userId: 'system',
      startDate: '2027-05-03',
      endDate: '2027-05-03',
      type: 'bank-holiday',
      title: 'Early May Bank Holiday',
    },
    {
      id: 'bh-2027-05-31',
      userId: 'system',
      startDate: '2027-05-31',
      endDate: '2027-05-31',
      type: 'bank-holiday',
      title: 'Spring Bank Holiday',
    },
    {
      id: 'bh-2027-08-30',
      userId: 'system',
      startDate: '2027-08-30',
      endDate: '2027-08-30',
      type: 'bank-holiday',
      title: 'Summer Bank Holiday',
    },
    {
      id: 'bh-2027-12-27',
      userId: 'system',
      startDate: '2027-12-27',
      endDate: '2027-12-27',
      type: 'bank-holiday',
      title: 'Christmas Day (substitute)',
    },
    {
      id: 'bh-2027-12-28',
      userId: 'system',
      startDate: '2027-12-28',
      endDate: '2027-12-28',
      type: 'bank-holiday',
      title: 'Boxing Day (substitute)',
    },
  ];
}

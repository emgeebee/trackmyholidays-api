# Teams API Guide

This guide explains how to use the teams functionality in the trackmyholidays API.

## Overview

The teams feature allows users to:
- Create and manage teams
- Invite members to teams
- Accept team invitations
- View holidays for team members
- Remove members or leave teams

## Authentication

All endpoints require authentication using the same Bearer token mechanism as existing endpoints:

```bash
Authorization: Bearer <google-id-token-or-long-lived-token>
```

## Core Concepts

### Teams
- Teams can be standalone or nested (parent/child relationships)
- Each team has admins and members
- Only admins can invite, remove members, and delete teams
- Teams can be deleted only after all sub-teams are removed

### Memberships
- When a user creates a team, they automatically become an admin
- Invited users start with "pending" status
- After accepting an invitation, status changes to "active"
- Only active members' data is shared with the team

### Roles
- **admin**: Can invite members, remove members, update team, delete team
- **member**: Can view team information and remove themselves

## Endpoints

### 1. Create a Team

```bash
POST /api/teams
Content-Type: application/json

{
  "name": "Engineering Team",
  "parentId": "optional-parent-team-id"
}
```

**Response:**
```json
{
  "team": {
    "id": "uuid",
    "name": "Engineering Team",
    "parentId": null,
    "createdBy": "user-id",
    "createdAt": "2026-10-20T...",
    "updatedAt": "2026-10-20T...",
    "memberIds": ["user-id"]
  }
}
```

### 2. List Teams

Returns all teams the authenticated user belongs to:

```bash
GET /api/teams
```

**Response:**
```json
{
  "teams": [
    {
      "id": "uuid",
      "name": "Engineering Team",
      "parentId": null,
      "memberIds": ["user-id-1", "user-id-2"]
    }
  ]
}
```

### 3. Update Team

Admins can update the team name:

```bash
PATCH /api/teams/{teamId}
Content-Type: application/json

{
  "name": "Updated Team Name"
}
```

### 4. Delete Team

Admins can delete a team (must remove sub-teams first):

```bash
DELETE /api/teams/{teamId}
```

### 5. Get Team Members

Returns all active members of a team:

```bash
GET /api/teams/{teamId}/members
```

**Response:**
```json
{
  "members": [
    {
      "id": "user-id",
      "email": "user@example.com",
      "name": "John Doe",
      "picture": "url",
      "role": "admin",
      "teamIds": ["team-id"]
    }
  ]
}
```

### 6. Invite Members

Admins can invite users to one or more teams:

```bash
POST /api/teams/invite
Content-Type: application/json

{
  "email": "newmember@example.com",
  "teamIds": ["team-id-1", "team-id-2"],
  "role": "member"
}
```

**Response:**
```json
{
  "success": true,
  "inviteId": "uuid"
}
```

**Notes:**
- Invitations expire after 7 days
- Email notification is not yet implemented (future enhancement)
- The inviteId can be shared with the invitee to accept

### 7. Get Pending Invitations

Users can view their pending invitations:

```bash
GET /api/teams/invites/pending
```

**Response:**
```json
{
  "invites": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "teamIds": ["team-id"],
      "role": "member",
      "invitedBy": "admin-user-id",
      "status": "pending",
      "createdAt": "2026-10-20T...",
      "expiresAt": "2026-10-27T...",
      "teams": [
        {
          "id": "team-id",
          "name": "Engineering Team"
        }
      ]
    }
  ]
}
```

### 8. Accept Invitation

Users can accept an invitation:

```bash
POST /api/teams/invites/{inviteId}/accept
```

**Response:**
```json
{
  "success": true
}
```

**Notes:**
- The invitation must be for the authenticated user's email
- Invitation must not be expired
- After acceptance, the user becomes an active team member

### 9. Remove Team Member

Remove a member from a team:

```bash
DELETE /api/teams/{teamId}/members/{memberId}
```

**Authorization:**
- Members can remove themselves
- Admins can remove any member
- Cannot remove the last admin of a team

### 10. Get Team Holidays (Main Feature)

Returns holidays for all members of teams the user belongs to:

```bash
GET /api/teams/holidays
GET /api/teams/holidays?teamId={id}
GET /api/teams/holidays?memberId={id}
GET /api/teams/holidays?teamId={id1}&teamId={id2}
```

**Response:**
```json
{
  "members": [
    {
      "id": "user-id",
      "email": "user@example.com",
      "name": "John Doe",
      "picture": "url",
      "role": "admin",
      "teamIds": ["team-id"]
    }
  ],
  "teams": [
    {
      "id": "team-id",
      "name": "Engineering Team",
      "parentId": null,
      "memberIds": ["user-id"]
    }
  ],
  "holidays": [
    {
      "id": "user-id-0",
      "userId": "user-id",
      "startDate": "2026-12-24",
      "endDate": "2026-12-31",
      "type": "holiday",
      "title": "Holiday"
    },
    {
      "id": "bh-2026-12-25",
      "userId": "system",
      "startDate": "2026-12-25",
      "endDate": "2026-12-25",
      "type": "bank-holiday",
      "title": "Christmas Day"
    }
  ]
}
```

**Notes:**
- Only returns holidays for teams the user is an active member of
- Includes UK bank holidays for 2026-2027
- Only holiday data is returned (not memorable dates or other personal info)
- Supports filtering by `teamId` and `memberId` query parameters

## Privacy & Security

### What is Shared
- Holiday dates (start/end)
- Holiday type (holiday or bank-holiday)
- User's name, email, and picture (from Google auth)
- Team membership information

### What is NOT Shared
- Memorable dates
- Personal notes
- Any other data not explicitly in the holidays endpoint

### Access Control
- Users can only see holidays for teams they belong to
- Team admins have the same access as members (no special privileges for viewing holidays)
- Invitations must match the user's authenticated email
- All actions require valid authentication tokens

## Example Workflow

### Creating a Team and Inviting Members

```bash
# 1. Create a team (as admin)
curl -X POST https://api.example.com/api/teams \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Engineering"}'

# Save the teamId from the response

# 2. Invite a member
curl -X POST https://api.example.com/api/teams/invite \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email":"member@example.com",
    "teamIds":["team-id"],
    "role":"member"
  }'

# Share the inviteId with the invitee

# 3. Invitee checks pending invitations
curl https://api.example.com/api/teams/invites/pending \
  -H "Authorization: Bearer $MEMBER_TOKEN"

# 4. Invitee accepts the invitation
curl -X POST https://api.example.com/api/teams/invites/{inviteId}/accept \
  -H "Authorization: Bearer $MEMBER_TOKEN"

# 5. Admin views team holidays (including the new member)
curl https://api.example.com/api/teams/holidays?teamId={teamId} \
  -H "Authorization: Bearer $TOKEN"
```

## Error Responses

All endpoints follow standard HTTP status codes:

- `200` - Success
- `400` - Bad request (invalid data, missing required fields)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found (team, member, or invitation doesn't exist)
- `500` - Internal server error

Error response format:
```json
{
  "error": "Error message"
}
```

## Local Development

To test locally:

```bash
# 1. Install dependencies
npm install

# 2. Start local DynamoDB and API
npm start

# 3. The API runs on http://localhost:3001
# 4. Use the same endpoints with the local URL
```

## Future Enhancements

Potential improvements for the teams feature:

1. **Email Notifications**: Send actual email invitations using AWS SES
2. **Invitation Links**: Generate shareable invitation links
3. **Team Settings**: Configure team preferences (timezone, work week, etc.)
4. **Bulk Operations**: Invite multiple users at once
5. **Activity Log**: Track team changes and member actions
6. **Calendar Export**: Export team holidays to calendar formats
7. **Conflict Detection**: Highlight overlapping holidays
8. **Custom Roles**: More granular permission system

#!/bin/bash

# Script to create DynamoDB tables for teams functionality
# Usage: ./scripts/create-tables.sh <stage> <region> <profile>

STAGE=${1:-dev}
REGION=${2:-us-west-2}
PROFILE=${3:-main}

echo "Creating DynamoDB tables for stage: $STAGE in region: $REGION"

# Create teams table
echo "Creating teams-$STAGE table..."
aws dynamodb create-table \
  --table-name "teams-$STAGE" \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=parentId,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    "IndexName=parentId-index,KeySchema=[{AttributeName=parentId,KeyType=HASH}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=1,WriteCapacityUnits=1}" \
  --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1 \
  --region $REGION \
  --profile $PROFILE \
  2>&1 | grep -v "ResourceInUseException" || echo "Table teams-$STAGE already exists or was created"

# Create teamMembers table
echo "Creating teamMembers-$STAGE table..."
aws dynamodb create-table \
  --table-name "teamMembers-$STAGE" \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=userId,AttributeType=S \
    AttributeName=teamId,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    "IndexName=userId-index,KeySchema=[{AttributeName=userId,KeyType=HASH}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=1,WriteCapacityUnits=1}" \
    "IndexName=teamId-index,KeySchema=[{AttributeName=teamId,KeyType=HASH}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=1,WriteCapacityUnits=1}" \
  --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1 \
  --region $REGION \
  --profile $PROFILE \
  2>&1 | grep -v "ResourceInUseException" || echo "Table teamMembers-$STAGE already exists or was created"

# Create teamInvites table
echo "Creating teamInvites-$STAGE table..."
aws dynamodb create-table \
  --table-name "teamInvites-$STAGE" \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=email,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    "IndexName=email-index,KeySchema=[{AttributeName=email,KeyType=HASH}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=1,WriteCapacityUnits=1}" \
  --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1 \
  --region $REGION \
  --profile $PROFILE \
  2>&1 | grep -v "ResourceInUseException" || echo "Table teamInvites-$STAGE already exists or was created"

echo "Done! Tables created for stage: $STAGE"

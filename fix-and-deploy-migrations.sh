#!/bin/bash
set -e

echo "🔧 Fixing failed migrations and deploying..."
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  exit 1
fi

echo "📊 Database: $DATABASE_URL"
echo ""

# Step 1: Mark the failed webhook index migration as rolled back
echo "1️⃣ Marking failed migration as rolled back..."
npx prisma migrate resolve --rolled-back 20260928180000_add_webhook_query_indexes
echo "✅ Migration marked as rolled back"
echo ""

# Step 2: Deploy all pending migrations
echo "2️⃣ Deploying migrations..."
npx prisma migrate deploy
echo "✅ All migrations deployed successfully"
echo ""

# Step 3: Generate Prisma client
echo "3️⃣ Generating Prisma client..."
npx prisma generate
echo "✅ Prisma client generated"
echo ""

echo "🎉 All done! Migrations deployed successfully."

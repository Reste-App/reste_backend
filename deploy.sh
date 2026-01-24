#!/bin/bash
# Deploy script for Supabase Edge Functions

set -e

echo "🚀 Deploying Stayca Backend..."

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Please install it first:"
    echo "   https://supabase.com/docs/guides/cli/getting-started"
    exit 1
fi

# List of edge functions to deploy
FUNCTIONS=(
    "places-search"
    "places-details"
    "stays"
    "elo-battle-pair"
    "elo-submit-match"
    "rankings-me"
    "feed"
    "posts"
    "follow"
    "profile"
)

echo "📦 Deploying ${#FUNCTIONS[@]} edge functions..."

# Deploy each function
for func in "${FUNCTIONS[@]}"; do
    echo "  → Deploying $func..."
    supabase functions deploy "$func" --no-verify-jwt
done

echo ""
echo "✅ All functions deployed successfully!"
echo ""
echo "⚙️  Don't forget to set secrets:"
echo "   supabase secrets set GOOGLE_PLACES_API_KEY=your-key"
echo "   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-key"
echo ""
echo "🗄️  Run migrations if needed:"
echo "   supabase db push"

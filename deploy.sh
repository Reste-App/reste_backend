#!/bin/bash
# Deploy script for Supabase Edge Functions

set -e

echo "🚀 Deploying Stayca Backend..."

# Check if Supabase CLI is available (local or global)
if command -v supabase &> /dev/null; then
    SUPABASE_CMD="supabase"
elif [ -f "node_modules/.bin/supabase" ]; then
    SUPABASE_CMD="npx supabase"
else
    echo "❌ Supabase CLI not found. Please run: npm install"
    exit 1
fi

echo "Using: $SUPABASE_CMD"

# List of edge functions to deploy
FUNCTIONS=(
    "places-search"
    "places-search-cities"
    "places-details"
    "hotel-lookup"
    "stays"
    "rankings-me"
    "rank-begin-placement"
    "rank-finalize-placement"
    "rank-reset"
    "vibe-summary"
    "vibe-submit"
    "feed"
    "posts"
    "follow"
    "profile"
)

echo "📦 Deploying ${#FUNCTIONS[@]} edge functions..."

# Deploy each function
for func in "${FUNCTIONS[@]}"; do
    echo "  → Deploying $func..."
    $SUPABASE_CMD functions deploy "$func" --no-verify-jwt
done

echo ""
echo "✅ All functions deployed successfully!"
echo ""
echo "⚙️  Don't forget to set secrets:"
echo "   npx supabase secrets set GOOGLE_PLACES_API_KEY=your-key"
echo "   npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-key"
echo ""
echo "🗄️  Database already set up via MCP."

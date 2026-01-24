#!/bin/bash
# Quick start script for Stayca backend development

set -e

echo "🏨 Stayca Backend - Quick Start"
echo "================================"
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not installed"
    echo "   Install: npm install -g supabase"
    exit 1
fi
echo "✅ Supabase CLI found"

# Check if already linked
if [ ! -f "supabase/.temp/project-ref" ] && [ ! -f ".git/refs/supabase" ]; then
    echo ""
    echo "🔗 Linking to Supabase project..."
    echo "   You'll need your project ref (from Supabase dashboard)"
    supabase link
else
    echo "✅ Already linked to Supabase project"
fi

# Check for .env file
if [ ! -f ".env.local" ]; then
    echo ""
    echo "⚙️  Creating .env.local from template..."
    if [ -f ".env.example" ]; then
        cp .env.example .env.local
        echo "✅ Created .env.local"
        echo "   ⚠️  Please update with your actual values!"
    fi
fi

# Run migrations
echo ""
echo "🗄️  Running database migrations..."
supabase db push
echo "✅ Migrations applied"

# Deploy functions
echo ""
echo "🚀 Deploying edge functions..."
./deploy.sh

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📝 Next steps:"
echo ""
echo "1. Set your secrets:"
echo "   supabase secrets set GOOGLE_PLACES_API_KEY=your-key"
echo "   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-key"
echo ""
echo "2. Update .env.local with your values"
echo ""
echo "3. Test locally:"
echo "   supabase start"
echo "   supabase functions serve stays --env-file .env.local"
echo ""
echo "4. Read the docs:"
echo "   - README.md for full setup"
echo "   - API.md for endpoint reference"
echo ""
echo "Happy hacking! 🚀"

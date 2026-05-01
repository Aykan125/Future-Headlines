#!/bin/bash

# Database setup script for Future Headlines MVP

echo "🗄️  Setting up PostgreSQL database..."

# Database credentials (modify as needed)
DB_NAME="future_headlines"
DB_USER="${POSTGRES_USER:-postgres}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"

# Check if PostgreSQL is running
if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" > /dev/null 2>&1; then
    echo "❌ PostgreSQL is not running on $DB_HOST:$DB_PORT"
    echo "Please start PostgreSQL and try again."
    exit 1
fi

echo "✅ PostgreSQL is running"

# Create database if it doesn't exist
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo "✅ Database '$DB_NAME' already exists"
else
    echo "📝 Creating database '$DB_NAME'..."
    createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
    if [ $? -eq 0 ]; then
        echo "✅ Database '$DB_NAME' created successfully"
    else
        echo "❌ Failed to create database"
        exit 1
    fi
fi

echo ""
echo "🚀 Database setup complete!"
echo ""
echo "Next steps:"
echo "  1. Make sure your backend/.env file has the correct DATABASE_URL"
echo "  2. Run: cd backend && npm run migrate"
echo "  3. Start the backend: npm run dev"


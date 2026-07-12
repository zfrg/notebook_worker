-- Migration: Add userId column to notes table for per-user data isolation
ALTER TABLE notes ADD COLUMN userId INTEGER NOT NULL DEFAULT 0;

-- Migration: Create notes table for D1
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);

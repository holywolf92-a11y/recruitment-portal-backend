-- Migration: Add youtube_link column to candidates table
ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS youtube_link TEXT;

-- Drop all KanbanMF tables and custom types in reverse-dependency order.
-- Run this to wipe the schema before recreating it from the sql/ files.
--
-- Order rationale:
--   board_shares, user_board_stars  →  reference boards + users
--   boards                          →  references users
--   user_preferences                →  references users, uses dateformat type
--   user_identities                 →  references users, uses authprovider type
--   user_avatars, user_sessions     →  reference users
--   users                           →  root table
--   custom types                    →  must be dropped after all tables that use them

DROP TABLE IF EXISTS board_shares      CASCADE;
DROP TABLE IF EXISTS user_board_stars  CASCADE;
DROP TABLE IF EXISTS boards            CASCADE;
DROP TABLE IF EXISTS user_preferences  CASCADE;
DROP TABLE IF EXISTS user_identities   CASCADE;
DROP TABLE IF EXISTS user_avatars      CASCADE;
DROP TABLE IF EXISTS user_sessions     CASCADE;
DROP TABLE IF EXISTS users             CASCADE;

DROP TYPE IF EXISTS dateformat    CASCADE;
DROP TYPE IF EXISTS authprovider  CASCADE;

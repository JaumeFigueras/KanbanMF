-- Drop all KanbanMF tables and custom types in reverse-dependency order.
-- Run this to wipe the schema before recreating it from the sql/ files.
--
-- Order rationale:
--   checklist_items                 →  reference checklists
--   checklists                      →  reference cards
--   card_due_notifications          →  reference cards + users
--   card_labels                     →  reference cards + labels
--   card_members, card_assignees    →  reference cards + users
--   ui_list_card_orders             →  reference board_lists
--   cards                           →  reference board_lists + users
--   labels                          →  reference boards
--   ui_board_list_orders            →  reference boards
--   ui_board_orders                 →  reference users
--   board_notification_offsets      →  reference board_notification_settings
--   board_notification_settings     →  reference boards
--   board_lists                     →  reference boards
--   board_shares, user_board_stars  →  reference boards + users
--   boards                          →  reference users
--   user_preferences                →  references users, uses dateformat type
--   user_identities                 →  references users, uses authprovider type
--   user_avatars, user_sessions     →  reference users
--   users                           →  root table
--   custom types                    →  must be dropped after all tables that use them

DROP TABLE IF EXISTS checklist_items        CASCADE;
DROP TABLE IF EXISTS checklists             CASCADE;
DROP TABLE IF EXISTS card_due_notifications CASCADE;
DROP TABLE IF EXISTS card_labels            CASCADE;
DROP TABLE IF EXISTS card_members           CASCADE;
DROP TABLE IF EXISTS card_assignees         CASCADE;
DROP TABLE IF EXISTS ui_list_card_orders    CASCADE;
DROP TABLE IF EXISTS cards                  CASCADE;
DROP TABLE IF EXISTS labels                 CASCADE;
DROP TABLE IF EXISTS ui_board_list_orders   CASCADE;
DROP TABLE IF EXISTS ui_board_orders        CASCADE;
DROP TABLE IF EXISTS board_notification_offsets  CASCADE;
DROP TABLE IF EXISTS board_notification_settings CASCADE;
DROP TABLE IF EXISTS board_lists            CASCADE;
DROP TABLE IF EXISTS board_shares           CASCADE;
DROP TABLE IF EXISTS user_board_stars       CASCADE;
DROP TABLE IF EXISTS boards                 CASCADE;
DROP TABLE IF EXISTS user_preferences       CASCADE;
DROP TABLE IF EXISTS user_identities        CASCADE;
DROP TABLE IF EXISTS user_avatars           CASCADE;
DROP TABLE IF EXISTS user_sessions          CASCADE;
DROP TABLE IF EXISTS users                  CASCADE;

DROP TYPE IF EXISTS dateformat    CASCADE;
DROP TYPE IF EXISTS authprovider  CASCADE;

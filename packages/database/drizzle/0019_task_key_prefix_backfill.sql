-- Re-derive task-key prefixes that the old rule shortened.
--
-- Before prefixes were stored as typed, `defaultPrefix` upper-cased a name's letters and
-- kept four of them, so "Jane Doe's Workspace" became JANE. Existing rows kept that value
-- because the default is only applied when a workspace is created. This aligns them with
-- the current rule: the label's letters as written, up to 24, with a default name's
-- "'s Workspace" suffix dropped.
--
-- Only rows still holding exactly what the old rule would have produced are touched, so a
-- prefix that was chosen by hand is left alone.
UPDATE "workspaces"
   SET "task_key_prefix" = COALESCE(
         NULLIF(
           LEFT(
             REGEXP_REPLACE(
               REGEXP_REPLACE("name", '[''’]s\s+Workspace$', '', 'i'),
               '[^A-Za-z]', '', 'g'
             ),
             24
           ),
           ''
         ),
         'ML'
       )
 WHERE "task_key_prefix" = COALESCE(
         NULLIF(LEFT(UPPER(REGEXP_REPLACE("name", '[^A-Za-z]', '', 'g')), 4), ''),
         'ML'
       );

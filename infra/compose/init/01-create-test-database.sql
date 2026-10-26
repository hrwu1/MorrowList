-- The integration and browser test harnesses truncate and re-migrate these databases
-- freely, so they must never be the same database used for development data.
CREATE DATABASE morrowlist_test;
CREATE DATABASE morrowlist_e2e;

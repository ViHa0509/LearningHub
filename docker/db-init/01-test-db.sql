-- Separate database for the test suite, so tests never touch dev data.
CREATE DATABASE learninghub_test OWNER learninghub;
-- Separate database for the end-to-end UI checks (frontend/e2e).
CREATE DATABASE learninghub_e2e OWNER learninghub;

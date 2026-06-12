-- Setup Session: a 30-minute onboarding call that replaces the old in-app
-- onboarding wizard. After signing the BAA, practices book this session (GHL
-- calendar) and our team configures PMS, messaging, and team setup together.
--   setup_session_booked_at    — stamped when the practice books the call
--   setup_session_completed_at — stamped after the call is held
ALTER TABLE practices ADD COLUMN IF NOT EXISTS setup_session_booked_at TIMESTAMPTZ;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS setup_session_completed_at TIMESTAMPTZ;

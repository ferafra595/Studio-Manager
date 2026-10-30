CREATE TABLE IF NOT EXISTS sm_assignments(patient_id TEXT NOT NULL REFERENCES sm_patients(id),specialist_id TEXT NOT NULL REFERENCES sm_specialists(id),PRIMARY KEY(patient_id,specialist_id));
CREATE TABLE IF NOT EXISTS sm_schedules(id TEXT PRIMARY KEY,specialist_id TEXT NOT NULL REFERENCES sm_specialists(id),weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),start_time TEXT NOT NULL,end_time TEXT NOT NULL,valid_from TEXT,valid_until TEXT,CHECK(start_time<end_time));
CREATE INDEX IF NOT EXISTS idx_sm_schedules ON sm_schedules(specialist_id,weekday);
CREATE TABLE IF NOT EXISTS sm_blocks(id TEXT PRIMARY KEY,specialist_id TEXT NOT NULL REFERENCES sm_specialists(id),start_at TEXT NOT NULL,end_at TEXT NOT NULL,reason TEXT,CHECK(start_at<end_at));

CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
CREATE TABLE brands(id TEXT PRIMARY KEY,name TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,demo BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE users(
 id UUID PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,name TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','staff','brand','admin')),
 brand_id TEXT REFERENCES brands(id),blocked BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK((role IN ('staff','brand') AND brand_id IS NOT NULL) OR (role IN ('player','admin') AND brand_id IS NULL))
);
CREATE TABLE profiles(player_id UUID PRIMARY KEY REFERENCES users(id),xp INTEGER NOT NULL DEFAULT 0 CHECK(xp>=0),coins INTEGER NOT NULL DEFAULT 0 CHECK(coins>=0));
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),revoked_at TIMESTAMPTZ);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE campaigns(
 id UUID PRIMARY KEY,brand_id TEXT NOT NULL REFERENCES brands(id),title TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,
 starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,max_rewards INTEGER NOT NULL CHECK(max_rewards>0),
 reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0),issued INTEGER NOT NULL DEFAULT 0 CHECK(issued>=0),
 CHECK(reserved+issued<=max_rewards),CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at)
);
CREATE TABLE missions(
 id TEXT PRIMARY KEY,campaign_id UUID NOT NULL REFERENCES campaigns(id),brand_id TEXT NOT NULL REFERENCES brands(id),
 title TEXT NOT NULL,description TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('checkpoint','collect','delivery')),
 time_limit_seconds INTEGER NOT NULL CHECK(time_limit_seconds IN(15,30,45,60,90,120)),targets JSONB NOT NULL,start_position JSONB NOT NULL,
 movement JSONB NOT NULL DEFAULT '{"walkSpeed":14,"sprintSpeed":22,"goalRadius":4.5,"worldBounds":{"minX":-112,"maxX":112,"minZ":-112,"maxZ":112}}',
 reward_xp INTEGER NOT NULL CHECK(reward_xp BETWEEN 0 AND 500),reward_coins INTEGER NOT NULL CHECK(reward_coins BETWEEN 0 AND 500),
 reward_title TEXT NOT NULL,reward_valid_hours INTEGER NOT NULL DEFAULT 48 CHECK(reward_valid_hours BETWEEN 1 AND 720),active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE mission_attempts(
 id UUID PRIMARY KEY,mission_id TEXT NOT NULL REFERENCES missions(id),campaign_id UUID NOT NULL REFERENCES campaigns(id),player_id UUID NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','won','failed')),started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),deadline_at TIMESTAMPTZ NOT NULL,
 finished_at TIMESTAMPTZ,failure_reason TEXT,mission_snapshot JSONB NOT NULL,position JSONB NOT NULL,
 completed JSONB NOT NULL DEFAULT '[]',last_input_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),last_input_seq BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX one_active_attempt_per_player ON mission_attempts(player_id) WHERE status='active';
CREATE INDEX attempts_expiry ON mission_attempts(deadline_at) WHERE status='active';
CREATE INDEX attempts_player_history ON mission_attempts(player_id,started_at DESC);
CREATE TABLE checkpoint_events(id UUID PRIMARY KEY,attempt_id UUID NOT NULL REFERENCES mission_attempts(id),sequence INTEGER NOT NULL,occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),UNIQUE(attempt_id,sequence));
CREATE TABLE rewards(
 id UUID PRIMARY KEY,attempt_id UUID NOT NULL UNIQUE REFERENCES mission_attempts(id),player_id UUID NOT NULL REFERENCES users(id),brand_id TEXT NOT NULL REFERENCES brands(id),campaign_id UUID NOT NULL REFERENCES campaigns(id),
 title TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,token_encrypted TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN('AVAILABLE','USED','EXPIRED','CANCELLED')),
 expires_at TIMESTAMPTZ NOT NULL,redeemed_at TIMESTAMPTZ,redeemed_by UUID REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX rewards_player ON rewards(player_id,created_at DESC);
CREATE TABLE idempotency_keys(user_id UUID NOT NULL REFERENCES users(id),scope TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,response_encrypted TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(user_id,scope,key));
CREATE TABLE rate_limits(key TEXT PRIMARY KEY,window_start TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),hits INTEGER NOT NULL DEFAULT 1);
CREATE TABLE audit_events(id UUID PRIMARY KEY,actor_id UUID REFERENCES users(id),type TEXT NOT NULL,subject_id TEXT,metadata JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
CREATE INDEX audit_actor_time ON audit_events(actor_id,created_at DESC);
INSERT INTO brands(id,name) VALUES('demo-brand','ALMATY 60 Demo Brand'),('aporta','APORTA — демо'),('steppe','STEPPE — демо'),('alma','ALMA — демо'),('nomad','NOMAD — демо'),('sary','SARY — демо');
INSERT INTO campaigns(id,brand_id,title,max_rewards) VALUES('11111111-1111-4111-8111-111111111111','demo-brand','Staging: демо-маршрут',500);
INSERT INTO missions(id,campaign_id,brand_id,title,description,type,time_limit_seconds,targets,start_position,reward_xp,reward_coins,reward_title)
 VALUES('m_demo_60_checkpoint_run','11111111-1111-4111-8111-111111111111','demo-brand','60 секунд: первый маршрут','Пройдите пять точек. Награда демонстрационная.','checkpoint',60,'[{"x":0,"z":10},{"x":0,"z":17},{"x":0,"z":24},{"x":0,"z":31},{"x":0,"z":38}]','{"x":0,"z":0}',100,50,'Демонстрационный приз — без реальной стоимости');
INSERT INTO missions(id,campaign_id,brand_id,title,description,type,time_limit_seconds,targets,start_position,movement,reward_xp,reward_coins,reward_title)
 VALUES('m_arbat_60_checkpoint_run','11111111-1111-4111-8111-111111111111','demo-brand','Ритм Арбата','Пять точек в мобильном игровом мире. Демо-награда.','checkpoint',60,'[{"x":12,"z":0},{"x":26,"z":5},{"x":40,"z":0},{"x":54,"z":-5},{"x":68,"z":0}]','{"x":0,"z":0}','{"walkSpeed":4.2,"sprintSpeed":7.2,"goalRadius":1.6,"worldBounds":{"minX":-112,"maxX":112,"minZ":-112,"maxZ":112}}',150,60,'Демонстрационный приз Арбата — без реальной стоимости');
INSERT INTO schema_migrations(version) VALUES(1);

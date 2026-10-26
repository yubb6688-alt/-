import { DatabaseSync } from 'node:sqlite';

export function createLimiter(filename = ':memory:', now = Date.now) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS starts (ip TEXT NOT NULL, ts INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS starts_ip_ts ON starts(ip, ts);');
  return {
    take(ip) {
      const time = now();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM starts WHERE ts <= ?').run(time - 600000);
        const row = db.prepare('SELECT COUNT(*) AS count, MIN(ts) AS oldest FROM starts WHERE ip = ?').get(ip);
        if (row.count >= 6) {
          db.exec('COMMIT');
          return { allowed: false, retryAfter: Math.max(1, Math.ceil((row.oldest + 600000 - time) / 1000)) };
        }
        db.prepare('INSERT INTO starts(ip, ts) VALUES (?, ?)').run(ip, time);
        db.exec('COMMIT');
        return { allowed: true };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); },
  };
}

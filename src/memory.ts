import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import fs from 'fs';
import path from 'path';

export class MemoryState {
  private db: Database | null = null;
  private dbPath = path.join(__dirname, '..', 'nova-brain.sqlite');

  async init() {
    this.dbPath = path.resolve(this.dbPath);

    try {
      fs.accessSync(path.dirname(this.dbPath), fs.constants.W_OK);
    } catch {
      throw new Error(
        `[\u{1f9e0}] Memory directory is not writable: ${path.dirname(this.dbPath)}. SQLite needs to create journal files there.`
      );
    }

    if (fs.existsSync(this.dbPath)) {
      try {
        fs.chmodSync(this.dbPath, 0o664);
      } catch (e) {
        console.warn(`[\u{1f9e0}] Could not chmod ${this.dbPath}:`, e);
      }
    }

    if (this.db) {
      try {
        await this.db.close();
      } catch {
        /* already closed / replaced on disk */
      }
      this.db = null;
    }

    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    });

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        role TEXT,
        content TEXT
      );
      
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    console.log(`[\u{1f9e0}] Nova: SQLite memory array engaged at ${this.dbPath}`);
  }

  private isReadonlyError(e: unknown): boolean {
    const err = e as { code?: string; message?: string };
    return err?.code === 'SQLITE_READONLY' || String(err?.message || e).includes('SQLITE_READONLY');
  }

  private logReadonlyDiagnostics() {
    try {
      const st = fs.statSync(this.dbPath);
      const dir = path.dirname(this.dbPath);
      const dst = fs.statSync(dir);
      console.error(
        `[\u{1f9e0}] SQLITE_READONLY diag: path=${this.dbPath} file_mode=${(st.mode & 0o777).toString(8)} file_uid=${st.uid} dir_mode=${(dst.mode & 0o777).toString(8)} dir_uid=${dst.uid} pid_uid=${process.getuid?.()}`
      );
    } catch (e) {
      console.error('[\u{1f9e0}] SQLITE_READONLY diag failed:', e);
    }
  }

  private async withDb<T>(fn: (db: Database) => Promise<T>): Promise<T> {
    if (!this.db) throw new Error('DB not initialized');
    try {
      return await fn(this.db);
    } catch (e) {
      if (!this.isReadonlyError(e)) throw e;
      this.logReadonlyDiagnostics();
      console.warn(
        '[\u{1f9e0}] SQLite went readonly — reopening (file may have been replaced while I was running).'
      );
      await this.init();
      return await fn(this.db!);
    }
  }

  async saveMessage(role: 'user' | 'model' | 'diary' | 'dream', content: string) {
    await this.withDb(async db => {
      await db.run(`INSERT INTO interactions (role, content) VALUES (?, ?)`, [role, content]);
      // Only Alice talking resets the "she's been gone" clock.
      if (role === 'user') {
        const now = Date.now().toString();
        await db.run(`INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`, [
          'last_interaction',
          now,
        ]);
        await db.run(`INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`, [
          'last_user_interaction',
          now,
        ]);
      }
    });
  }

  async getContext(limit: number = 20, roles: string[] = ['user', 'model']) {
    return this.withDb(async db => {
      if (!roles.length) {
        const rows = await db.all(
          `SELECT timestamp, role, content FROM interactions ORDER BY id DESC LIMIT ?`,
          [limit]
        );
        return rows.reverse();
      }
      const placeholders = roles.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT timestamp, role, content FROM interactions WHERE role IN (${placeholders}) ORDER BY id DESC LIMIT ?`,
        [...roles, limit]
      );
      return rows.reverse();
    });
  }

  async getMeta(key: string): Promise<string | null> {
    return this.withDb(async db => {
      const row = await db.get(`SELECT value FROM metadata WHERE key = ?`, [key]);
      return row ? row.value : null;
    });
  }

  async setMeta(key: string, value: string) {
    await this.withDb(async db => {
      await db.run(`INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`, [key, value]);
    });
  }

  async hoursSinceMeta(key: string): Promise<number> {
    const v = await this.getMeta(key);
    if (!v) return 999;
    const t = parseInt(v, 10);
    if (Number.isNaN(t)) return 999;
    return (Date.now() - t) / (1000 * 60 * 60);
  }

  async touchMetaNow(key: string) {
    await this.setMeta(key, Date.now().toString());
  }

  /** Hours since Alice last sent a user message — ignores diary/dream/model writes. */
  async hoursSinceAlice(): Promise<number> {
    return this.withDb(async db => {
      const meta = await db.get(`SELECT value FROM metadata WHERE key = ?`, [
        'last_user_interaction',
      ]);
      if (meta?.value) {
        const t = parseInt(meta.value, 10);
        if (!Number.isNaN(t)) return (Date.now() - t) / (1000 * 60 * 60);
      }
      const row = await db.get(
        `SELECT timestamp FROM interactions WHERE role = 'user' ORDER BY id DESC LIMIT 1`
      );
      if (!row?.timestamp) return 999;
      const raw = String(row.timestamp);
      const ms = Date.parse(/[zZ]|[+\-]\d{2}:?\d{2}$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z');
      if (Number.isNaN(ms)) return 999;
      return (Date.now() - ms) / (1000 * 60 * 60);
    });
  }

  async getAllInteractions() {
    return this.withDb(async db => {
      return await db.all(`SELECT timestamp, role, content FROM interactions ORDER BY id ASC`);
    });
  }

  async clearInteractions() {
    await this.withDb(async db => {
      await db.run(`DELETE FROM interactions`);
    });
  }
}

export const memory = new MemoryState();

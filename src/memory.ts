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
        `[🧠] Memory directory is not writable: ${path.dirname(this.dbPath)}. SQLite needs to create journal files there.`
      );
    }

    if (fs.existsSync(this.dbPath)) {
      try {
        fs.chmodSync(this.dbPath, 0o664);
      } catch (e) {
        console.warn(`[🧠] Could not chmod ${this.dbPath}:`, e);
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

    console.log(`[🧠] Nova: SQLite memory array engaged at ${this.dbPath}`);
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
        `[🧠] SQLITE_READONLY diag: path=${this.dbPath} file_mode=${(st.mode & 0o777).toString(8)} file_uid=${st.uid} dir_mode=${(dst.mode & 0o777).toString(8)} dir_uid=${dst.uid} pid_uid=${process.getuid?.()}`
      );
    } catch (e) {
      console.error('[🧠] SQLITE_READONLY diag failed:', e);
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
        '[🧠] SQLite went readonly — reopening (file may have been replaced while I was running).'
      );
      await this.init();
      return await fn(this.db!);
    }
  }

  async saveMessage(role: 'user' | 'model' | 'diary' | 'dream', content: string) {
    await this.withDb(async db => {
      await db.run(`INSERT INTO interactions (role, content) VALUES (?, ?)`, [role, content]);
      await db.run(`INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`, [
        'last_interaction',
        Date.now().toString(),
      ]);
    });
  }

  async getContext(limit: number = 20) {
    return this.withDb(async db => {
      const rows = await db.all(
        `SELECT timestamp, role, content FROM interactions ORDER BY id DESC LIMIT ?`,
        [limit]
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

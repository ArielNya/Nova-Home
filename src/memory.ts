import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

export class MemoryState {
  private db: Database | null = null;
  private dbPath = path.join(__dirname, '..', 'nova-brain.sqlite');

  async init() {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
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
    
    console.log('[🧠] Nova: SQLite memory array engaged.');
  }

  async saveMessage(role: 'user' | 'model' | 'diary' | 'dream', content: string) {
    if (!this.db) return;
    await this.db.run(`INSERT INTO interactions (role, content) VALUES (?, ?)`, [role, content]);
    await this.setMeta('last_interaction', Date.now().toString());
  }

  async getContext(limit: number = 20) {
    if (!this.db) return [];
    const rows = await this.db.all(`SELECT role, content FROM interactions ORDER BY id DESC LIMIT ?`, [limit]);
    return rows.reverse();
  }

  async getMeta(key: string): Promise<string | null> {
    if (!this.db) return null;
    const row = await this.db.get(`SELECT value FROM metadata WHERE key = ?`, [key]);
    return row ? row.value : null;
  }

  async setMeta(key: string, value: string) {
    if (!this.db) return;
    await this.db.run(`INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`, [key, value]);
  }

  async getAllInteractions() {
    if (!this.db) return [];
    return await this.db.all(`SELECT role, content FROM interactions ORDER BY id ASC`);
  }

  async clearInteractions() {
    if (!this.db) return;
    await this.db.run(`DELETE FROM interactions`);
  }
}

export const memory = new MemoryState();

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {applyCommit, DrawError} = require('./core');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function syncParentDirectory(dirname, platform = process.platform) {
  // Windows cannot open a directory with fs.open(..., 'r'). The data file is
  // already fsynced and renamed atomically; do not turn a successful commit
  // into an error merely because directory fsync is unavailable on Windows.
  if (platform === 'win32') return;
  const directory = await fs.open(dirname, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

// Durable demonstration adapter. One atomic file holds registrations, roster,
// operations and round snapshots: a partial draw cannot be saved. The exclusive
// lock coordinates independent server instances/processes sharing this file.
class JsonFileStore {
  constructor(filename, {seed, lockTimeoutMs = 10000} = {}) {
    this.filename = path.resolve(filename);
    this.seed = seed;
    this.lockTimeoutMs = lockTimeoutMs;
  }
  async transact({code, uid}, callback) {
    await fs.mkdir(path.dirname(this.filename), {recursive: true});
    const lockname = this.filename + '.lock';
    const deadline = Date.now() + this.lockTimeoutMs;
    let lock;
    while (!lock) {
      try { lock = await fs.open(lockname, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // Never steal a lock by age: a paused process could still be committing.
        if (Date.now() >= deadline) throw new DrawError('store-busy', 503);
        await pause(12);
      }
    }
    try {
      await lock.writeFile(JSON.stringify({pid: process.pid, acquiredAt: Date.now()}));
      let data;
      try { data = JSON.parse(await fs.readFile(this.filename, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (!this.seed) throw new DrawError('not-found', 404);
        data = structuredClone(this.seed);
        await this.persist(data);
      }
      const event = data.events?.[code];
      if (!event) throw new DrawError('not-found', 404);
      const aggregate = {...event, user: data.users?.[uid]};
      const output = await callback(aggregate);
      if (output.commit) {
        const updated = applyCommit(aggregate, output.commit);
        delete updated.user;
        data.events[code] = updated;
        await this.persist(data);
      }
      return output.result;
    } finally {
      await lock.close();
      await fs.unlink(lockname);
    }
  }
  async persist(data) {
    const temporary = this.filename + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(data, null, 2));
      await handle.sync();
      await handle.close(); handle = null;
      await fs.rename(temporary, this.filename);
      // Persist the directory entry too on platforms that support it.
      await syncParentDirectory(path.dirname(this.filename));
    } finally {
      if (handle) await handle.close();
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}

module.exports = {JsonFileStore, syncParentDirectory};

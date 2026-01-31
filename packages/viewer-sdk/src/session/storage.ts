/**
 * Session persistence for StreamLock viewer sessions
 */

import type { SessionInfo } from '@streamlock/common';

/** Serialized session for storage */
export interface SerializedSession {
  sessionId: string;
  videoId: string;
  viewerAddress: string;
  prepaidBalance: string; // bigint as string
  segmentsPaid: number;
  expiresAt: number;
  createdAt: number;
  lastUpdated: number;
}

/** Session storage interface */
export interface SessionStorage {
  /** Save a session */
  save(viewerAddress: string, session: SessionInfo): Promise<void>;

  /** Load a session for a specific video */
  load(videoId: bigint | string, viewerAddress: string): Promise<SessionInfo | null>;

  /** Load all active sessions for a viewer */
  loadAll(viewerAddress: string): Promise<SessionInfo[]>;

  /** Clear a specific session */
  clear(sessionId: bigint | string): Promise<void>;

  /** Clear all sessions for a viewer */
  clearAll(viewerAddress: string): Promise<void>;

  /** Clear expired sessions */
  clearExpired(): Promise<number>;
}

/** LocalStorage-based session storage */
export class LocalStorageSessionStorage implements SessionStorage {
  private readonly storageKey = 'streamlock_sessions';

  private getAll(): Map<string, SerializedSession> {
    if (typeof window === 'undefined') {
      return new Map();
    }

    try {
      const data = localStorage.getItem(this.storageKey);
      if (!data) return new Map();

      const parsed = JSON.parse(data) as Record<string, SerializedSession>;
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  private saveAll(sessions: Map<string, SerializedSession>): void {
    if (typeof window === 'undefined') return;

    const obj = Object.fromEntries(sessions);
    localStorage.setItem(this.storageKey, JSON.stringify(obj));
  }

  private serializeSession(
    viewerAddress: string,
    session: SessionInfo
  ): SerializedSession {
    return {
      sessionId: session.sessionId.toString(),
      videoId: session.videoId.toString(),
      viewerAddress,
      prepaidBalance: session.prepaidBalance.toString(),
      segmentsPaid: session.segmentsPaid,
      expiresAt: session.expiresAt,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };
  }

  private deserializeSession(serialized: SerializedSession): SessionInfo {
    return {
      sessionId: BigInt(serialized.sessionId),
      videoId: BigInt(serialized.videoId),
      prepaidBalance: BigInt(serialized.prepaidBalance),
      segmentsPaid: serialized.segmentsPaid,
      expiresAt: serialized.expiresAt,
    };
  }

  async save(viewerAddress: string, session: SessionInfo): Promise<void> {
    const sessions = this.getAll();
    const key = `${viewerAddress}:${session.videoId.toString()}`;
    sessions.set(key, this.serializeSession(viewerAddress, session));
    this.saveAll(sessions);
  }

  async load(
    videoId: bigint | string,
    viewerAddress: string
  ): Promise<SessionInfo | null> {
    const sessions = this.getAll();
    const key = `${viewerAddress}:${videoId.toString()}`;
    const serialized = sessions.get(key);

    if (!serialized) return null;

    // Check if expired
    const now = Math.floor(Date.now() / 1000);
    if (serialized.expiresAt < now) {
      // Clean up expired session
      sessions.delete(key);
      this.saveAll(sessions);
      return null;
    }

    return this.deserializeSession(serialized);
  }

  async loadAll(viewerAddress: string): Promise<SessionInfo[]> {
    const sessions = this.getAll();
    const result: SessionInfo[] = [];
    const now = Math.floor(Date.now() / 1000);
    let hasExpired = false;

    for (const [key, serialized] of sessions) {
      if (!key.startsWith(`${viewerAddress}:`)) continue;

      if (serialized.expiresAt < now) {
        sessions.delete(key);
        hasExpired = true;
        continue;
      }

      result.push(this.deserializeSession(serialized));
    }

    if (hasExpired) {
      this.saveAll(sessions);
    }

    return result;
  }

  async clear(sessionId: bigint | string): Promise<void> {
    const sessions = this.getAll();
    const sessionIdStr = sessionId.toString();

    for (const [key, serialized] of sessions) {
      if (serialized.sessionId === sessionIdStr) {
        sessions.delete(key);
        break;
      }
    }

    this.saveAll(sessions);
  }

  async clearAll(viewerAddress: string): Promise<void> {
    const sessions = this.getAll();

    for (const key of sessions.keys()) {
      if (key.startsWith(`${viewerAddress}:`)) {
        sessions.delete(key);
      }
    }

    this.saveAll(sessions);
  }

  async clearExpired(): Promise<number> {
    const sessions = this.getAll();
    const now = Math.floor(Date.now() / 1000);
    let count = 0;

    for (const [key, serialized] of sessions) {
      if (serialized.expiresAt < now) {
        sessions.delete(key);
        count++;
      }
    }

    if (count > 0) {
      this.saveAll(sessions);
    }

    return count;
  }
}

/** In-memory session storage (for SSR or testing) */
export class MemorySessionStorage implements SessionStorage {
  private sessions = new Map<string, SerializedSession>();

  private serializeSession(
    viewerAddress: string,
    session: SessionInfo
  ): SerializedSession {
    return {
      sessionId: session.sessionId.toString(),
      videoId: session.videoId.toString(),
      viewerAddress,
      prepaidBalance: session.prepaidBalance.toString(),
      segmentsPaid: session.segmentsPaid,
      expiresAt: session.expiresAt,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };
  }

  private deserializeSession(serialized: SerializedSession): SessionInfo {
    return {
      sessionId: BigInt(serialized.sessionId),
      videoId: BigInt(serialized.videoId),
      prepaidBalance: BigInt(serialized.prepaidBalance),
      segmentsPaid: serialized.segmentsPaid,
      expiresAt: serialized.expiresAt,
    };
  }

  async save(viewerAddress: string, session: SessionInfo): Promise<void> {
    const key = `${viewerAddress}:${session.videoId.toString()}`;
    this.sessions.set(key, this.serializeSession(viewerAddress, session));
  }

  async load(
    videoId: bigint | string,
    viewerAddress: string
  ): Promise<SessionInfo | null> {
    const key = `${viewerAddress}:${videoId.toString()}`;
    const serialized = this.sessions.get(key);

    if (!serialized) return null;

    const now = Math.floor(Date.now() / 1000);
    if (serialized.expiresAt < now) {
      this.sessions.delete(key);
      return null;
    }

    return this.deserializeSession(serialized);
  }

  async loadAll(viewerAddress: string): Promise<SessionInfo[]> {
    const result: SessionInfo[] = [];
    const now = Math.floor(Date.now() / 1000);

    for (const [key, serialized] of this.sessions) {
      if (!key.startsWith(`${viewerAddress}:`)) continue;

      if (serialized.expiresAt < now) {
        this.sessions.delete(key);
        continue;
      }

      result.push(this.deserializeSession(serialized));
    }

    return result;
  }

  async clear(sessionId: bigint | string): Promise<void> {
    const sessionIdStr = sessionId.toString();
    for (const [key, serialized] of this.sessions) {
      if (serialized.sessionId === sessionIdStr) {
        this.sessions.delete(key);
        break;
      }
    }
  }

  async clearAll(viewerAddress: string): Promise<void> {
    for (const key of this.sessions.keys()) {
      if (key.startsWith(`${viewerAddress}:`)) {
        this.sessions.delete(key);
      }
    }
  }

  async clearExpired(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    let count = 0;

    for (const [key, serialized] of this.sessions) {
      if (serialized.expiresAt < now) {
        this.sessions.delete(key);
        count++;
      }
    }

    return count;
  }
}

/** Get default session storage based on environment */
export function getDefaultSessionStorage(): SessionStorage {
  if (typeof window !== 'undefined') {
    return new LocalStorageSessionStorage();
  }
  return new MemorySessionStorage();
}

export class SessionManager {
    private static instance: SessionManager;
    private sessions: Map<string, SessionData>;

    private constructor() {
        this.sessions = new Map();
    }

    public static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }

    createSession(sessionId: string): void {
        this.sessions.set(sessionId, {
            phoneNumber: null,
            isPhoneVerified: false,
            lastInteraction: Date.now()
        });
    }

    setPhoneNumber(sessionId: string, phoneNumber: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.phoneNumber = phoneNumber;
            session.lastInteraction = Date.now();
        }
    }

    getPhoneNumber(sessionId: string): string | null {
        return this.sessions.get(sessionId)?.phoneNumber || null;
    }

    setPhoneVerified(sessionId: string, verified: boolean): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.isPhoneVerified = verified;
            session.lastInteraction = Date.now();
        }
    }

    isPhoneVerified(sessionId: string): boolean {
        return this.sessions.get(sessionId)?.isPhoneVerified || false;
    }

    removeSession(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    cleanupOldSessions(maxAge: number = 3600000): void { // Default 1 hour
        const now = Date.now();
        for (const [sessionId, session] of this.sessions.entries()) {
            if (now - session.lastInteraction > maxAge) {
                this.sessions.delete(sessionId);
            }
        }
    }
}

interface SessionData {
    phoneNumber: string | null;
    isPhoneVerified: boolean;
    lastInteraction: number;
} 
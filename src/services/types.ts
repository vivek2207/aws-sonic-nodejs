export interface KnowledgeBaseQuery {
    query: string;
    kbId: string;
    maxResults?: number;
}

export interface KnowledgeBaseResponse {
    results: KnowledgeBaseResult[];
    totalResults: number;
}

export interface KnowledgeBaseResult {
    content: string;
    score: number;
    metadata?: Record<string, any>;
}

export interface KnowledgeBaseError {
    code: string;
    message: string;
    details?: any;
} 
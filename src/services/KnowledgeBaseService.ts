import { BedrockAgentRuntimeClient, RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { fromIni } from "@aws-sdk/credential-providers";
import { KnowledgeBaseQuery, KnowledgeBaseResponse, KnowledgeBaseError } from './types';

export class KnowledgeBaseService {
    private client: BedrockAgentRuntimeClient;
    private defaultKbId: string;

    constructor(kbId: string, region: string = "us-east-1") {
        this.defaultKbId = kbId;
        this.client = new BedrockAgentRuntimeClient({
            region,
            credentials: fromIni({ profile: 'default' })
        });
    }

    async query(query: string, maxResults: number = 3): Promise<KnowledgeBaseResponse> {
        try {
            const command = new RetrieveCommand({
                knowledgeBaseId: this.defaultKbId,
                retrievalQuery: {
                    text: query
                },
                retrievalConfiguration: {
                    vectorSearchConfiguration: {
                        numberOfResults: maxResults
                    }
                }
            });

            const response = await this.client.send(command);
            
            return {
                results: response.retrievalResults?.map(result => ({
                    content: result.content?.text || '',
                    score: result.score || 0,
                    metadata: result.metadata
                })) || [],
                totalResults: response.retrievalResults?.length || 0
            };
        } catch (error) {
            const kbError: KnowledgeBaseError = {
                code: 'KB_QUERY_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred',
                details: error
            };
            throw kbError;
        }
    }

    async formatResponse(response: KnowledgeBaseResponse): Promise<string> {
        if (response.totalResults === 0) {
            return "I apologize, but I couldn't find any relevant information in the knowledge base for your query.";
        }

        // Get the most relevant result (highest score)
        const mostRelevantResult = response.results.reduce((prev, current) => 
            (current.score > prev.score) ? current : prev
        );

        // Extract just the relevant information from the content
        const content = mostRelevantResult.content;
        
        // If the content contains "Based on the available information:", remove it and everything before it
        const cleanedContent = content.split("Based on the available information:")[1]?.trim() || content;
        
        // Take only the first relevant sentence or paragraph
        const firstParagraph = cleanedContent.split('\n\n')[0];
        
        // If the paragraph is too long, take just the first sentence
        if (firstParagraph.length > 200) {
            const firstSentence = firstParagraph.split('.')[0] + '.';
            return firstSentence;
        }

        return firstParagraph;
    }
} 
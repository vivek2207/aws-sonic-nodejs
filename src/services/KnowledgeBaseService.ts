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

    async query(query: string, maxResults: number = 10): Promise<KnowledgeBaseResponse> {
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
            
            console.log(`Raw KB response for query "${query}":`, 
                JSON.stringify(response.retrievalResults?.map(r => ({
                    content: r.content?.text?.substring(0, 100) + '...',
                    score: r.score
                })) || []));
            
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

        // Combine all content from all results, regardless of score
        const allContent = response.results.map(r => r.content).join(' ');
        console.log("Content being searched for facts:", allContent.substring(0, 300) + "...");
        
        // Check for loan amount related queries in the combined content
        const loanAmountInfo = this.extractLoanAmountInfo(allContent);
        if (loanAmountInfo) {
            console.log("Extracted loan amount info:", loanAmountInfo);
            return loanAmountInfo;
        }
        
        // Extract important facts from all results
        // Look for known patterns in the combined content
        const patterns = [
            { name: 'Minimum age', regex: /[Mm]inimum\s+age(?:\s+requirement)?(?:\s+is)?:\s*(\d+)\s*years?/, format: (val: string) => `Minimum age: ${val} years` },
            { name: 'CIBIL score', regex: /CIBIL score(?:\s+of)?:\s*(\d+\+?)/, format: (val: string) => `Required credit score: ${val}` },
            { name: 'Loan amount min', regex: /[Mm]inimum(?:\s+loan\s+amount)?:\s*(?:INR|Rs\.?|₹)\s*([\d,]+)/, format: (val: string) => `Minimum loan amount: ₹${val}` },
            { name: 'Loan amount max', regex: /[Mm]aximum(?:\s+loan\s+amount)?:\s*(?:INR|Rs\.?|₹)\s*([\d,]+)/, format: (val: string) => `Maximum loan amount: ₹${val}` },
            { name: 'Interest rate', regex: /[Ii]nterest\s+[Rr]ate(?:\s+range)?:.*?(\d+(?:\.\d+)?%.*?\d+(?:\.\d+)?%)/, format: (val: string) => `Interest rate: ${val}` },
            { name: 'Repayment period', regex: /[Rr]epayment\s+[Pp]eriod:.*?(\d+\s*months.*?\d+\s*months)/, format: (val: string) => `Repayment period: ${val}` },
            { name: 'Processing fee', regex: /[Pp]rocessing\s+[Ff]ee:.*?(\d+%.*?\d+%)/, format: (val: string) => `Processing fee: ${val}` }
        ];
        
        // Extract all facts we can find
        const facts = [];
        
        for (const pattern of patterns) {
            const match = allContent.match(pattern.regex);
            if (match && match[1]) {
                facts.push(pattern.format(match[1]));
            }
        }
        
        // If we found specific facts, return them all
        if (facts.length > 0) {
            return facts.join('. ');
        }
        
        // Look for sections that match the query
        const relevantSections = this.extractRelevantSections(allContent);
        if (relevantSections.length > 0) {
            return relevantSections.join('. ');
        }
        
        // Fallback to first paragraph from most relevant result
        const mostRelevantResult = response.results[0];
        const content = mostRelevantResult.content;
        
        // If the content contains "Based on the available information:", remove it and everything before it
        const cleanedContent = content.split("Based on the available information:")[1]?.trim() || content;
        
        // Take only the first relevant paragraph
        const firstParagraph = cleanedContent.split('\n\n')[0];
        return firstParagraph;
    }

    // Helper method to extract relevant sections
    private extractRelevantSections(content: string): string[] {
        const relevantSections = [];
        
        // Look for labeled sections that are common in banking information
        const sectionHeaders = [
            'Eligibility Criteria:',
            'Loan Amount Range:',
            'Interest Rates and Charges:',
            'Repayment Period:',
            'Processing Fee:',
            'Late Payment Penalties:'
        ];
        
        for (const header of sectionHeaders) {
            if (content.includes(header)) {
                // Find the section content
                const startIndex = content.indexOf(header);
                // Find end of this section (next header or end of content)
                let endIndex = content.length;
                
                for (const nextHeader of sectionHeaders) {
                    if (nextHeader !== header) {
                        const nextHeaderIndex = content.indexOf(nextHeader, startIndex + header.length);
                        if (nextHeaderIndex > startIndex && nextHeaderIndex < endIndex) {
                            endIndex = nextHeaderIndex;
                        }
                    }
                }
                
                // Extract the section
                const section = content.substring(startIndex, endIndex).trim();
                relevantSections.push(section);
            }
        }
        
        return relevantSections;
    }

    // Specialized method to extract loan amount information
    private extractLoanAmountInfo(content: string): string | null {
        console.log("Checking for loan amount info");
        
        // Instead of extracting loan info from KB content, 
        // we'll return null since this information is now available in the system prompt
        // This allows the LLM to use the internal reference information for responses
        
        // Check if this is a query about loan amounts or eligibility
        const loanAmountPattern = /loan\s+amount|eligibility|interest\s+rate|credit\s+score|minimum\s+loan|maximum\s+loan/i;
        if (content.match(loanAmountPattern)) {
            // Return null to let the model formulate response based on system prompt
            return null;
        }
        
        return null;
    }
} 
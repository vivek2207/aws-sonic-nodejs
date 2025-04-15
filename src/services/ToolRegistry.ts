import { KnowledgeBaseService } from './KnowledgeBaseService';

export interface Tool {
    name: string;
    description: string;
    execute: (query: string) => Promise<string>;
}

export class ToolRegistry {
    private tools: Map<string, Tool> = new Map();
    private kbService: KnowledgeBaseService;

    constructor(kbService: KnowledgeBaseService) {
        this.kbService = kbService;
        this.registerDefaultTools();
    }

    private registerDefaultTools() {
        // Register the banking information tool
        this.registerTool({
            name: 'banking_info',
            description: 'Retrieves general banking information from the knowledge base',
            execute: async (query: string) => {
                try {
                    const response = await this.kbService.query(query);
                    return await this.kbService.formatResponse(response);
                } catch (error) {
                    console.error('Error in banking_info tool:', error);
                    return 'I encountered an error while retrieving banking information. Please try again.';
                }
            }
        });
    }

    registerTool(tool: Tool) {
        this.tools.set(tool.name, tool);
    }

    async executeTool(toolName: string, query: string): Promise<string> {
        const tool = this.tools.get(toolName);
        if (!tool) {
            return `Tool '${toolName}' not found.`;
        }
        return await tool.execute(query);
    }

    getToolDescriptions(): string[] {
        return Array.from(this.tools.values()).map(tool => 
            `${tool.name}: ${tool.description}`
        );
    }
} 
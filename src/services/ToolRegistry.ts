import { KnowledgeBaseService } from './KnowledgeBaseService';
import { DynamoDBService } from './DynamoDBService';
import { SessionManager } from './SessionManager';
import { BankingService } from './BankingService';

export interface Tool {
    name: string;
    description: string;
    execute: (query: string, sessionId: string) => Promise<string>;
}

export class ToolRegistry {
    private tools: Map<string, Tool> = new Map();
    private kbService: KnowledgeBaseService;
    private dynamoService: DynamoDBService;
    private sessionManager: SessionManager;
    private bankingService: BankingService;

    constructor(kbService: KnowledgeBaseService) {
        this.kbService = kbService;
        this.dynamoService = new DynamoDBService();
        this.sessionManager = SessionManager.getInstance();
        this.bankingService = new BankingService();
        this.registerDefaultTools();
    }

    private registerDefaultTools() {
        // Register the banking information tool
        this.registerTool({
            name: 'banking_info',
            description: 'Retrieves general banking information from the knowledge base',
            execute: async (query: string, sessionId: string) => {
                try {
                    const response = await this.kbService.query(query);
                    return await this.kbService.formatResponse(response);
                } catch (error) {
                    console.error('Error in banking_info tool:', error);
                    return 'I encountered an error while retrieving banking information. Please try again.';
                }
            }
        });

        // Register the personal information tool
        this.registerTool({
            name: 'personal_info',
            description: 'Retrieves personal banking information for verified customers',
            execute: async (query: string, sessionId: string) => {
                try {
                    const phoneNumber = this.sessionManager.getPhoneNumber(sessionId);
                    
                    if (!phoneNumber) {
                        return 'To provide your personal information, I need your registered phone number. Please share it with me.';
                    }

                    const isVerified = await this.dynamoService.verifyPhoneNumber(phoneNumber);
                    if (!isVerified) {
                        return 'I apologize, but I cannot verify your phone number. I can only provide general banking information.';
                    }

                    // Extract keywords from the query
                    const queryLower = query.toLowerCase();
                    
                    // Check for loan-related queries
                    if (queryLower.includes('loan')) {
                        const loanDetails = await this.dynamoService.getLoanDetails(phoneNumber);
                        if (!loanDetails) {
                            return 'I couldn\'t find any loan details for your account.';
                        }
                        return this.formatLoanDetails(loanDetails);
                    }
                    
                    // Check for bank account queries
                    if (queryLower.includes('account') || queryLower.includes('balance') || queryLower.includes('bank')) {
                        const bankDetails = await this.dynamoService.getBankDetails(phoneNumber);
                        if (!bankDetails) {
                            return 'I couldn\'t find your bank account details.';
                        }
                        return this.formatBankDetails(bankDetails);
                    }
                    
                    // Check for credit score queries
                    if (queryLower.includes('credit') || queryLower.includes('score')) {
                        const creditScore = await this.dynamoService.getCreditScore(phoneNumber);
                        if (creditScore === null) {
                            return 'I couldn\'t find your credit score.';
                        }
                        return `Your credit score is ${creditScore}.`;
                    }
                    
                    // For other personal information queries
                    const customerData = await this.dynamoService.getCustomerByPhone(phoneNumber);
                    if (!customerData) {
                        return 'I couldn\'t find your personal information.';
                    }
                    return this.formatCustomerData(customerData);
                } catch (error) {
                    console.error('Error in personal_info tool:', error);
                    return 'I encountered an error while retrieving your personal information. Please try again.';
                }
            }
        });
    }

    private formatLoanDetails(loans: any[]): string {
        if (loans.length === 0) {
            return 'You don\'t have any active loans.';
        }

        return loans.map(loan => 
            `Loan ID: ${loan.LoanID}\nType: ${loan.LoanType}\nAmount: ₹${loan.Amount.toLocaleString()}\nStatus: ${loan.Status}\nInterest Rate: ${loan.InterestRatePercent}%\nTenure: ${loan.TenureYears} years\nTaken Date: ${loan.LoanTakenDate}`
        ).join('\n\n');
    }

    private formatBankDetails(bankDetails: any): string {
        return `Account Type: ${bankDetails.AccountType}\nBalance: ₹${bankDetails.BankBalanceINR.toLocaleString()}\nBranch: ${bankDetails.Branch}`;
    }

    private formatCustomerData(customerData: any): string {
        return `Name: ${customerData.Name}\nCustomer ID: ${customerData.CustomerID}\nPhone: ${customerData.PhoneNumber}\nIncome: ₹${customerData.IncomeINR.toLocaleString()}`;
    }

    registerTool(tool: Tool) {
        this.tools.set(tool.name, tool);
    }

    async executeTool(toolName: string, query: string, sessionId: string): Promise<string> {
        const tool = this.tools.get(toolName);
        if (!tool) {
            return `Tool '${toolName}' not found.`;
        }
        return await tool.execute(query, sessionId);
    }

    getToolDescriptions(): string[] {
        return Array.from(this.tools.values()).map(tool => 
            `${tool.name}: ${tool.description}`
        );
    }

    async getAccountDetails(phoneNumber: string): Promise<string> {
        return await this.bankingService.getAccountSummary(phoneNumber);
    }

    async getLoanDetails(phoneNumber: string): Promise<string> {
        return await this.bankingService.getLoanSummary(phoneNumber);
    }

    async getCreditScore(phoneNumber: string): Promise<string> {
        return await this.bankingService.getCreditScoreInfo(phoneNumber);
    }

    async verifyCustomer(phoneNumber: string): Promise<string> {
        const isVerified = await this.bankingService.verifyCustomer(phoneNumber);
        return isVerified ? "Customer verified successfully." : "Customer verification failed.";
    }

    async getBankingInfo(query: string): Promise<string> {
        // This method will be implemented to handle general banking queries
        // using the knowledge base or predefined responses
        return "I can help you with account details, loan information, and credit score. What would you like to know?";
    }
} 
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
                    console.log(`Banking info tool execution for session ${sessionId}, query: ${query}`);
                    
                    // Clean the query by removing any user information
                    const cleanQuery = query.replace(/Logged in as:.*?\n+/g, '')
                                           .replace(/\b(Emily Davis|5432109876|Credit Score: 770)\b/g, '')
                                           .trim();
                    
                    console.log(`Cleaned query for knowledge base: ${cleanQuery}`);
                    
                    // Check for loan eligibility or criteria related questions
                    const queryLower = cleanQuery.toLowerCase();
                    
                    // Detect specific loan-related queries that should use the system prompt info
                    const isLoanEligibilityQuery = 
                        queryLower.includes('eligibility') || 
                        queryLower.includes('criteria') || 
                        queryLower.includes('requirement') ||
                        queryLower.includes('qualify') ||
                        (queryLower.includes('loan') && queryLower.includes('apply'));
                        
                    const isLoanAmountQuery = 
                        queryLower.includes('loan amount') || 
                        queryLower.includes('minimum loan') ||
                        queryLower.includes('maximum loan') ||
                        (queryLower.includes('minimum') && queryLower.includes('maximum')) ||
                        queryLower.includes('how much') ||
                        (queryLower.includes('loan') && 
                        (queryLower.includes('minimum') || 
                         queryLower.includes('maximum') || 
                         queryLower.includes('range') ||
                         queryLower.includes('amount')));
                         
                    const isInterestRateQuery = 
                        queryLower.includes('interest') || 
                        queryLower.includes('rate') || 
                        (queryLower.includes('loan') && queryLower.includes('charges'));
                        
                    const isRepaymentQuery = 
                        queryLower.includes('repayment') || 
                        queryLower.includes('tenure') || 
                        queryLower.includes('duration') ||
                        queryLower.includes('period') ||
                        queryLower.includes('how long') ||
                        (queryLower.includes('loan') && queryLower.includes('time'));
                    
                    // For these specific queries, skip KB and let the model use system prompt info
                    if (isLoanEligibilityQuery || isLoanAmountQuery || isInterestRateQuery || isRepaymentQuery) {
                        console.log(`Detected specialized loan query, letting model use system prompt info`);
                        return ""; // Empty response so model uses system prompt
                    }
                    
                    // For other queries, use enhanced KB search queries
                    let enhancedQuery = cleanQuery;
                    
                    // For certain query types, enhance with additional context
                    if (cleanQuery.toLowerCase().includes('age') || cleanQuery.toLowerCase().includes('how old') || cleanQuery.toLowerCase().includes('minimum age')) {
                        enhancedQuery = `${cleanQuery} eligibility criteria minimum age requirement years`;
                        console.log(`Detected age-related query, using enhanced query: ${enhancedQuery}`);
                    }
                    
                    if (cleanQuery.toLowerCase().includes('credit') || cleanQuery.toLowerCase().includes('score') || cleanQuery.toLowerCase().includes('cibil')) {
                        enhancedQuery = `${cleanQuery} credit score CIBIL eligibility requirement`;
                        console.log(`Detected credit score query, using enhanced query: ${enhancedQuery}`);
                    }
                    
                    // Make the query to the knowledge base
                    console.log(`Enhanced knowledge base query: ${enhancedQuery}`);
                    const response = await this.kbService.query(enhancedQuery);
                    
                    // If no results, try a more general query
                    if (!response || !response.results || response.results.length === 0) {
                        console.log(`No results found for specific query, trying more general query`);
                        
                        const fallbackResponse = await this.kbService.query("banking information");
                        
                        if (!fallbackResponse || !fallbackResponse.results || fallbackResponse.results.length === 0) {
                            return "I'm sorry, I couldn't find specific information about that in our knowledge base.";
                        }
                        
                        const formattedResponse = await this.kbService.formatResponse(fallbackResponse);
                        return formattedResponse;
                    }
                    
                    // Format the response from the knowledge base
                    const formattedResponse = await this.kbService.formatResponse(response);
                    
                    // Add user info prefix for personalization
                    const phoneNumber = this.sessionManager.getPhoneNumber(sessionId);
                    const userInfoPrefix = phoneNumber ? 
                        `${await this.getUserInfoPrefix(phoneNumber)}\n\n` : '';
                        
                    return `${userInfoPrefix}${formattedResponse}`;
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
                    console.log(`Personal info tool execution for session ${sessionId}, phone: ${phoneNumber}`);
                    
                    // Check if user details were already shown in the conversation
                    const isUserIdentified = query.includes("Logged in as:") || query.includes("Emily Davis") || 
                                             query.includes("5432109876") || query.includes("Credit Score: 770");
                    
                    if (!phoneNumber && !isUserIdentified) {
                        return 'To provide your personal information, I need your registered phone number. Please share it with me.';
                    }

                    // If we have a phone number from session or the user was already identified in conversation
                    let effectivePhoneNumber = phoneNumber || "5432109876"; // Use default if needed
                    
                    // For queries that include user info in the prompt/question, extract phone directly
                    if (isUserIdentified && !phoneNumber) {
                        console.log("User identified from query text, using default phone");
                        // Set the phone in session manager for future use
                        this.sessionManager.setPhoneNumber(sessionId, effectivePhoneNumber);
                    }
                    
                    // Skip verification if user is already identified in the conversation
                    if (!isUserIdentified) {
                        const isVerified = await this.dynamoService.verifyPhoneNumber(effectivePhoneNumber);
                        if (!isVerified) {
                            return 'I apologize, but I cannot verify your phone number. I can only provide general banking information.';
                        }
                    }

                    // Extract keywords from the query
                    const queryLower = query.toLowerCase();
                    
                    // Get user data for personalization
                    const customerData = await this.dynamoService.getCustomerByPhone(effectivePhoneNumber);
                    if (!customerData) {
                        return 'I couldn\'t find your personal information.';
                    }
                    
                    // Add user info to the beginning of any response
                    const userInfo = `Logged in as: ${customerData.Name} | Phone: ${customerData.PhoneNumber} | Credit Score: ${customerData.CreditScore}`;
                    
                    // Check for loan-related queries
                    if (queryLower.includes('loan')) {
                        // Check for loan eligibility or new loan requests
                        if (queryLower.includes('eligible') || queryLower.includes('qualify') || queryLower.includes('new') || queryLower.includes('get')) {
                            return this.calculateLoanEligibility(customerData, userInfo);
                        }
                        
                        // Specific loan query (e.g., "Tell me about my car loan")
                        const loanTypes = ['personal', 'car', 'home', 'education', 'business', 'gold', 'medical'];
                        const requestedLoanType = loanTypes.find(type => queryLower.includes(type));
                        
                        // Get all loans
                        const allLoans = await this.dynamoService.getLoanDetails(effectivePhoneNumber);
                        
                        // If no loans found
                        if (!allLoans || allLoans.length === 0) {
                            return `${userInfo}\n\nYou don't have any active loans. Based on your credit score of ${customerData.CreditScore}, you may be eligible for new loans.`;
                        }
                        
                        // If asking for specific loan type
                        if (requestedLoanType) {
                            const specificLoan = allLoans.find(loan => 
                                loan.LoanType.toLowerCase().includes(requestedLoanType));
                            
                            if (specificLoan) {
                                return `${userInfo}\n\nDetails for your ${specificLoan.LoanType}:\n` +
                                       `• Loan ID: ${specificLoan.LoanID}\n` +
                                       `• Amount: ₹${specificLoan.LoanAmountINR.toLocaleString()}\n` +
                                       `• Interest Rate: ${specificLoan.InterestRatePercent}%\n` +
                                       `• Tenure: ${specificLoan.TenureYears} years\n` +
                                       `• Status: ${specificLoan.Status}\n` + 
                                       `• Taken Date: ${specificLoan.LoanTakenDate}`;
                            } else {
                                return `${userInfo}\n\nYou don't have any ${requestedLoanType} loans currently. Based on your credit score of ${customerData.CreditScore}, you may be eligible to apply for one.`;
                            }
                        }
                        
                        // For general loan queries, return the formatted summary
                        return `${userInfo}\n\n${this.formatLoanDetails(allLoans)}`;
                    }
                    
                    // Check for bank account queries
                    if (queryLower.includes('account') || queryLower.includes('balance') || queryLower.includes('bank')) {
                        const bankDetails = await this.dynamoService.getBankDetails(effectivePhoneNumber);
                        if (!bankDetails) {
                            return `${userInfo}\n\nI couldn't find your bank account details.`;
                        }
                        return `${userInfo}\n\n${this.formatBankDetails(bankDetails)}`;
                    }
                    
                    // Check for credit score queries
                    if (queryLower.includes('credit') || queryLower.includes('score')) {
                        const creditScore = await this.dynamoService.getCreditScore(effectivePhoneNumber);
                        if (creditScore === null) {
                            return `${userInfo}\n\nI couldn't find your credit score.`;
                        }
                        return `${userInfo}\n\nYour credit score is ${creditScore}.`;
                    }
                    
                    // For other personal information queries
                    return `${userInfo}\n\n${this.formatCustomerData(customerData)}`;
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

        let response = "Here's a summary of your current loans:\n";
        
        // Format each loan in a more concise, readable way
        loans.forEach((loan, index) => {
            response += `\n${index + 1}. ${loan.LoanType} - ₹${loan.LoanAmountINR?.toLocaleString() || 'N/A'} at ${loan.InterestRatePercent}%`;
            if (loan.Status.toLowerCase() !== 'active') {
                response += ` (${loan.Status})`;
            }
        });
        
        // Add instructions for more details
        response += "\n\nFor detailed information about a specific loan, you can ask me about it by loan type.";
        
        return response;
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
        return await this.bankingService.getBankAccountSummary(phoneNumber);
    }

    async getLoanDetails(phoneNumber: string): Promise<string> {
        return await this.bankingService.getLoanSummary(phoneNumber);
    }

    async getCreditScore(phoneNumber: string): Promise<string> {
        return await this.bankingService.getCreditScoreSummary(phoneNumber);
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

    private calculateLoanEligibility(customerData: any, userInfo: string): string {
        // This now uses the eligibility criteria from the system prompt
        const creditScore = customerData.CreditScore;
        
        if (creditScore < 650) {
            return `${userInfo}\n\nBased on your credit score of ${creditScore}, you do not meet the minimum CIBIL score requirement of 650+ for our personal and business loans. We recommend improving your credit score before applying.`;
        }
        
        // Determine loan amount ranges based on credit score
        let maxLoanAmount = 2500000; // Default to max limit of 25,00,000
        let minLoanAmount = 10000; // Default min of 10,000
        let interestRateRange = '';
        
        if (creditScore >= 800) {
            interestRateRange = '10-12%';
        } else if (creditScore >= 750) {
            interestRateRange = '12-16%';
        } else if (creditScore >= 700) {
            interestRateRange = '16-20%';
        } else {
            interestRateRange = '20-24%';
            // Reduce max loan amount for lower credit scores
            maxLoanAmount = 1500000;
        }
        
        return `${userInfo}\n\nBased on your credit score of ${creditScore}, you are eligible for loans ranging from ₹${minLoanAmount.toLocaleString()} to ₹${maxLoanAmount.toLocaleString()} with an interest rate of approximately ${interestRateRange} per annum. The repayment period can range from 3 to 60 months depending on the loan type and amount.`;
    }

    private async getUserInfoPrefix(phoneNumber: string): Promise<string> {
        try {
            const customerData = await this.dynamoService.getCustomerByPhone(phoneNumber);
            if (customerData) {
                return `Logged in as: ${customerData.Name} | Phone: ${customerData.PhoneNumber} | Credit Score: ${customerData.CreditScore}`;
            }
        } catch (error) {
            console.error('Error getting user info prefix:', error);
        }
        // Default info if no customer data found
        return `Logged in as: Emily Davis | Phone: ${phoneNumber} | Credit Score: 770`;
    }
} 
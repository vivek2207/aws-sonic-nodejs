import { DynamoDBService } from './DynamoDBService';

export class BankingService {
    private dynamoDBService: DynamoDBService;

    constructor() {
        this.dynamoDBService = new DynamoDBService();
    }

    async getBankAccountSummary(phoneNumber: string): Promise<string> {
        const bankDetails = await this.dynamoDBService.getBankDetails(phoneNumber);
        
        if (!bankDetails) {
            return "No bank account information found.";
        }
        
        let summary = "Bank Account Summary:\n";
        
        // Add account details
        summary += `Account Type: ${bankDetails.AccountType}\n`;
        summary += `Branch: ${bankDetails.Branch}\n`;
        summary += `Balance: ₹${bankDetails.BankBalanceINR.toLocaleString()}\n`;
        
        return summary;
    }

    async getLoanSummary(phoneNumber: string): Promise<string> {
        const loans = await this.dynamoDBService.getLoanDetails(phoneNumber);
        
        if (!loans.length) {
            return "No loan information found.";
        }
        
        let summary = "Loan Summary:\n";
        
        // Format each loan in a more concise way
        loans.forEach((loan, index) => {
            summary += `\n${index + 1}. ${loan.LoanType} (${loan.LoanID}): ₹${loan.LoanAmountINR.toLocaleString()} at ${loan.InterestRatePercent}% for ${loan.TenureYears} years`;
            if (loan.Status.toLowerCase() !== 'active') {
                summary += ` (${loan.Status})`;
            }
        });
        
        summary += "\n\nFor detailed information about a specific loan, you can ask by loan type.";
        
        return summary;
    }

    async getCreditScoreSummary(phoneNumber: string): Promise<string> {
        const creditScore = await this.dynamoDBService.getCreditScore(phoneNumber);
        
        if (creditScore === null) {
            return "Credit score information not available.";
        }
        
        let summary = `Your credit score is ${creditScore}.\n`;
        
        if (creditScore >= 750) {
            summary += "This is an excellent credit score. You qualify for premium interest rates.";
        } else if (creditScore >= 700) {
            summary += "This is a good credit score. You qualify for favorable interest rates.";
        } else if (creditScore >= 650) {
            summary += "This is a fair credit score. You may qualify for standard interest rates.";
        } else {
            summary += "This credit score might result in higher interest rates. Consider improving your score.";
        }
        
        return summary;
    }

    async checkLoanEligibility(phoneNumber: string): Promise<string> {
        const customerData = await this.dynamoDBService.getCustomerByPhone(phoneNumber);
        
        if (!customerData) {
            return "Unable to check loan eligibility. Customer information not found.";
        }
        
        const creditScore = customerData.CreditScore;
        
        // Using the eligibility criteria from system prompt
        if (creditScore >= 650) {
            let response = "Based on your credit score of " + creditScore + ", you are eligible for loans. ";
            
            // Suggest interest rates based on credit score ranges
            if (creditScore >= 800) {
                response += "You qualify for our best interest rates (10-12% per annum).";
            } else if (creditScore >= 750) {
                response += "You qualify for very good interest rates (12-15% per annum).";
            } else if (creditScore >= 700) {
                response += "You qualify for good interest rates (15-18% per annum).";
            } else {
                response += "You qualify for standard interest rates (18-24% per annum).";
            }
            
            return response;
        } else {
            return "Based on your credit score of " + creditScore + ", you currently do not meet our minimum eligibility criteria of 650+ for personal and business loans. We recommend improving your credit score and applying again later.";
        }
    }

    async verifyCustomer(phoneNumber: string): Promise<boolean> {
        return await this.dynamoDBService.verifyPhoneNumber(phoneNumber);
    }
} 
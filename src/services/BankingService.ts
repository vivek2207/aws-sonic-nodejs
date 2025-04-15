import { DynamoDBService } from './DynamoDBService';

export class BankingService {
    private dynamoDBService: DynamoDBService;

    constructor() {
        this.dynamoDBService = new DynamoDBService();
    }

    async getAccountSummary(phoneNumber: string): Promise<string> {
        const bankDetails = await this.dynamoDBService.getBankDetails(phoneNumber);
        if (!bankDetails.length) {
            return "No bank accounts found for this phone number.";
        }

        let summary = "Here are your bank account details:\n";
        bankDetails.forEach(account => {
            summary += `\nBank: ${account.BankName}\n`;
            summary += `Account Number: ${account.AccountNumber}\n`;
            summary += `IFSC Code: ${account.IFSCCode}\n`;
            summary += `Account Type: ${account.AccountType}\n`;
        });

        return summary;
    }

    async getLoanSummary(phoneNumber: string): Promise<string> {
        const loans = await this.dynamoDBService.getLoanDetails(phoneNumber);
        if (!loans.length) {
            return "No active loans found for this phone number.";
        }

        let summary = "Here are your loan details:\n";
        loans.forEach(loan => {
            summary += `\nLoan ID: ${loan.LoanID}\n`;
            summary += `Type: ${loan.LoanType}\n`;
            summary += `Amount: ₹${loan.Amount}\n`;
            summary += `Status: ${loan.Status}\n`;
            summary += `Due Date: ${loan.DueDate}\n`;
        });

        return summary;
    }

    async getCreditScoreInfo(phoneNumber: string): Promise<string> {
        const creditScore = await this.dynamoDBService.getCreditScore(phoneNumber);
        if (creditScore === null) {
            return "Unable to retrieve credit score information.";
        }

        let scoreInfo = `Your credit score is ${creditScore}.\n`;
        if (creditScore >= 750) {
            scoreInfo += "This is an excellent score. You are eligible for most banking products.";
        } else if (creditScore >= 650) {
            scoreInfo += "This is a good score. You are eligible for most standard banking products.";
        } else if (creditScore >= 550) {
            scoreInfo += "This is a fair score. You may be eligible for some banking products with higher interest rates.";
        } else {
            scoreInfo += "This score needs improvement. You may face challenges in getting new credit.";
        }

        return scoreInfo;
    }

    async verifyCustomer(phoneNumber: string): Promise<boolean> {
        return await this.dynamoDBService.verifyPhoneNumber(phoneNumber);
    }
} 
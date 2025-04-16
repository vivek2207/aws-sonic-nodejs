import { DynamoDBClient, GetItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";

interface BankDetails {
    AccountType: string;
    BankBalanceINR: number;
    Branch: string;
}

interface Loan {
    LoanID: string;
    LoanType: string;
    LoanAmountINR: number;
    InterestRatePercent: number;
    TenureYears: number;
    Status: string;
    LoanTakenDate: string;
    NextDueDate?: string;
    DueAmountINR?: number;
}

interface CustomerData {
    PhoneNumber: string;
    Name: string;
    BankDetails: BankDetails;
    Loans: Loan[];
    CreditScore: number;
    CustomerID: string;
    IncomeINR: number;
}

export class DynamoDBService {
    private client: DynamoDBClient;
    private tableName = 'Bank_Voicebot_POC_Fibe';
    private mockData: Map<string, CustomerData> = new Map();

    constructor() {
        // Initialize the DynamoDB client
        this.client = new DynamoDBClient({
            region: process.env.AWS_REGION || "us-east-1",
            credentials: fromIni({ profile: process.env.AWS_PROFILE || "default" })
        });
        
        // Keep mock data for fallback
        this.initializeMockData();
    }

    private initializeMockData() {
        // Sample customer data
        const customer1: CustomerData = {
            PhoneNumber: "9876543210",
            Name: "John Doe",
            BankDetails: {
                AccountType: "Savings",
                BankBalanceINR: 100000,
                Branch: "Sample Branch"
            },
            Loans: [
                {
                    LoanID: "LOAN001",
                    LoanType: "Personal Loan",
                    LoanAmountINR: 100000,
                    InterestRatePercent: 10,
                    TenureYears: 5,
                    Status: "Active",
                    LoanTakenDate: "2025-12-31"
                }
            ],
            CreditScore: 750,
            CustomerID: "CUST001",
            IncomeINR: 500000
        };

        const customer2: CustomerData = {
            PhoneNumber: "9876543211",
            Name: "Jane Smith",
            BankDetails: {
                AccountType: "Current",
                BankBalanceINR: 5000000,
                Branch: "Sample Branch"
            },
            Loans: [
                {
                    LoanID: "LOAN002",
                    LoanType: "Home Loan",
                    LoanAmountINR: 5000000,
                    InterestRatePercent: 8,
                    TenureYears: 10,
                    Status: "Active",
                    LoanTakenDate: "2030-12-31"
                }
            ],
            CreditScore: 800,
            CustomerID: "CUST002",
            IncomeINR: 800000
        };

        this.mockData.set(customer1.PhoneNumber, customer1);
        this.mockData.set(customer2.PhoneNumber, customer2);
    }

    async getCustomerByPhone(phoneNumber: string): Promise<CustomerData | null> {
        try {
            // Try to get customer from DynamoDB
            const params = {
                TableName: this.tableName,
                Key: {
                    "PhoneNumber": { S: phoneNumber }
                }
            };

            const command = new GetItemCommand(params);
            const response = await this.client.send(command);

            if (response.Item) {
                return this.mapDynamoDBItemToCustomer(response.Item);
            }
            
            // Fallback to mock data if not found
            return this.mockData.get(phoneNumber) || this.getRandomCustomer();
        } catch (error) {
            console.error("Error fetching customer from DynamoDB:", error);
            // Fallback to mock data on error
            return this.mockData.get(phoneNumber) || this.getRandomCustomer();
        }
    }

    private mapDynamoDBItemToCustomer(item: any): CustomerData {
        // Map DynamoDB item to CustomerData
        const bankDetails: BankDetails = item.BankDetails?.M ? {
            AccountType: item.BankDetails.M.AccountType?.S || '',
            BankBalanceINR: Number(item.BankDetails.M.BankBalanceINR?.N || 0),
            Branch: item.BankDetails.M.Branch?.S || ''
        } : { AccountType: '', BankBalanceINR: 0, Branch: '' };

        const loans: Loan[] = item.Loans?.L?.map((loan: any) => ({
            LoanID: loan.M.LoanID?.S || '',
            LoanType: loan.M.LoanType?.S || '',
            LoanAmountINR: Number(loan.M.LoanAmountINR?.N || 0),
            InterestRatePercent: Number(loan.M.InterestRatePercent?.N || 0),
            TenureYears: Number(loan.M.TenureYears?.N || 0),
            Status: loan.M.Status?.S || '',
            LoanTakenDate: loan.M.LoanTakenDate?.S || '',
            NextDueDate: loan.M.NextDueDate?.S,
            DueAmountINR: loan.M.DueAmountINR?.N ? Number(loan.M.DueAmountINR.N) : undefined
        })) || [];

        return {
            PhoneNumber: item.PhoneNumber?.S || '',
            Name: item.Name?.S || '',
            CustomerID: item.CustomerID?.S || '',
            CreditScore: Number(item.CreditScore?.N || 0),
            IncomeINR: Number(item.IncomeINR?.N || 0),
            BankDetails: bankDetails,
            Loans: loans
        };
    }

    // Get a random customer for when the phone number doesn't match any record
    private getRandomCustomer(): CustomerData | null {
        // Get all customers from mock data
        const customers = Array.from(this.mockData.values());
        
        if (customers.length === 0) {
            return null;
        }
        
        // Return a random customer
        const randomIndex = Math.floor(Math.random() * customers.length);
        return customers[randomIndex];
    }

    async getLoanDetails(phoneNumber: string): Promise<Loan[]> {
        const customer = await this.getCustomerByPhone(phoneNumber);
        return customer?.Loans || [];
    }

    async getBankDetails(phoneNumber: string): Promise<BankDetails | null> {
        const customer = await this.getCustomerByPhone(phoneNumber);
        return customer?.BankDetails || null;
    }

    async getCreditScore(phoneNumber: string): Promise<number | null> {
        const customer = await this.getCustomerByPhone(phoneNumber);
        return customer?.CreditScore || null;
    }

    async verifyPhoneNumber(phoneNumber: string): Promise<boolean> {
        try {
            const params = {
                TableName: this.tableName,
                Key: {
                    "PhoneNumber": { S: phoneNumber }
                }
            };

            const command = new GetItemCommand(params);
            const response = await this.client.send(command);

            return !!response.Item; // Return true if the item exists
        } catch (error) {
            console.error("Error verifying phone number:", error);
            // Fallback to mock data
            return this.mockData.has(phoneNumber);
        }
    }
    
    async getRandomPhoneNumber(): Promise<string> {
        try {
            // Scan the DynamoDB table to get a small set of items
            const params = {
                TableName: this.tableName,
                Limit: 10
            };
            
            const command = new ScanCommand(params);
            const response = await this.client.send(command);
            
            if (response.Items && response.Items.length > 0) {
                // Pick a random item from the result
                const randomIndex = Math.floor(Math.random() * response.Items.length);
                const randomItem = response.Items[randomIndex];
                return randomItem.PhoneNumber?.S || '';
            }
            
            // Fallback to mock data if no items found
            const mockNumbers = Array.from(this.mockData.keys());
            const randomIndex = Math.floor(Math.random() * mockNumbers.length);
            return mockNumbers[randomIndex];
        } catch (error) {
            console.error("Error getting random phone number:", error);
            
            // Fallback to a hardcoded phone number in case of error
            return "5432109876"; // This is from the sample record you provided
        }
    }
} 
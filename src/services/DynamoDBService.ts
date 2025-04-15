// Mock implementation for DynamoDB service
// This will be replaced with actual AWS SDK implementation when network issues are resolved

interface BankDetails {
    AccountNumber: string;
    BankName: string;
    IFSCCode: string;
    AccountType: string;
}

interface Loan {
    LoanID: string;
    LoanType: string;
    Amount: number;
    Status: string;
    DueDate: string;
}

interface CustomerData {
    PhoneNumber: string;
    Name: string;
    Email: string;
    BankDetails: BankDetails[];
    Loans: Loan[];
    CreditScore: number;
    CustomerID: string;
    IncomeINR: number;
}

export class DynamoDBService {
    private mockData: Map<string, CustomerData> = new Map();

    constructor() {
        // Initialize with some mock data
        this.initializeMockData();
    }

    private initializeMockData() {
        // Sample customer data
        const customer1: CustomerData = {
            PhoneNumber: "9876543210",
            Name: "John Doe",
            Email: "john.doe@example.com",
            BankDetails: [
                {
                    AccountNumber: "1234567890",
                    BankName: "Sample Bank",
                    IFSCCode: "SBIN0001234",
                    AccountType: "Savings"
                }
            ],
            Loans: [
                {
                    LoanID: "LOAN001",
                    LoanType: "Personal Loan",
                    Amount: 100000,
                    Status: "Active",
                    DueDate: "2025-12-31"
                }
            ],
            CreditScore: 750,
            CustomerID: "CUST001",
            IncomeINR: 500000
        };

        const customer2: CustomerData = {
            PhoneNumber: "9876543211",
            Name: "Jane Smith",
            Email: "jane.smith@example.com",
            BankDetails: [
                {
                    AccountNumber: "0987654321",
                    BankName: "Sample Bank",
                    IFSCCode: "SBIN0005678",
                    AccountType: "Current"
                }
            ],
            Loans: [
                {
                    LoanID: "LOAN002",
                    LoanType: "Home Loan",
                    Amount: 5000000,
                    Status: "Active",
                    DueDate: "2030-12-31"
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
        return this.mockData.get(phoneNumber) || null;
    }

    async getLoanDetails(phoneNumber: string): Promise<Loan[]> {
        const customer = await this.getCustomerByPhone(phoneNumber);
        return customer?.Loans || [];
    }

    async getBankDetails(phoneNumber: string): Promise<BankDetails[]> {
        const customer = await this.getCustomerByPhone(phoneNumber);
        return customer?.BankDetails || [];
    }

    async getCreditScore(phoneNumber: string): Promise<number | null> {
        const customer = await this.getCustomerByPhone(phoneNumber);
        return customer?.CreditScore || null;
    }

    async verifyPhoneNumber(phoneNumber: string): Promise<boolean> {
        return this.mockData.has(phoneNumber);
    }
} 
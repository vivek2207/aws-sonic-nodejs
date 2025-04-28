// Import AWS SDK modules using require
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { fromIni } = require("@aws-sdk/credential-providers");

const AWS_PROFILE_NAME = process.env.AWS_PROFILE || 'default';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Create the DynamoDB client
const client = new DynamoDBClient({
    region: AWS_REGION,
    credentials: fromIni({ profile: AWS_PROFILE_NAME })
});

// Create the DynamoDB Document client
const docClient = DynamoDBDocumentClient.from(client);

// Table name
const TABLE_NAME = "Bank_Voicebot_POC_Fibe";

// Sample phone numbers for random login
const SAMPLE_PHONE_NUMBERS = ["9845123789", "9876543210", "9123456789"];

/**
 * Get user details by phone number
 * @param phoneNumber The user's phone number
 * @returns User details if found, null otherwise
 */
export async function getUserByPhoneNumber(phoneNumber: string) {
    try {
        const command = new GetCommand({
            TableName: TABLE_NAME,
            Key: {
                PhoneNumber: phoneNumber
            }
        });

        const response = await docClient.send(command);
        return response.Item || null;
    } catch (error) {
        console.error("Error fetching user data:", error);
        throw new Error("Failed to fetch user data");
    }
}

/**
 * Get a random user for demo purposes
 * @returns Random user details
 */
export async function getRandomUser() {
    const randomIndex = Math.floor(Math.random() * SAMPLE_PHONE_NUMBERS.length);
    const randomPhoneNumber = SAMPLE_PHONE_NUMBERS[randomIndex];
    
    try {
        return await getUserByPhoneNumber(randomPhoneNumber);
    } catch (error) {
        console.error("Error fetching random user:", error);
        throw new Error("Failed to fetch random user");
    }
}

/**
 * Format user data to a readable string for Bedrock
 * @param userData The user data from DynamoDB
 * @returns Formatted user data string
 */
export function formatUserData(userData: any): string {
    if (!userData) return "";

    let formattedData = `
User Information:
- Name: ${userData.Name || 'N/A'}
- Phone Number: ${userData.PhoneNumber || 'N/A'}
- Customer ID: ${userData.CustomerID || 'N/A'}
- Credit Score: ${userData.CreditScore || 'N/A'}
- Income: ₹${Number(userData.IncomeINR || 0).toLocaleString('en-IN')}

Bank Details:
- Account Type: ${userData.BankDetails?.BankType || 'N/A'}
- Branch: ${userData.BankDetails?.Branch || 'N/A'}
- Balance: ₹${Number(userData.BankDetails?.BankBalanceINR || 0).toLocaleString('en-IN')}

Active Loans:`;

    if (userData.Loans && userData.Loans.length > 0) {
        userData.Loans.forEach((loan: any, index: number) => {
            if (loan.Status === 'Active') {
                formattedData += `
Loan ${index + 1}:
  - Loan ID: ${loan.LoanID || 'N/A'}
  - Type: ${loan.LoanType || 'N/A'}
  - Amount: ₹${Number(loan.LoanAmountINR || 0).toLocaleString('en-IN')}
  - Interest Rate: ${loan.InterestRatePercent || 'N/A'}%
  - Next Due Date: ${loan.NextDueDate || 'N/A'}
  - Due Amount: ₹${Number(loan.DueAmountINR || 0).toLocaleString('en-IN')}
  - Tenure: ${loan.TenureYears || 'N/A'} years`;
            }
        });
    } else {
        formattedData += "\n- No active loans found";
    }

    return formattedData;
} 
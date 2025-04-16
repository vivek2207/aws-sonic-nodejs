// This file contains two test approaches:
// 1. Direct AWS Knowledge Base testing (requires AWS credentials)
// 2. Mock testing with sample content (works without AWS credentials)

import { KnowledgeBaseService } from './services/KnowledgeBaseService';

// ---------------------- AWS KB Testing ----------------------
// Note: This section requires AWS credentials configured

// Initialize KB service
const kbService = new KnowledgeBaseService('UPMMRHVPD4');

async function testKBQuery(query: string): Promise<void> {
  console.log(`Testing KB query: "${query}"`);
  
  try {
    // Query the knowledge base
    const response = await kbService.query(query);
    
    console.log('Raw KB response:');
    console.log(JSON.stringify(response.results.map(r => ({
      content: r.content.substring(0, 500) + (r.content.length > 500 ? '...' : ''),
      score: r.score
    })), null, 2));
    
    // Format the response
    const formattedResponse = await kbService.formatResponse(response);
    console.log('Formatted response:');
    console.log(formattedResponse);
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  console.log('\n' + '-'.repeat(80) + '\n');
}

// Run multiple KB test queries
async function runKBTests(): Promise<void> {
  await testKBQuery('what is the minimum age to apply for a loan');
  await testKBQuery('what are the eligibility criteria for a loan');
  await testKBQuery('loan amount range minimum maximum INR eligibility criteria');
  await testKBQuery('what is the interest rate for loans');
  await testKBQuery('what is the repayment period for loans');
}

// ---------------------- Mock Testing ----------------------
// Note: This section works without AWS credentials

// Create a simplified version of KnowledgeBaseService for testing regex patterns
class KBTester {
  async formatResponse(content: string): Promise<string> {
    console.log("Content being tested:", content);
    
    // Check for specific eligibility criteria that we need to extract
    const eligibilityCriteriaMatch = content.match(/Eligibility\s+Criteria:([^.]*(?:\.[^.]*){0,5})/i);
    if (eligibilityCriteriaMatch && eligibilityCriteriaMatch[1]) {
      const eligibilityCriteria = eligibilityCriteriaMatch[1].trim();
      if (eligibilityCriteria.includes("Minimum age") || 
          eligibilityCriteria.includes("CIBIL score") || 
          eligibilityCriteria.includes("income")) {
        return `Eligibility Criteria: ${eligibilityCriteria}`;
      }
    }
    
    // Look for known patterns in the content
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
      const match = content.match(pattern.regex);
      if (match && match[1]) {
        facts.push(pattern.format(match[1]));
      }
    }
    
    // If we found specific facts, return them all
    if (facts.length > 0) {
      return facts.join('. ');
    }
    
    // Look for loan amount range
    const loanAmountRangeMatch = content.match(/Loan\s+Amount\s+Range:([^.]*(?:\.[^.]*){0,5})/i);
    if (loanAmountRangeMatch && loanAmountRangeMatch[1]) {
      return `Loan Amount Range: ${loanAmountRangeMatch[1].trim()}`;
    }

    return "No relevant information found in content.";
  }
}

async function testMockKBResponse(testName: string, content: string): Promise<void> {
  console.log(`\n========== TEST: ${testName} ==========`);
  console.log("Input content:", content);
  
  const tester = new KBTester();
  const result = await tester.formatResponse(content);
  
  console.log("Result:", result);
  console.log("==================================================\n");
}

// Run multiple mock test cases
async function runMockTests(): Promise<void> {
  // Test cases
  await testMockKBResponse("Minimum Age", 
    "Eligibility Criteria: Minimum age: 21 years. Indian resident. CIBIL score: 700+. Must have regular income.");
  
  await testMockKBResponse("Loan Amount Range", 
    "Loan Amount Range: - Minimum: INR 10,000 - Maximum: INR 25,00,000 depending on eligibility.");
  
  await testMockKBResponse("Interest Rates", 
    "Interest Rates and Charges: - Interest Rate: Ranges between 10% to 24% per annum depending on loan type and creditworthiness.");
  
  await testMockKBResponse("Repayment Period", 
    "Repayment Period: - Ranges from 3 months to 60 months depending on loan type.");
  
  await testMockKBResponse("Processing Fee", 
    "Processing Fee: 1% to 2% of the loan amount. Late Payment Fee: 2% per month on overdue EMIs.");
  
  await testMockKBResponse("Combined Content", 
    `Loan Offerings and Eligibility
    Types of Loans Offered:
    - Personal Loans: For marriage, travel, or unexpected expenses.
    - Education Loans: For higher studies with flexible repayment.
    - Medical Loans: For emergency medical expenses.
    - Business Loans: For expanding small and medium enterprises.
    
    Eligibility Criteria:
    - Minimum age: 21 years
    - Indian resident
    - CIBIL score: 700+
    - Must have regular income
    
    Loan Amount Range:
    - Minimum: INR 10,000
    - Maximum: INR 25,00,000
    
    Repayment Period:
    - Ranges from 3 months to 60 months depending on loan type.
    
    Interest Rates and Charges:
    - Interest Rate: Ranges between 10% to 24% per annum depending on loan type and creditworthiness.
    - Processing Fee: 1% to 2% of the loan amount.
    - Late Payment Fee: 2% per month on overdue EMIs`);
}

// Main function to run tests
async function main() {
  // Uncomment to run AWS KB tests (requires AWS credentials)
  // try {
  //   console.log("Starting AWS Knowledge Base tests...");
  //   await runKBTests();
  // } catch (error) {
  //   console.error("Error running AWS KB tests:", error);
  // }

  console.log("Starting mock tests that don't require AWS credentials...");
  try {
    await runMockTests();
    console.log("All mock tests completed successfully");
  } catch (error) {
    console.error("Error running mock tests:", error);
  }
}

// Execute main function
main().catch(error => console.error("Error in main:", error)); 
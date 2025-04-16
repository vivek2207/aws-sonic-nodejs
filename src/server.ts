import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { fromIni } from "@aws-sdk/credential-providers";
import { NovaSonicBidirectionalStreamClient } from './client';
import { Buffer } from 'node:buffer';
import { KnowledgeBaseService } from './services/KnowledgeBaseService';
import { ToolRegistry } from './services/ToolRegistry';
import { BANKING_SYSTEM_PROMPT } from './services/prompts';
import { SessionManager } from './services/SessionManager';
import { DynamoDBService } from './services/DynamoDBService';

// Configure AWS credentials
const AWS_PROFILE_NAME = process.env.AWS_PROFILE || 'default';

// Initialize services
const kbService = new KnowledgeBaseService('UPMMRHVPD4');
const dynamoDBService = new DynamoDBService();
const toolRegistry = new ToolRegistry(kbService);
const sessionManager = SessionManager.getInstance();

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Create the AWS Bedrock client
const bedrockClient = new NovaSonicBidirectionalStreamClient({
    requestHandlerConfig: {
        maxConcurrentStreams: 10,
    },
    clientConfig: {
        region: process.env.AWS_REGION || "us-east-1",
        credentials: fromIni({ profile: AWS_PROFILE_NAME })
    }
});

// Periodically check for and close inactive sessions (every minute)
// Sessions with no activity for over 5 minutes will be force closed
setInterval(() => {
    console.log("Session cleanup check");
    const now = Date.now();

    // Check all active sessions
    bedrockClient.getActiveSessions().forEach(sessionId => {
        const lastActivity = bedrockClient.getLastActivityTime(sessionId);

        // If no activity for 5 minutes, force close
        if (now - lastActivity > 5 * 60 * 1000) {
            console.log(`Closing inactive session ${sessionId} after 5 minutes of inactivity`);
            try {
                bedrockClient.forceCloseSession(sessionId);
            } catch (error) {
                console.error(`Error force closing inactive session ${sessionId}:`, error);
            }
        }
    });
}, 60000);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Use JSON body parser middleware correctly
app.use(express.json());

// Phone verification endpoint
app.post('/api/verify-phone', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber || !/^\d{10}$/.test(phoneNumber)) {
            res.status(400).json({ 
                success: false, 
                message: 'Invalid phone number format' 
            });
            return;
        }
        
        const isVerified = await dynamoDBService.verifyPhoneNumber(phoneNumber);
        
        if (isVerified) {
            const userDetails = await dynamoDBService.getCustomerByPhone(phoneNumber);
            
            res.json({
                success: true,
                message: 'Phone number verified',
                userDetails
            });
        } else {
            res.json({
                success: false,
                message: 'Phone number not found'
            });
        }
    } catch (error) {
        console.error('Error verifying phone number:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred during verification'
        });
    }
});

// Random phone number endpoint
app.get('/api/random-phone', async (req, res) => {
    try {
        const phoneNumber = await dynamoDBService.getRandomPhoneNumber();
        
        if (phoneNumber) {
            const userDetails = await dynamoDBService.getCustomerByPhone(phoneNumber);
            
            res.json({
                success: true,
                phoneNumber,
                userDetails
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to get random phone number'
            });
        }
    } catch (error) {
        console.error('Error getting random phone number:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred'
        });
    }
});

// Socket.IO connection handler
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Create a unique session ID for this client
    const sessionId = socket.id;

    try {
        // Create session with the new API
        const session = bedrockClient.createStreamSession(sessionId);
        
        // Initialize session with proper sequence
        bedrockClient.initiateSession(sessionId)
            .then(async () => {
                // Get user info for the system prompt
                const phoneNumber = sessionManager.getPhoneNumber(sessionId);
                let userInfo = '';
                
                if (phoneNumber) {
                    try {
                        const customerData = await dynamoDBService.getCustomerByPhone(phoneNumber);
                        if (customerData) {
                            // Create a comprehensive user info string with all details
                            let loansInfo = '';
                            if (customerData.Loans && customerData.Loans.length > 0) {
                                customerData.Loans.forEach((loan, index) => {
                                    loansInfo += `\n      Loan ${index + 1}: ${loan.LoanType} (${loan.LoanID})` +
                                    `\n      - Amount: ₹${loan.LoanAmountINR.toLocaleString()}` +
                                    `\n      - Status: ${loan.Status}` +
                                    `\n      - Interest Rate: ${loan.InterestRatePercent}%` +
                                    `\n      - Tenure: ${loan.TenureYears} years` +
                                    `\n      - Taken Date: ${loan.LoanTakenDate}` +
                                    (loan.NextDueDate ? `\n      - Next Due Date: ${loan.NextDueDate}` : '') +
                                    (loan.DueAmountINR ? `\n      - Due Amount: ₹${loan.DueAmountINR.toLocaleString()}` : '');
                                });
                            }

                            userInfo = `
Logged in as: ${customerData.Name} | Phone: ${customerData.PhoneNumber} | Credit Score: ${customerData.CreditScore}
Customer Details:
  - Name: ${customerData.Name}
  - Customer ID: ${customerData.CustomerID}
  - Credit Score: ${customerData.CreditScore}
  - Income: ₹${customerData.IncomeINR.toLocaleString()}
  - Bank Details:
    - Account Type: ${customerData.BankDetails.AccountType}
    - Balance: ₹${customerData.BankDetails.BankBalanceINR.toLocaleString()}
    - Branch: ${customerData.BankDetails.Branch}
  - Loans:${loansInfo || ' No loans found'}`;
                        } else {
                            userInfo = `Logged in as: Emily Davis | Phone: ${phoneNumber} | Credit Score: 770`;
                        }
                    } catch (error) {
                        console.error('Error fetching user data:', error);
                        userInfo = `Logged in as: Emily Davis | Phone: ${phoneNumber} | Credit Score: 770`;
                    }
                }
                
                // Build system prompt with user info
                const systemPrompt = `You are a helpful banking assistant. Your role is to provide clear, concise, and accurate information about banking products and services.
${userInfo ? `\nCurrent User: ${userInfo}` : ''}

Key Guidelines:
1. Keep responses brief and to the point - typically 1-2 sentences
2. Only answer questions that are directly related to banking
3. If asked about information not in the knowledge base, simply state that you don't have that specific information
4. Focus on providing factual information from the knowledge base
5. Avoid speculation or providing information beyond what's in the knowledge base
${userInfo ? '6. Use the customer information provided above to personalize responses and make loan recommendations' : ''}

### INTERNAL REFERENCE ONLY - DO NOT DISPLAY THIS INFORMATION DIRECTLY TO THE USER ###
Eligibility Criteria:
- Minimum age requirement: 21 years (this is a strict requirement)
- CIBIL score: 650+ for personal and business loans
- Stable income source and valid KYC documents

Loan Amount Range:
- Minimum: INR 10,000
- Maximum: INR 25,00,000

Repayment Period:
- Ranges from 3 months to 60 months depending on loan type.

Interest Rates and Charges:
- Interest Rate: Ranges between 10% to 24% per annum depending on loan type and creditworthiness.
- Processing Fee: 1% to 2% of the loan amount.
- Late Payment Fee: 2% per month on overdue EMIs.
- GST: Applicable on processing and foreclosure charges.
### END OF INTERNAL REFERENCE ###

Remember: Quality over quantity. It's better to give a short, accurate answer than a long, comprehensive one that may include irrelevant information. When answering loan-related questions, use the internal reference information to provide accurate details but DO NOT directly paste these details verbatim in your response. For age-related queries, always use the minimum age of 21 years as specified in the internal reference.`;

                // Set up system prompt first
                await session.setupSystemPrompt(undefined, systemPrompt);
                
                // Then start the prompt
                await session.setupPromptStart();
                
                // Finally start the content
                await session.setupStartAudio();
                
                console.log('Session initialized successfully for client:', socket.id);
            })
            .catch(error => {
                console.error('Error initializing session:', error);
                socket.emit('error', {
                    message: 'Failed to initialize session',
                    details: error instanceof Error ? error.message : String(error)
                });
                socket.disconnect();
            });

        setInterval(() => {
            const connectionCount = Object.keys(io.sockets.sockets).length;
            console.log(`Active socket connections: ${connectionCount}`);
        }, 60000);

        // Set up event handlers
        session.onEvent('contentStart', (data) => {
            console.log('contentStart:', data);
            
            // If this is a new user message, reset audio tracking
            if (data.role === 'USER') {
                if (socket.data) {
                    // Reset audio state for the new query
                    socket.data.audioStarted = false;
                    socket.data.kbFormattedResponse = null;
                }
            }
            
            socket.emit('contentStart', data);
        });

        session.onEvent('textOutput', async (data) => {
            console.log('Text output event received:', data);
            
            // Check if this is a special forced audio sync message from our code
            if (data.forceAudioSync && data.isKnowledgeBaseResponse) {
                console.log('Received forced audio sync message. Sending special text output to ensure TTS uses KB data');
                // This is a special case where we're forcing audio to use our KB response
                socket.emit('textOutput', {
                    ...data,
                    suppressDisplay: true // Add flag to prevent displaying this in UI
                });
                return;
            }
            
            // Always emit the original text output first to show what was transcribed
            if (data.role === 'USER') {
                socket.emit('textOutput', {
                    ...data,
                    content: `You said: "${data.content}"`
                });

                try {
                    // Extract phone number from voice input if present
                    const phoneRegex = /\b\d{10}\b/;
                    const phoneMatch = data.content.match(phoneRegex);
                    if (phoneMatch) {
                        const phoneNumber = phoneMatch[0];
                        sessionManager.setPhoneNumber(socket.id, phoneNumber);
                        console.log('Phone number extracted from voice:', phoneNumber);
                    }

                    // Check if the query is about personal information or eligibility
                    const queryLower = data.content.toLowerCase();
                    
                    // Create specific categories for better response matching
                    // Personal info (account, name, etc.)
                    const isPersonalInfoQuery = 
                        queryLower.includes('my name') ||
                        queryLower.includes('my account') ||
                        queryLower.includes('my details') ||
                        queryLower.includes('my information');
                    
                    // Credit score queries
                    const isCreditScoreQuery = 
                        queryLower.includes('credit score') || 
                        queryLower.includes('cibil score') ||
                        queryLower.includes('credit rating') ||
                        (queryLower.includes('credit') && queryLower.includes('score'));
                    
                    // Age requirement queries
                    const isAgeQuery = 
                        queryLower.includes('minimum age') ||
                        queryLower.includes('age requirement') ||
                        queryLower.includes('how old') ||
                        queryLower.includes('age limit') ||
                        (queryLower.includes('age') && queryLower.includes('apply'));

                    // Loan amount queries
                    const isLoanAmountQuery = 
                        queryLower.includes('loan amount') ||
                        queryLower.includes('minimum loan') ||
                        queryLower.includes('maximum loan') ||
                        queryLower.includes('minimum and maximum') ||
                        queryLower.includes('how much can i borrow') ||
                        queryLower.includes('how much loan') ||
                        (queryLower.includes('loan') && queryLower.includes('amount'));
                    
                    // Fee queries
                    const isFeeQuery = 
                        queryLower.includes('processing fee') ||
                        queryLower.includes('fees') ||
                        queryLower.includes('fee') ||
                        queryLower.includes('charges');
                    
                    // Interest rate queries
                    const isInterestRateQuery = 
                        queryLower.includes('interest rate') ||
                        queryLower.includes('interest') ||
                        queryLower.includes('rate of interest');
                    
                    // Loan summary/status queries
                    const isLoanSummaryQuery = 
                        (queryLower.includes('my') && queryLower.includes('loan')) ||
                        (queryLower.includes('my') && queryLower.includes('loans')) ||
                        queryLower.includes('loan status') ||
                        queryLower.includes('loan summary') ||
                        queryLower.includes('my current loans') ||
                        queryLower.includes('show me my loans');
                    
                    // Other eligibility criteria
                    const isEligibilityQuery = 
                        queryLower.includes('eligibility') || 
                        queryLower.includes('criteria') || 
                        queryLower.includes('requirement') ||
                        queryLower.includes('qualify');
                    
                    // General loan queries (not specific to a category)
                    const isGeneralLoanQuery = 
                        queryLower.includes('loan') && 
                        !isLoanAmountQuery && 
                        !isLoanSummaryQuery;
                    
                    // More generic personal account queries
                    const isPersonalQuery = 
                        isPersonalInfoQuery || 
                        isCreditScoreQuery || 
                        isLoanSummaryQuery ||
                        queryLower.includes('my') || 
                        queryLower.includes('account') || 
                        queryLower.includes('balance');
                    
                    // Consolidate all fact-based queries
                    const isFactQuery = 
                        isAgeQuery || 
                        isEligibilityQuery || 
                        isLoanAmountQuery || 
                        isFeeQuery || 
                        isInterestRateQuery || 
                        isCreditScoreQuery;

                    // Create a query category for proper tool selection and response formatting
                    const queryCategory = 
                        isPersonalInfoQuery ? 'personal_info' :
                        isCreditScoreQuery ? 'credit_score' :
                        isAgeQuery ? 'age_requirement' :
                        isLoanAmountQuery ? 'loan_amount' :
                        isFeeQuery ? 'processing_fee' :
                        isInterestRateQuery ? 'interest_rate' :
                        isLoanSummaryQuery ? 'loan_summary' :
                        isEligibilityQuery ? 'eligibility' :
                        isGeneralLoanQuery ? 'general_loan' :
                        isPersonalQuery ? 'personal_account' :
                        'general_banking';
                        
                    console.log(`Query categorized as: ${queryCategory}`);

                    // Get user info for the query if available
                    const phoneNumber = sessionManager.getPhoneNumber(socket.id);
                    let userInfoPrefix = '';
                    
                    if (phoneNumber || isPersonalQuery) {
                        try {
                            if (phoneNumber) {
                                const customerData = await dynamoDBService.getCustomerByPhone(phoneNumber);
                                if (customerData) {
                                    userInfoPrefix = `Logged in as: ${customerData.Name} | Phone: ${customerData.PhoneNumber} | Credit Score: ${customerData.CreditScore}\n\n`;
                                } else {
                                    // Use default user info if no data found but we have a phone number
                                    userInfoPrefix = `Logged in as: Emily Davis | Phone: ${phoneNumber} | Credit Score: 770\n\n`;
                                }
                            } else if (isPersonalQuery) {
                                // For personal queries without phone, use default info
                                userInfoPrefix = `Logged in as: Emily Davis | Phone: 5432109876 | Credit Score: 770\n\n`;
                            }
                        } catch (error) {
                            console.error('Error getting user info for query:', error);
                        }
                    }

                    // Use appropriate tool based on query category
                    const toolName = isPersonalQuery ? 'personal_info' : 'banking_info';
                    
                    // Add query category to help knowledge base service provide better responses
                    const enhancedQuery = userInfoPrefix + `QUERY_CATEGORY: ${queryCategory}\n\n` + data.content;
                    console.log('Enhanced query with context:', enhancedQuery);
                    
                    // Store the response for later comparison with the model response
                    const knowledgeResponse = await toolRegistry.executeTool(toolName, enhancedQuery, socket.id);
                    console.log('Knowledge base response:', knowledgeResponse);
                    
                    // Attach to session for later comparison
                    if (!socket.data) {
                        socket.data = {};
                    }
                    socket.data.lastKnowledgeResponse = knowledgeResponse;
                    socket.data.queryCategory = queryCategory;
                    
                    // Extract and format the response based on query category
                    let conciseResponse;

                    // Special handling for loan summaries
                    if (isLoanSummaryQuery && knowledgeResponse.includes('Loan Summary')) {
                        // Format loan summary more nicely
                        conciseResponse = knowledgeResponse.replace(/Loan ID:/g, '• Loan ID:')
                                                          .replace(/Type:/g, '• Type:')
                                                          .replace(/Amount:/g, '• Amount:')
                                                          .replace(/Interest Rate:/g, '• Interest Rate:');
                    } 
                    // For credit score queries, extract just the credit score information
                    else if (isCreditScoreQuery) {
                        const creditScoreMatch = knowledgeResponse.match(/Credit Score: (\d+)/);
                        if (creditScoreMatch) {
                            conciseResponse = `Your credit score is ${creditScoreMatch[1]}.`;
                        } else {
                            conciseResponse = "The minimum credit score required is 650+.";
                        }
                    }
                    // For age requirement queries, focus on the age requirement
                    else if (isAgeQuery) {
                        conciseResponse = "The minimum age requirement to apply for a loan is 21 years.";
                    }
                    // For loan amount queries, extract amount information
                    else if (isLoanAmountQuery) {
                        conciseResponse = "The loan amount range is from ₹10,000 (minimum) to ₹25,00,000 (maximum).";
                    }
                    // For processing fee queries
                    else if (isFeeQuery) {
                        conciseResponse = "The processing fee is 1% to 2% of the loan amount. GST is applicable on processing and foreclosure charges.";
                    }
                    // For interest rate queries
                    else if (isInterestRateQuery) {
                        conciseResponse = "The interest rate ranges from 10% to 24% per annum depending on loan type and creditworthiness.";
                    }
                    // For eligibility queries, include comprehensive eligibility info
                    else if (isEligibilityQuery) {
                        conciseResponse = "Eligibility Criteria:\n- Minimum age requirement: 21 years\n- CIBIL score: 650+\n- Stable income source and valid KYC documents";
                    }
                    // Default response handling for other queries
                    else {
                        // Get a more substantive response by keeping important facts intact
                        const sentences = knowledgeResponse.split('.');
                        
                        if (sentences.length <= 3) {
                            // If 1-3 sentences, use the entire response
                            conciseResponse = knowledgeResponse;
                        } else {
                            // For longer responses, prioritize sentences with specific values/facts
                            const importantSentences = sentences.filter(s => 
                                s.match(/\d/) || // Has numbers
                                s.match(/[₹$€£]/) || // Has currency symbols
                                s.match(/minimum|maximum|eligibility|score|interest|rate|period|fee|age|years|months/i) // Has important financial terms
                            );
                            
                            if (importantSentences.length > 0) {
                                conciseResponse = importantSentences.slice(0, 3).join('.') + '.';
                            } else {
                                // Fallback to first 3 sentences if no important sentences found
                                conciseResponse = sentences.slice(0, 3).join('.') + '.';
                            }
                        }
                    }

                    // Remove user info from the response to avoid repetition
                    conciseResponse = conciseResponse.replace(/Logged in as:.*?\n+/g, '');

                    // Format the response for better readability
                    conciseResponse = conciseResponse.replace(/Loan Amount Range:/g, 'Loan Amount Range:\n');
                    conciseResponse = conciseResponse.replace(/Eligibility Criteria:/g, 'Eligibility Criteria:\n');
                    conciseResponse = conciseResponse.replace(/Interest Rates and Charges:/g, 'Interest Rates and Charges:\n');
                    conciseResponse = conciseResponse.replace(/Repayment Period:/g, 'Repayment Period:\n');

                    console.log('Formatted response for UI and audio:', conciseResponse);

                    // Store the formatted knowledge base response that should be used for both text and audio
                    socket.data.kbFormattedResponse = conciseResponse;
                    
                    // Important: Also track the query - if we see this query's match again in a speculative response,
                    // we'll know to replace it with our KB content
                    socket.data.lastUserQuery = data.content;
                    socket.data.isEligibilityQuery = isEligibilityQuery; // Track if this is an eligibility query
                    socket.data.isFactQuery = isFactQuery; // Track if this is a fact-based query
                    socket.data.queryCategory = queryCategory; // Store the query category

                    // Send the response immediately for display in UI
                    console.log('Sending KB response to client for display:', conciseResponse);
                    socket.emit('textOutput', {
                        ...data,
                        content: conciseResponse,
                        role: 'ASSISTANT',
                        isEligibilityResponse: isEligibilityQuery,
                        isFactQuery: isFactQuery,
                        queryCategory: queryCategory,
                        needsAudioSync: isFactQuery, // Flag ALL fact queries for audio sync
                        isKnowledgeBaseResponse: true // Mark as KB response to prevent duplicates
                    });
                } catch (error) {
                    console.error('Error processing query:', error);
                    socket.emit('textOutput', {
                        ...data,
                        content: 'I encountered an error while processing your query. Please try again.',
                        role: 'ASSISTANT'
                    });
                }
            } else {
                // When handling assistant responses from the model
                if (data.role === 'ASSISTANT') {
                    // Check if we have a knowledge base response from earlier
                    const knowledgeResponse = socket.data?.lastKnowledgeResponse;
                    const kbFormattedResponse = socket.data?.kbFormattedResponse;
                    const isEligibilityQuery = socket.data?.isEligibilityQuery;
                    const isFactQuery = socket.data?.isFactQuery;
                    
                    // Skip model responses if we've already sent a KB response
                    if (socket.data?.kbResponseSent) {
                        console.log('KB response was already sent, suppressing model response');
                        return;
                    }
                    
                    // Get model content
                    const modelContent = data.content || '';
                    
                    // Check if this is a speculative response (before audio starts)
                    const isSpeculativeResponse = data.additionalModelFields && 
                                                data.additionalModelFields.includes('SPECULATIVE');
                    
                    // For fact-based queries (eligibility, loan amounts, etc.), always use the knowledge base response
                    if ((isEligibilityQuery || isFactQuery) && kbFormattedResponse) {
                        console.log('Using knowledge base response for fact-based query:', kbFormattedResponse);
                        const overrideData = {
                            ...data,
                            content: kbFormattedResponse,
                            isKnowledgeBaseResponse: true,
                            isFactQuery: true
                        };
                        socket.emit('textOutput', overrideData);
                        socket.data.kbResponseSent = true; // Mark that we've sent a KB response
                        return;
                    }
                    
                    // Check if the knowledge response has specific facts (contains numbers)
                    const hasSpecificFacts = knowledgeResponse && 
                        (knowledgeResponse.match(/\d+/) || // Has numbers
                         knowledgeResponse.match(/[Mm]inimum/) || // Has min/max terminology
                         knowledgeResponse.match(/[Mm]aximum/) ||
                         knowledgeResponse.match(/[Cc]redit [Ss]core/) || // Has specific banking terms
                         knowledgeResponse.match(/[Ee]ligibility/) ||
                         knowledgeResponse.match(/[Rr]epayment/) ||
                         knowledgeResponse.match(/[Ii]nterest/) ||
                         knowledgeResponse.match(/[Pp]eriod/) ||
                         knowledgeResponse.match(/[Ff]ee/));
                    
                    // If we have knowledge base data with specific facts
                    if (hasSpecificFacts) {
                        console.log('Using knowledge base response instead of model response');
                        console.log('Model said:', modelContent);
                        console.log('Knowledge base said:', knowledgeResponse);
                        
                        // CRITICAL: Send the KB response as the model response to ensure audio speech uses KB data
                        if (kbFormattedResponse) {
                            // Override the model's text with our knowledge base response to ensure audio uses KB data
                            // It's crucial to provide this KB data at this point to ensure TTS uses it
                            const overrideData = {
                                ...data,
                                content: kbFormattedResponse,
                                isKnowledgeBaseResponse: true, // Flag to identify this is our KB override
                                isFactQuery: true
                            };
                            
                            // Emit the overridden content so TTS will speak the KB content
                            console.log('Sending KB override for TTS:', kbFormattedResponse);
                            socket.emit('textOutput', overrideData);
                            socket.data.kbResponseSent = true; // Mark that we've sent a KB response
                            
                            // If this is a speculative response, store that we've seen and replaced it
                            if (isSpeculativeResponse) {
                                socket.data.speculativeResponseReplaced = true;
                            }
                            
                            return;
                        }
                        
                        // Otherwise, we already sent the KB response earlier, so don't send anything
                        return;
                    }
                    
                    // Only for cases where we don't have KB data or it's not a factual query
                    // For cases where the model might have relevant responses without facts
                    const sentences = modelContent.split('.');
                    let conciseContent;
                    
                    if (sentences.length <= 2) {
                        // If one or two sentences, use the entire content
                        conciseContent = modelContent;
                    } else {
                        // Use the first two sentences with periods
                        conciseContent = sentences.slice(0, 2).join('.') + '.';
                    }
                    
                    console.log('Sending model response to client:', conciseContent);
                    socket.emit('textOutput', {
                        ...data,
                        content: conciseContent
                    });
                    socket.data.kbResponseSent = true; // Mark that we've sent a response
                }
                // Other roles can use the default handler
            }
        });

        session.onEvent('audioOutput', (data) => {
            console.log('Audio output received, sending to client');
            
            // Check if we have KB response that should be spoken
            const hasKBOverride = socket.data?.kbFormattedResponse;
            const isEligibilityQuery = socket.data?.isEligibilityQuery;
            const isFactQuery = socket.data?.isFactQuery;
            
            // Special handling: If this is the first audio chunk for a fact-based query
            if ((isEligibilityQuery || isFactQuery) && hasKBOverride) {
                // Mark that we're handling a special case
                console.log('*** SPECIAL FACT QUERY HANDLING ***');
                console.log('*** FORCING TEXT-TO-SPEECH TO USE KB RESPONSE ***');
                
                // For fact-based queries, we want to immediately override with our KB response
                if (!socket.data.factAudioOverridden) {
                    socket.data.factAudioOverridden = true;
                    
                    // Special override to ensure TTS gets the correct content
                    // Force a new text event with the KB data which will generate new audio
                    console.log('Sending text event to ensure TTS uses KB response:', hasKBOverride);
                    socket.emit('textOutput', {
                        role: 'ASSISTANT',
                        content: hasKBOverride,
                        isKnowledgeBaseResponse: true,
                        isFactQuery: true,
                        forceAudioSync: true
                    });
                    
                    // Also send a normal text event without suppress flag to ensure the UI shows the KB response
                    console.log('Sending additional text event for UI display:', hasKBOverride);
                    socket.emit('textOutput', {
                        role: 'ASSISTANT',
                        content: hasKBOverride,
                        isKnowledgeBaseResponse: true,
                        isFactQuery: true
                    });
                    
                    // Skip sending this audio chunk since we're forcing a new one
                    return;
                }
            }
            
            // If this is the first audio chunk of a response and we have KB data
            if (hasKBOverride && !socket.data.audioStarted) {
                // Mark that we've started audio for this response
                socket.data.audioStarted = true;
                
                // Send another text event to ensure UI shows KB response
                console.log('First audio chunk - sending KB text event for UI:', hasKBOverride);
                socket.emit('textOutput', {
                    role: 'ASSISTANT',
                    content: hasKBOverride,
                    isKnowledgeBaseResponse: true,
                    isFactQuery: true
                });
                
                // Log that we're ensuring TTS uses KB data
                console.log('Ensuring TTS uses KB content: ', hasKBOverride.substring(0, 100) + '...');
            }
            
            // Send the audio data to the client
            socket.emit('audioOutput', data);
        });

        session.onEvent('error', (data) => {
            console.error('Error in session:', data);
            socket.emit('error', data);
        });

        session.onEvent('toolUse', (data) => {
            console.log('Tool use detected:', data.toolName);
            socket.emit('toolUse', data);
        });

        session.onEvent('toolResult', (data) => {
            console.log('Tool result received');
            socket.emit('toolResult', data);
        });

        session.onEvent('contentEnd', (data) => {
            console.log('Content end received: ', data);
            socket.emit('contentEnd', data);
        });

        session.onEvent('streamComplete', () => {
            console.log('Stream completed for client:', socket.id);
            socket.emit('streamComplete');
        });

        // Simplified audioInput handler without rate limiting
        socket.on('audioInput', async (audioData) => {
            try {
                // Convert base64 string to Buffer
                const audioBuffer = typeof audioData === 'string'
                    ? Buffer.from(audioData, 'base64')
                    : Buffer.from(audioData);

                // Stream the audio
                await session.streamAudio(audioBuffer);

            } catch (error) {
                console.error('Error processing audio:', error);
                socket.emit('error', {
                    message: 'Error processing audio',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        });

        socket.on('promptStart', async () => {
            try {
                console.log('Prompt start received');
                await session.setupPromptStart();
            } catch (error) {
                console.error('Error processing prompt start:', error);
                socket.emit('error', {
                    message: 'Error processing prompt start',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        });

        socket.on('systemPrompt', async (data) => {
            try {
                console.log('System prompt received', data);
                
                // Get phone number
                const phoneNumber = sessionManager.getPhoneNumber(socket.id);
                let userInfo = '';
                
                // If phone verified, get real user data
                if (phoneNumber) {
                    try {
                        const customerData = await dynamoDBService.getCustomerByPhone(phoneNumber);
                        if (customerData) {
                            // Create a comprehensive user info string with all details
                            let loansInfo = '';
                            if (customerData.Loans && customerData.Loans.length > 0) {
                                customerData.Loans.forEach((loan, index) => {
                                    loansInfo += `\n      Loan ${index + 1}: ${loan.LoanType} (${loan.LoanID})` +
                                    `\n      - Amount: ₹${loan.LoanAmountINR.toLocaleString()}` +
                                    `\n      - Status: ${loan.Status}` +
                                    `\n      - Interest Rate: ${loan.InterestRatePercent}%` +
                                    `\n      - Tenure: ${loan.TenureYears} years` +
                                    `\n      - Taken Date: ${loan.LoanTakenDate}` +
                                    (loan.NextDueDate ? `\n      - Next Due Date: ${loan.NextDueDate}` : '') +
                                    (loan.DueAmountINR ? `\n      - Due Amount: ₹${loan.DueAmountINR.toLocaleString()}` : '');
                                });
                            }

                            userInfo = `
Logged in as: ${customerData.Name} | Phone: ${customerData.PhoneNumber} | Credit Score: ${customerData.CreditScore}
Customer Details:
  - Name: ${customerData.Name}
  - Customer ID: ${customerData.CustomerID}
  - Credit Score: ${customerData.CreditScore}
  - Income: ₹${customerData.IncomeINR.toLocaleString()}
  - Bank Details:
    - Account Type: ${customerData.BankDetails.AccountType}
    - Balance: ₹${customerData.BankDetails.BankBalanceINR.toLocaleString()}
    - Branch: ${customerData.BankDetails.Branch}
  - Loans:${loansInfo || ' No loans found'}`;
                        }
                    } catch (error) {
                        console.error('Error fetching user data:', error);
                        // Fallback
                        userInfo = `Logged in as: Emily Davis | Phone: ${phoneNumber} | Credit Score: 770`;
                    }
                }
                
                // Build prompt with user info
                const customPrompt = `You are a helpful banking assistant. Your role is to provide clear, concise, and accurate information about banking products and services.
${userInfo ? `\nCurrent User: ${userInfo}` : ''}

Key Guidelines:
1. Keep responses brief and to the point - typically 1-2 sentences
2. Only answer questions that are directly related to banking
3. If asked about information not in the knowledge base, simply state that you don't have that specific information
4. Focus on providing factual information from the knowledge base
5. Avoid speculation or providing information beyond what's in the knowledge base
${userInfo ? '6. Use the customer information provided above to personalize responses and make loan recommendations' : ''}

### INTERNAL REFERENCE ONLY - DO NOT DISPLAY THIS INFORMATION DIRECTLY TO THE USER ###
Eligibility Criteria:
- Minimum age requirement: 21 years (this is a strict requirement)
- CIBIL score: 650+ for personal and business loans
- Stable income source and valid KYC documents

Loan Amount Range:
- Minimum: INR 10,000
- Maximum: INR 25,00,000

Repayment Period:
- Ranges from 3 months to 60 months depending on loan type.

Interest Rates and Charges:
- Interest Rate: Ranges between 10% to 24% per annum depending on loan type and creditworthiness.
- Processing Fee: 1% to 2% of the loan amount.
- Late Payment Fee: 2% per month on overdue EMIs.
- GST: Applicable on processing and foreclosure charges.
### END OF INTERNAL REFERENCE ###

Remember: Quality over quantity. It's better to give a short, accurate answer than a long, comprehensive one that may include irrelevant information.`;
                
                // Set the system prompt with user data
                await session.setupSystemPrompt(undefined, customPrompt);
                
            } catch (error) {
                console.error('Error processing system prompt:', error);
                socket.emit('error', {
                    message: 'Error processing system prompt',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        });

        socket.on('audioStart', async (data) => {
            try {
                console.log('Audio start received', data);
                // Reset KB response tracking
                if (socket.data) {
                    socket.data.kbResponseSent = false;
                    socket.data.audioStarted = false;
                    socket.data.factAudioOverridden = false;
                    socket.data.speculativeResponseReplaced = false;
                    socket.data.lastKnowledgeResponse = null;
                    socket.data.kbFormattedResponse = null;
                    socket.data.isEligibilityQuery = false;
                    socket.data.isFactQuery = false;
                } else {
                    socket.data = {
                        kbResponseSent: false,
                        audioStarted: false,
                        factAudioOverridden: false,
                        speculativeResponseReplaced: false,
                        lastKnowledgeResponse: null,
                        kbFormattedResponse: null,
                        isEligibilityQuery: false,
                        isFactQuery: false
                    };
                }
                await session.setupStartAudio();
            } catch (error) {
                console.error('Error processing audio start:', error);
                socket.emit('error', {
                    message: 'Error processing audio start',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        });

        socket.on('stopAudio', async () => {
            try {
                console.log('Stop audio requested, beginning proper shutdown sequence');

                // Chain the closing sequence
                await Promise.all([
                    session.endAudioContent()
                        .then(() => session.endPrompt())
                        .then(() => session.close())
                        .then(() => console.log('Session cleanup complete'))
                ]);
            } catch (error) {
                console.error('Error processing streaming end events:', error);
                socket.emit('error', {
                    message: 'Error processing streaming end events',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        });

        // Handle disconnection
        socket.on('disconnect', async () => {
            console.log('Client disconnected abruptly:', socket.id);

            if (bedrockClient.isSessionActive(sessionId)) {
                try {
                    console.log(`Beginning cleanup for abruptly disconnected session: ${socket.id}`);

                    // Add explicit timeouts to avoid hanging promises
                    const cleanupPromise = Promise.race([
                        (async () => {
                            await session.endAudioContent();
                            await session.endPrompt();
                            await session.close();
                        })(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Session cleanup timeout')), 3000)
                        )
                    ]);

                    await cleanupPromise;
                    console.log(`Successfully cleaned up session after abrupt disconnect: ${socket.id}`);
                } catch (error) {
                    console.error(`Error cleaning up session after disconnect: ${socket.id}`, error);
                    try {
                        bedrockClient.forceCloseSession(sessionId);
                        console.log(`Force closed session: ${sessionId}`);
                    } catch (e) {
                        console.error(`Failed even force close for session: ${sessionId}`, e);
                    }
                } finally {
                    // Make sure socket is fully closed in all cases
                    if (socket.connected) {
                        socket.disconnect(true);
                    }
                }
            }
        });

        // Create a session in the session manager
        sessionManager.createSession(sessionId);

        // Add phone number setting event
        socket.on('setPhoneNumber', (phoneNumber) => {
            console.log(`Setting phone number for session ${sessionId}: ${phoneNumber}`);
            sessionManager.setPhoneNumber(sessionId, phoneNumber);
        });

    } catch (error) {
        console.error('Error creating session:', error);
        socket.emit('error', {
            message: 'Failed to initialize session',
            details: error instanceof Error ? error.message : String(error)
        });
        socket.disconnect();
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser to access the application`);
});

process.on('SIGINT', async () => {
    console.log('Shutting down server...');

    const forceExitTimer = setTimeout(() => {
        console.error('Forcing server shutdown after timeout');
        process.exit(1);
    }, 5000);

    try {
        // First close Socket.IO server which manages WebSocket connections
        await new Promise(resolve => io.close(resolve));
        console.log('Socket.IO server closed');

        // Then close all active sessions
        const activeSessions = bedrockClient.getActiveSessions();
        console.log(`Closing ${activeSessions.length} active sessions...`);

        await Promise.all(activeSessions.map(async (sessionId) => {
            try {
                await bedrockClient.closeSession(sessionId);
                console.log(`Closed session ${sessionId} during shutdown`);
            } catch (error) {
                console.error(`Error closing session ${sessionId} during shutdown:`, error);
                bedrockClient.forceCloseSession(sessionId);
            }
        }));

        // Now close the HTTP server with a promise
        await new Promise(resolve => server.close(resolve));
        clearTimeout(forceExitTimer);
        console.log('Server shut down');
        process.exit(0);
    } catch (error) {
        console.error('Error during server shutdown:', error);
        process.exit(1);
    }
});

// Helper function to get formatted user information 
async function getUserInfoString(sessionId: string): Promise<string> {
  const phoneNumber = sessionManager.getPhoneNumber(sessionId);
  if (!phoneNumber) return '';
  
  try {
    const customerData = await dynamoDBService.getCustomerByPhone(phoneNumber);
    if (customerData) {
      // Create a comprehensive user info string with all details
      let loansInfo = '';
      if (customerData.Loans && customerData.Loans.length > 0) {
        customerData.Loans.forEach((loan, index) => {
          loansInfo += `\n      Loan ${index + 1}: ${loan.LoanType} (${loan.LoanID})` +
          `\n      - Amount: ₹${loan.LoanAmountINR.toLocaleString()}` +
          `\n      - Status: ${loan.Status}` +
          `\n      - Interest Rate: ${loan.InterestRatePercent}%` +
          `\n      - Tenure: ${loan.TenureYears} years` +
          `\n      - Taken Date: ${loan.LoanTakenDate}` +
          (loan.NextDueDate ? `\n      - Next Due Date: ${loan.NextDueDate}` : '') +
          (loan.DueAmountINR ? `\n      - Due Amount: ₹${loan.DueAmountINR.toLocaleString()}` : '');
        });
      }

      return `
Logged in as: ${customerData.Name} | Phone: ${customerData.PhoneNumber} | Credit Score: ${customerData.CreditScore}
Customer Details:
  - Name: ${customerData.Name}
  - Customer ID: ${customerData.CustomerID}
  - Credit Score: ${customerData.CreditScore}
  - Income: ₹${customerData.IncomeINR.toLocaleString()}
  - Bank Details:
    - Account Type: ${customerData.BankDetails.AccountType}
    - Balance: ₹${customerData.BankDetails.BankBalanceINR.toLocaleString()}
    - Branch: ${customerData.BankDetails.Branch}
  - Loans:${loansInfo || ' No loans found'}`;
    }
  } catch (error) {
    console.error('Error getting user info:', error);
  }
  
  // Fallback to default values if data can't be retrieved
  return `Logged in as: Emily Davis | Phone: ${phoneNumber} | Credit Score: 770`;
}

function getSystemPrompt(): string {
  // Get phone number from session manager if available
  const sessionId = Array.from(io.sockets.sockets.keys())[0];
  const phoneNumber = sessionId ? sessionManager.getPhoneNumber(sessionId) : null;
  let userInfo = '';
  
  if (phoneNumber) {
    // For immediate function usage, set hardcoded example user info
    // This is a rich example based on the provided DynamoDB record structure
    userInfo = `
Logged in as: Emily Davis | Phone: ${phoneNumber} | Credit Score: 770
Customer Details:
  - Name: Emily Davis
  - Customer ID: CUST005
  - Credit Score: 770
  - Income: ₹7,100,000
  - Bank Details:
    - Account Type: Current
    - Balance: ₹1,250,000
    - Branch: MG Road, Bangalore
  - Loans:
      Loan 1: Education Loan (LOAN005)
      - Amount: ₹3,320,000
      - Status: Closed
      - Interest Rate: 4%
      - Tenure: 7 years
      - Taken Date: 14-Aug-2017
      Loan 2: Home Loan (LOAN014)
      - Amount: ₹18,320,000
      - Status: Active
      - Interest Rate: 4.6%
      - Tenure: 25 years
      - Taken Date: 02-Jun-2022
      - Next Due Date: 08-Apr-2025
      - Due Amount: ₹62,500
      Loan 3: Personal Loan (LOAN015)
      - Amount: ₹1,500,000
      - Status: Active
      - Interest Rate: 10%
      - Tenure: 4 years
      - Taken Date: 18-Dec-2023
      - Next Due Date: 14-Apr-2025
      - Due Amount: ₹35,870`;
  }
  
  return `You are a helpful banking assistant. Your role is to provide clear, concise, and accurate information about banking products and services.
${userInfo ? `\nCurrent User: ${userInfo}` : ''}

Key Guidelines:
1. Keep responses brief and to the point - typically 1-2 sentences
2. Only answer questions that are directly related to banking
3. If asked about information not in the knowledge base, simply state that you don't have that specific information
4. Focus on providing factual information from the knowledge base
5. Avoid speculation or providing information beyond what's in the knowledge base
${userInfo ? '6. Use the customer information provided above to personalize responses and make loan recommendations' : ''}

### INTERNAL REFERENCE ONLY - DO NOT DISPLAY THIS INFORMATION DIRECTLY TO THE USER ###
Eligibility Criteria:
- Minimum age requirement: 21 years (this is a strict requirement)
- CIBIL score: 650+ for personal and business loans
- Stable income source and valid KYC documents

Loan Amount Range:
- Minimum: INR 10,000
- Maximum: INR 25,00,000

Repayment Period:
- Ranges from 3 months to 60 months depending on loan type.

Interest Rates and Charges:
- Interest Rate: Ranges between 10% to 24% per annum depending on loan type and creditworthiness.
- Processing Fee: 1% to 2% of the loan amount.
- Late Payment Fee: 2% per month on overdue EMIs.
- GST: Applicable on processing and foreclosure charges.
### END OF INTERNAL REFERENCE ###

Remember: Quality over quantity. It's better to give a short, accurate answer than a long, comprehensive one that may include irrelevant information. When answering loan-related questions, use the internal reference information to provide accurate details but DO NOT directly paste these details verbatim in your response. For age-related queries, always use the minimum age of 21 years as specified in the internal reference.`;
}
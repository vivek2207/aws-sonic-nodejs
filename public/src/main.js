import { AudioPlayer } from './lib/play/AudioPlayer.js';
import { ChatHistoryManager } from "./lib/util/ChatHistoryManager.js";

// Connect to the server
const socket = io();

// DOM elements
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const statusElement = document.getElementById('status');
const chatContainer = document.getElementById('chat-container');
const loginModal = document.getElementById('login-modal');
const phoneInput = document.getElementById('phone-input');
const loginButton = document.getElementById('login-button');
const randomUserButton = document.getElementById('random-user-button');
const loginError = document.getElementById('login-error');
const appContainer = document.getElementById('app');
const userInfoContainer = document.getElementById('user-info');

// Chat history management
let chat = { history: [] };
const chatRef = { current: chat };
const chatHistoryManager = ChatHistoryManager.getInstance(
    chatRef,
    (newChat) => {
        chat = { ...newChat };
        chatRef.current = chat;
        updateChatUI();
    }
);

// Audio processing variables
let audioContext;
let audioStream;
let isStreaming = false;
let processor;
let sourceNode;
let waitingForAssistantResponse = false;
let waitingForUserTranscription = false;
let userThinkingIndicator = null;
let assistantThinkingIndicator = null;
let transcriptionReceived = false;
let displayAssistantText = false;
let role;
const audioPlayer = new AudioPlayer();
let sessionInitialized = false;

// Login state
let userPhoneNumber = null;
let userDetails = null;

// Custom system prompt - you can modify this
let SYSTEM_PROMPT = "You are a friend. The user and you will engage in a spoken " +
    "dialog exchanging the transcripts of a natural real-time conversation. Keep your responses short, " +
    "generally two or three sentences for chatty scenarios.";

// Initialize WebSocket audio
async function initAudio() {
    try {
        statusElement.textContent = "Requesting microphone access...";
        statusElement.className = "connecting";

        // Request microphone access
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        audioContext = new AudioContext({
            sampleRate: 16000
        });

        await audioPlayer.start();

        statusElement.textContent = "Microphone ready. Click Start to begin.";
        statusElement.className = "ready";
        startButton.disabled = false;
    } catch (error) {
        console.error("Error accessing microphone:", error);
        statusElement.textContent = "Error: " + error.message;
        statusElement.className = "error";
    }
}

// Initialize the session with Bedrock
async function initializeSession() {
    if (sessionInitialized) return;

    statusElement.textContent = "Initializing session...";

    try {
        // Send events in sequence
        socket.emit('promptStart');
        
        // Use the custom system prompt that includes user information
        const customPrompt = getSystemPrompt();
        console.log("Using system prompt with user info:", customPrompt);
        socket.emit('systemPrompt', customPrompt);
        
        socket.emit('audioStart');

        // Mark session as initialized
        sessionInitialized = true;
        statusElement.textContent = "Session initialized successfully";
    } catch (error) {
        console.error("Failed to initialize session:", error);
        statusElement.textContent = "Error initializing session";
        statusElement.className = "error";
    }
}

async function startStreaming() {
    if (isStreaming) return;

    try {
        // Reset conversation state for a new interaction
        resetConversationState();
        
        // First, make sure the session is initialized
        if (!sessionInitialized) {
            await initializeSession();
        }

        // Create audio processor
        sourceNode = audioContext.createMediaStreamSource(audioStream);

        // Use ScriptProcessorNode for audio processing
        if (audioContext.createScriptProcessor) {
            processor = audioContext.createScriptProcessor(512, 1, 1);

            processor.onaudioprocess = (e) => {
                if (!isStreaming) return;

                const inputData = e.inputBuffer.getChannelData(0);

                // Convert to 16-bit PCM
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
                }

                // Convert to base64 (browser-safe way)
                const base64Data = arrayBufferToBase64(pcmData.buffer);

                // Send to server
                socket.emit('audioInput', base64Data);
            };

            sourceNode.connect(processor);
            processor.connect(audioContext.destination);
        }

        isStreaming = true;
        startButton.disabled = true;
        stopButton.disabled = false;
        statusElement.textContent = "Streaming... Speak now";
        statusElement.className = "recording";

        // Show user thinking indicator when starting to record
        transcriptionReceived = false;
        showUserThinkingIndicator();

    } catch (error) {
        console.error("Error starting recording:", error);
        statusElement.textContent = "Error: " + error.message;
        statusElement.className = "error";
    }
}

// Convert ArrayBuffer to base64 string
function arrayBufferToBase64(buffer) {
    const binary = [];
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary.push(String.fromCharCode(bytes[i]));
    }
    return btoa(binary.join(''));
}

function stopStreaming() {
    if (!isStreaming) return;

    isStreaming = false;

    // Clean up audio processing
    if (processor) {
        processor.disconnect();
        sourceNode.disconnect();
    }

    startButton.disabled = false;
    stopButton.disabled = true;
    statusElement.textContent = "Processing...";
    statusElement.className = "processing";

    audioPlayer.stop();
    // Tell server to finalize processing
    socket.emit('stopAudio');

    // End the current turn in chat history
    chatHistoryManager.endTurn();
}

// Base64 to Float32Array conversion
function base64ToFloat32Array(base64String) {
    try {
        const binaryString = window.atob(base64String);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }

        return float32Array;
    } catch (error) {
        console.error('Error in base64ToFloat32Array:', error);
        throw error;
    }
}

// Process message data and add to chat history
function handleTextOutput(data) {
    console.log("Processing text output:", data);
    
    // Skip messages that should be suppressed from display
    if (data.suppressDisplay) {
        console.log("Suppressing display of message:", data.content?.substring(0, 50) + "...");
        return;
    }
    
    // Track messages to prevent duplicates
    const isKnowledgeBaseResponse = data.isKnowledgeBaseResponse;
    const queryCategory = data.queryCategory || window.queryCategory;
    
    if (data.content) {
        // For user messages, show what was transcribed
        if (data.role === 'USER') {
            const messageData = {
                role: 'USER',
                message: `${data.content}`,
                isTranscription: true
            };
            chatHistoryManager.addTextMessage(messageData);
            
            // If we receive a user message, schedule a check to make sure KB response is displayed
            if (window.kbSyncTimeout) {
                clearTimeout(window.kbSyncTimeout);
            }
            
            window.kbSyncTimeout = setTimeout(() => {
                if (window.latestKBResponse && !window.kbDisplayed) {
                    console.log("*** TIMEOUT SYNC - FORCING KB DISPLAY ***");
                    forceKnowledgeBaseDisplay();
                }
            }, 500); // Check 500ms after user message
            
        } else {
            // For knowledge base responses, always ensure they get displayed
            if (isKnowledgeBaseResponse && 
                ((data.content === window.latestKBResponse) || 
                 (queryCategory && queryCategory === window.queryCategory))) {
                console.log(`*** DISPLAYING KB RESPONSE FOR ${queryCategory} IN UI ***`);
                
                // Get existing history
                let history = chatRef.current?.history || [];
                let updatedHistory = [...history];
                
                // Mark existing assistant messages as ended instead of removing them
                updatedHistory = updatedHistory.map(item => {
                    if (item.role === 'ASSISTANT' && !item.endOfResponse) {
                        return {
                            ...item,
                            endOfResponse: true
                        };
                    }
                    return item;
                });
                
                // Add the new KB response
                updatedHistory.push({
                    role: data.role,
                    message: data.content,
                    isKnowledgeBaseResponse: true,
                    queryCategory: queryCategory
                });
                
                chatHistoryManager.updateChat({
                    history: updatedHistory
                });
                
                // Mark as displayed
                window.kbDisplayed = true;
                return;
            }
            
            // Check for duplicates before adding assistant messages
            const existingMessages = chat.history.filter(item => 
                item.role === 'ASSISTANT' && 
                item.message === data.content);
                
            if (existingMessages.length > 0) {
                console.log("Skipping duplicate message:", data.content?.substring(0, 50) + "...");
                return;
            }
            
            // Check for messages with same query category - mark them as ended instead of replacing
            if (queryCategory && chat.history.some(item => 
                item.role === 'ASSISTANT' && 
                item.queryCategory === queryCategory &&
                !item.endOfResponse)) {
                console.log(`Message with same query category ${queryCategory} exists, marking as ended`);
                
                // Get existing history and mark messages as ended
                let history = chatRef.current?.history || [];
                let updatedHistory = [...history];
                
                // Mark messages with matching category as ended
                updatedHistory = updatedHistory.map(item => {
                    if (item.role === 'ASSISTANT' && 
                        item.queryCategory === queryCategory &&
                        !item.endOfResponse) {
                        return {
                            ...item,
                            endOfResponse: true
                        };
                    }
                    return item;
                });
                
                // Add the new message
                updatedHistory.push({
                    role: data.role,
                    message: data.content,
                    isKnowledgeBaseResponse: isKnowledgeBaseResponse,
                    queryCategory: queryCategory
                });
                
                chatHistoryManager.updateChat({
                    history: updatedHistory
                });
                return;
            }
            
            // For assistant messages - just add to history (don't replace)
            const messageData = {
                role: data.role,
                message: data.content,
                isKnowledgeBaseResponse: isKnowledgeBaseResponse,
                queryCategory: queryCategory
            };
            chatHistoryManager.addTextMessage(messageData);
            
            // Store the latest response content for comparison with audio
            if (isKnowledgeBaseResponse) {
                window.latestKBResponse = data.content;
                
                if (queryCategory) {
                    window.queryCategory = queryCategory;
                }
                
                // Set a timeout to check if this KB response is displayed
                if (window.kbSyncTimeout) {
                    clearTimeout(window.kbSyncTimeout);
                }
                
                window.kbSyncTimeout = setTimeout(() => {
                    if (window.latestKBResponse && !window.kbDisplayed) {
                        console.log("*** KB RESPONSE TIMEOUT SYNC ***");
                        forceKnowledgeBaseDisplay();
                    }
                }, 300); // Short timeout to ensure display
            }
        }
    }
}

// Update the UI based on the current chat history
function updateChatUI() {
    if (!chatContainer) {
        console.error("Chat container not found");
        return;
    }

    // Clear existing chat messages
    chatContainer.innerHTML = '';
    
    // Log the current chat history for debugging
    console.log("Current chat history:", chat.history);

    // Group messages by conversation turns
    let conversationTurns = [];
    let currentTurn = [];
    
    // Process all messages from history and group them into conversation turns
    chat.history.forEach(item => {
        // End of conversation marker
        if (item.endOfConversation) {
            if (currentTurn.length > 0) {
                conversationTurns.push(currentTurn);
                currentTurn = [];
            }
            
            const endDiv = document.createElement('div');
            endDiv.className = 'message system';
            endDiv.textContent = "Conversation ended";
            chatContainer.appendChild(endDiv);
            return;
        }
        
        // Add message to current turn
        currentTurn.push(item);
        
        // If this message ends a turn, add the turn to our groups and start a new one
        if (item.endOfResponse) {
            conversationTurns.push(currentTurn);
            currentTurn = [];
        }
    });
    
    // Add the final turn if it has any messages
    if (currentTurn.length > 0) {
        conversationTurns.push(currentTurn);
    }
    
    // Render all conversation turns
    conversationTurns.forEach(turn => {
        // Create a turn container
        const turnDiv = document.createElement('div');
        turnDiv.className = 'conversation-turn';
        
        // Add all messages in this turn
        turn.forEach(item => {
            if (item.role) {
                const messageDiv = document.createElement('div');
                const roleLowerCase = item.role.toLowerCase();
                messageDiv.className = `message ${roleLowerCase}`;
                
                if (item.endOfResponse) {
                    messageDiv.classList.add('ended');
                }

                const roleLabel = document.createElement('div');
                roleLabel.className = 'role-label';
                roleLabel.textContent = item.role;
                messageDiv.appendChild(roleLabel);

                const messageContent = document.createElement('div');
                messageContent.className = 'message-content';
                
                // If it's a user message and transcription
                if (item.role === 'USER' && item.isTranscription) {
                    messageContent.textContent = item.message;
                } else {
                    messageContent.textContent = item.message;
                }
                
                messageDiv.appendChild(messageContent);
                turnDiv.appendChild(messageDiv);
            }
        });
        
        // Add the turn to the chat container
        chatContainer.appendChild(turnDiv);
    });

    // Re-add thinking indicators if we're still waiting
    if (waitingForUserTranscription) {
        showUserThinkingIndicator();
    }

    if (waitingForAssistantResponse) {
        showAssistantThinkingIndicator();
    }

    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Show the "Listening" indicator for user
function showUserThinkingIndicator() {
    hideUserThinkingIndicator();

    waitingForUserTranscription = true;
    userThinkingIndicator = document.createElement('div');
    userThinkingIndicator.className = 'message user thinking';

    const roleLabel = document.createElement('div');
    roleLabel.className = 'role-label';
    roleLabel.textContent = 'USER';
    userThinkingIndicator.appendChild(roleLabel);

    const listeningText = document.createElement('div');
    listeningText.className = 'thinking-text';
    listeningText.textContent = 'Listening';
    userThinkingIndicator.appendChild(listeningText);

    const dotContainer = document.createElement('div');
    dotContainer.className = 'thinking-dots';

    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dotContainer.appendChild(dot);
    }

    userThinkingIndicator.appendChild(dotContainer);
    chatContainer.appendChild(userThinkingIndicator);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Show the "Thinking" indicator for assistant
function showAssistantThinkingIndicator() {
    hideAssistantThinkingIndicator();

    waitingForAssistantResponse = true;
    assistantThinkingIndicator = document.createElement('div');
    assistantThinkingIndicator.className = 'message assistant thinking';

    const roleLabel = document.createElement('div');
    roleLabel.className = 'role-label';
    roleLabel.textContent = 'ASSISTANT';
    assistantThinkingIndicator.appendChild(roleLabel);

    const thinkingText = document.createElement('div');
    thinkingText.className = 'thinking-text';
    thinkingText.textContent = 'Thinking';
    assistantThinkingIndicator.appendChild(thinkingText);

    const dotContainer = document.createElement('div');
    dotContainer.className = 'thinking-dots';

    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dotContainer.appendChild(dot);
    }

    assistantThinkingIndicator.appendChild(dotContainer);
    chatContainer.appendChild(assistantThinkingIndicator);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Hide the user thinking indicator
function hideUserThinkingIndicator() {
    waitingForUserTranscription = false;
    if (userThinkingIndicator && userThinkingIndicator.parentNode) {
        userThinkingIndicator.parentNode.removeChild(userThinkingIndicator);
    }
    userThinkingIndicator = null;
}

// Hide the assistant thinking indicator
function hideAssistantThinkingIndicator() {
    waitingForAssistantResponse = false;
    if (assistantThinkingIndicator && assistantThinkingIndicator.parentNode) {
        assistantThinkingIndicator.parentNode.removeChild(assistantThinkingIndicator);
    }
    assistantThinkingIndicator = null;
}

// EVENT HANDLERS
// --------------

// Handle content start from the server
socket.on('contentStart', (data) => {
    console.log('Content start received:', data);

    if (data.type === 'TEXT') {
        // Below update will be enabled when role is moved to the contentStart
        role = data.role;
        if (data.role === 'USER') {
            // When user's text content starts, hide user thinking indicator
            hideUserThinkingIndicator();
        }
        else if (data.role === 'ASSISTANT') {
            // When assistant's text content starts, hide assistant thinking indicator
            hideAssistantThinkingIndicator();
            let isSpeculative = false;
            try {
                if (data.additionalModelFields) {
                    const additionalFields = JSON.parse(data.additionalModelFields);
                    isSpeculative = additionalFields.generationStage === "SPECULATIVE";
                    if (isSpeculative) {
                        console.log("Received speculative content");
                        displayAssistantText = true;
                    }
                    else {
                        displayAssistantText = false;
                    }
                }
            } catch (e) {
                console.error("Error parsing additionalModelFields:", e);
            }
        }
    }
    else if (data.type === 'AUDIO') {
        // When audio content starts, we may need to show user thinking indicator
        if (isStreaming) {
            showUserThinkingIndicator();
        }
    }
});

// Handle text output from the server
socket.on('textOutput', (data) => {
    console.log('Received text output:', data);
    
    // Store KB responses when they arrive, regardless of whether they're displayed
    if (data.isKnowledgeBaseResponse && data.content) {
        console.log("*** STORING KB RESPONSE ***:", data.content);
        window.latestKBResponse = data.content;
        window.latestKBRole = data.role;
        
        // Also store query category for better response matching
        if (data.queryCategory) {
            window.queryCategory = data.queryCategory;
            console.log(`*** QUERY CATEGORY: ${data.queryCategory} ***`);
        }
        
        // If this is a fact query that needs audio sync, mark it
        if (data.isFactQuery || data.needsAudioSync) {
            window.isFactQuery = true;
            console.log("*** FACT QUERY DETECTED ***");
        }
    }

    // If this is an audio-sync-only message, don't display it but keep its content
    if (data.suppressDisplay) {
        console.log("Suppressing display but saving content for audio sync:", 
            data.content?.substring(0, 50) + "...");
        return;
    }

    if (data.role === 'USER') {
        // When user text is received, show thinking indicator for assistant response
        transcriptionReceived = true;
        //hideUserThinkingIndicator();

        // Add user message to chat
        handleTextOutput({
            role: data.role,
            content: data.content
        });

        // Show assistant thinking indicator after user text appears
        showAssistantThinkingIndicator();
    }
    else if (data.role === 'ASSISTANT') {
        //hideAssistantThinkingIndicator();
        if (displayAssistantText) {
            // For fact-based queries or responses that need audio sync, always use the KB response
            if ((data.isFactQuery || data.needsAudioSync || window.isFactQuery) && window.latestKBResponse) {
                console.log(`*** USING KB RESPONSE FOR UI (${window.queryCategory}) ***`);
                
                // Force UI update with knowledge base response
                forceKnowledgeBaseDisplay();
            } else {
                handleTextOutput({
                    role: data.role,
                    content: data.content,
                    isKnowledgeBaseResponse: data.isKnowledgeBaseResponse,
                    queryCategory: data.queryCategory
                });
            }
        }
    }
});

// Function to force display of the knowledge base response
function forceKnowledgeBaseDisplay() {
    if (!window.latestKBResponse) {
        console.log("No KB response available to display");
        return;
    }
    
    console.log(`Forcing display of KB response for ${window.queryCategory}:`, window.latestKBResponse);
    
    // Get the existing chat history
    let history = chatRef.current?.history || [];
    let updatedHistory = [...history];
    
    // Mark all existing assistant messages as ended instead of removing them
    updatedHistory = updatedHistory.map(item => {
        if (item.role === 'ASSISTANT' && !item.endOfResponse) {
            return {
                ...item,
                endOfResponse: true  // Mark as ended instead of removing
            };
        }
        return item;
    });
    
    // Add the KB response as a new message
    updatedHistory.push({
        role: 'ASSISTANT',
        message: window.latestKBResponse,
        isKnowledgeBaseResponse: true,
        queryCategory: window.queryCategory
    });
    
    // Update chat directly
    chatHistoryManager.updateChat({
        history: updatedHistory
    });
    
    // Mark that we've synchronized the display
    window.kbDisplayed = true;
    
    // Make sure UI gets updated
    updateChatUI();
}

// Handle audio output
socket.on('audioOutput', (data) => {
    if (data.content) {
        try {
            const audioData = base64ToFloat32Array(data.content);
            audioPlayer.playAudio(audioData);
            
            // This is the first audio chunk, ensure we display the KB response if available
            if (window.isFactQuery && window.latestKBResponse && !window.audioSyncComplete) {
                console.log("*** AUDIO STARTED - FORCING KB DISPLAY ***");
                
                // Mark that we've synchronized the UI with audio
                window.audioSyncComplete = true;
                
                // Force display of KB response
                forceKnowledgeBaseDisplay();
            }
        } catch (error) {
            console.error('Error processing audio data:', error);
        }
    }
});

// Handle content end events
socket.on('contentEnd', (data) => {
    console.log('Content end received:', data);

    if (data.type === 'TEXT') {
        if (role === 'USER') {
            // When user's text content ends, make sure assistant thinking is shown
            hideUserThinkingIndicator();
            showAssistantThinkingIndicator();
        }
        else if (role === 'ASSISTANT') {
            // When assistant's text content ends, prepare for user input in next turn
            hideAssistantThinkingIndicator();
            
            // Final check to ensure KB response was displayed
            if (window.isFactQuery && window.latestKBResponse && !window.kbDisplayed) {
                console.log("*** FINAL TEXT SYNC - FORCING KB DISPLAY ***");
                
                // Force display of KB response
                forceKnowledgeBaseDisplay();
            }
        }

        // Handle stop reasons
        if (data.stopReason && data.stopReason.toUpperCase() === 'END_TURN') {
            console.log("*** END OF TURN DETECTED ***");
            
            // End the current conversation turn
            chatHistoryManager.endTurn();
            
            // Update the UI to show all messages properly
            updateChatUI();
            
            // Save a snapshot of the KB response before resetting
            if (window.latestKBResponse) {
                window.previousKBResponse = window.latestKBResponse;
            }
            
            // Reset flags for fact queries when the turn is complete
            window.isFactQuery = false;
            window.audioSyncComplete = false;
            window.kbDisplayed = false;
        } else if (data.stopReason && data.stopReason.toUpperCase() === 'INTERRUPTED') {
            console.log("Interrupted by user");
            audioPlayer.bargeIn();
        }
    }
    else if (data.type === 'AUDIO') {
        // When audio content ends, we may need to show user thinking indicator
        if (isStreaming) {
            showUserThinkingIndicator();
        }
        
        // Final check after audio ends to ensure KB response was displayed
        if (window.isFactQuery && window.latestKBResponse && !window.kbDisplayed) {
            console.log("*** FINAL AUDIO SYNC - FORCING KB DISPLAY ***");
            
            // Force display of KB response
            forceKnowledgeBaseDisplay();
        }
        
        // If this is the end of a turn, make sure we properly end it
        if (data.stopReason && data.stopReason.toUpperCase() === 'END_TURN') {
            console.log("*** END OF TURN DETECTED (AUDIO) ***");
            
            // End the current conversation turn if not already ended
            chatHistoryManager.endTurn();
            
            // Update the UI to show all messages properly
            updateChatUI();
        }
    }
});

// Stream completion event
socket.on('streamComplete', () => {
    if (isStreaming) {
        stopStreaming();
    }
    statusElement.textContent = "Ready";
    statusElement.className = "ready";
});

// Handle connection status updates
socket.on('connect', () => {
    statusElement.textContent = "Connected to server";
    statusElement.className = "connected";
    sessionInitialized = false;
});

socket.on('disconnect', () => {
    statusElement.textContent = "Disconnected from server";
    statusElement.className = "disconnected";
    startButton.disabled = true;
    stopButton.disabled = true;
    sessionInitialized = false;
    hideUserThinkingIndicator();
    hideAssistantThinkingIndicator();
});

// Handle errors
socket.on('error', (error) => {
    console.error("Server error:", error);
    statusElement.textContent = "Error: " + (error.message || JSON.stringify(error).substring(0, 100));
    statusElement.className = "error";
    hideUserThinkingIndicator();
    hideAssistantThinkingIndicator();
});

// Button event listeners
startButton.addEventListener('click', startStreaming);
stopButton.addEventListener('click', stopStreaming);

// Add login event listeners
loginButton.addEventListener('click', handleLogin);
randomUserButton.addEventListener('click', handleRandomUser);
phoneInput.addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        handleLogin();
    }
});

// Handle user login with entered phone number
async function handleLogin() {
    const phoneNumber = phoneInput.value.trim();
    
    // Validate phone number format (10 digits)
    if (!/^\d{10}$/.test(phoneNumber)) {
        loginError.textContent = 'Please enter a valid 10-digit mobile number';
        return;
    }
    
    loginError.textContent = 'Verifying...';
    
    try {
        // Verify the phone number with the server
        const response = await fetch('/api/verify-phone', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ phoneNumber }),
        });
        
        const data = await response.json();
        
        if (data.success) {
            userPhoneNumber = phoneNumber;
            userDetails = data.userDetails;
            completeLogin();
        } else {
            loginError.textContent = data.message || 'Phone number not found';
        }
    } catch (error) {
        console.error('Login error:', error);
        loginError.textContent = 'An error occurred during verification';
    }
}

// Handle random user login
async function handleRandomUser() {
    loginError.textContent = 'Getting random user...';
    
    try {
        const response = await fetch('/api/random-phone');
        const data = await response.json();
        
        if (data.success) {
            userPhoneNumber = data.phoneNumber;
            userDetails = data.userDetails;
            completeLogin();
        } else {
            loginError.textContent = data.message || 'Failed to get random user';
        }
    } catch (error) {
        console.error('Random user error:', error);
        loginError.textContent = 'An error occurred while getting a random user';
    }
}

// Complete the login process and initialize the app
function completeLogin() {
    // Hide login modal
    loginModal.style.display = 'none';
    
    // Show app container
    appContainer.style.display = 'block';
    
    // Display user info
    updateUserInfoDisplay();
    
    // Initialize audio
    initAudio();
    
    // If socket is already connected, send phone number immediately
    if (socket.connected) {
        console.log("Socket already connected, setting phone number:", userPhoneNumber);
        socket.emit('setPhoneNumber', userPhoneNumber);
    }
    
    // Set up Socket.IO event for system prompt and phone number
    socket.on('connect', () => {
        console.log("Socket connected, setting phone number:", userPhoneNumber);
        // Tell the server about the user's phone number
        socket.emit('setPhoneNumber', userPhoneNumber);
        
        // If session was already initialized, reinitialize it with user info
        if (sessionInitialized) {
            console.log("Reinitializing session with user info");
            socket.emit('systemPrompt', getSystemPrompt());
        }
    });
}

// Update the user info display
function updateUserInfoDisplay() {
    if (userDetails) {
        // Calculate total active loans
        let activeLoans = 0;
        let totalDueAmount = 0;
        
        if (userDetails.Loans && userDetails.Loans.length > 0) {
            userDetails.Loans.forEach(loan => {
                if (loan.Status === 'Active') {
                    activeLoans++;
                    if (loan.DueAmountINR) {
                        totalDueAmount += parseFloat(loan.DueAmountINR);
                    }
                }
            });
        }
        
        userInfoContainer.innerHTML = `
            <div class="user-info-summary">
                <strong>Logged in as:</strong> ${userDetails.Name} | 
                <strong>Phone:</strong> ${userPhoneNumber} | 
                <strong>Credit Score:</strong> ${userDetails.CreditScore} |
                <strong>Balance:</strong> ₹${userDetails.BankDetails.BankBalanceINR.toLocaleString()} |
                <strong>Active Loans:</strong> ${activeLoans} |
                ${totalDueAmount > 0 ? `<strong>Total Due:</strong> ₹${totalDueAmount.toLocaleString()}` : ''}
            </div>
        `;
    } else {
        userInfoContainer.innerHTML = `<strong>Logged in with phone:</strong> ${userPhoneNumber}`;
    }
}

// Custom system prompt with user details
function getSystemPrompt() {
    if (!userDetails) {
        return "You are a friendly banking assistant. The user and you will engage in a spoken dialog. Keep your responses short, generally two or three sentences.";
    }
    
    // Create loans information string
    let loansInfo = '';
    if (userDetails.Loans && userDetails.Loans.length > 0) {
        userDetails.Loans.forEach((loan, index) => {
            loansInfo += `\n      - ${loan.LoanType} (${loan.LoanID}):` +
            `\n        Amount: ₹${loan.LoanAmountINR.toLocaleString()}` +
            `\n        Status: ${loan.Status}` +
            `\n        Interest Rate: ${loan.InterestRatePercent}%` +
            `\n        Tenure: ${loan.TenureYears} years` +
            `\n        Taken Date: ${loan.LoanTakenDate}` +
            (loan.NextDueDate ? `\n        Next Due Date: ${loan.NextDueDate}` : '') +
            (loan.DueAmountINR ? `\n        Due Amount: ₹${loan.DueAmountINR.toLocaleString()}` : '');
        });
    } else {
        loansInfo = "\n      - No active loans";
    }
    
    return `You are a friendly banking assistant. The user, ${userDetails.Name}, and you will engage in a spoken dialog. 
    Here is information about the user:
    - Name: ${userDetails.Name}
    - Customer ID: ${userDetails.CustomerID}
    - Credit Score: ${userDetails.CreditScore}
    - Income: ₹${userDetails.IncomeINR.toLocaleString()}
    - Bank Details:
      - Account Type: ${userDetails.BankDetails.AccountType}
      - Balance: ₹${userDetails.BankDetails.BankBalanceINR.toLocaleString()}
      - Branch: ${userDetails.BankDetails.Branch || 'Not specified'}
    - Active Loans:${loansInfo}
    
    Keep your responses short, generally two or three sentences for chatty scenarios.`;
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', initAudio);

// Reset tracking variables for a new interaction
function resetConversationState() {
    console.log("*** RESETTING CONVERSATION STATE ***");
    
    // Clear any pending KB sync timeout
    if (window.kbSyncTimeout) {
        clearTimeout(window.kbSyncTimeout);
        window.kbSyncTimeout = null;
    }
    
    // Save previous KB response in case we need it
    window.previousKBResponse = window.latestKBResponse;
    window.previousQueryCategory = window.queryCategory;
    
    window.latestKBResponse = null;
    window.latestKBRole = null;
    window.isFactQuery = false;
    window.audioSyncComplete = false;
    window.kbDisplayed = false;
    window.queryCategory = null;
    role = '';
    displayAssistantText = true;
    transcriptionReceived = false;
}
export class ChatHistoryManager {
    static instance = null;

    static getInstance(chatRef = null, setChat = null) {
        if (!ChatHistoryManager.instance) {
            ChatHistoryManager.instance = new ChatHistoryManager(chatRef, setChat);
        }
        
        if (chatRef && setChat) {
            ChatHistoryManager.instance.init(chatRef, setChat);
        }
        
        return ChatHistoryManager.instance;
    }

    constructor(chatRef = null, setChat = null) {
        this.init(chatRef, setChat);
    }

    init(chatRef, setChat) {
        this.chatRef = chatRef;
        this.setChat = setChat;
    }

    addTextMessage(content) {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        }

        let history = this.chatRef.current?.history || [];
        let updatedChatHistory = [...history];
        
        // For assistant messages, check for duplicates and give priority to KB responses
        if (content.role === 'ASSISTANT') {
            // Look for existing assistant messages with identical content
            const existingMessages = updatedChatHistory.filter(item => 
                item.role === 'ASSISTANT' && 
                item.message === content.message);
            
            if (existingMessages.length > 0) {
                console.log("Skipping duplicate assistant message");
                return;
            }
            
            // If adding a message with a query category, mark any previous messages with the same category as ended
            if (content.queryCategory) {
                // Mark previous matching messages as ended, don't replace them
                updatedChatHistory = updatedChatHistory.map(item => {
                    if (item.role === 'ASSISTANT' && 
                        item.queryCategory === content.queryCategory &&
                        !item.endOfResponse) {
                        console.log(`Marking previous message with category ${content.queryCategory} as ended`);
                        return {
                            ...item,
                            endOfResponse: true
                        };
                    }
                    return item;
                });
            }
            
            // Mark any active assistant messages (without endOfResponse) as ended
            updatedChatHistory = updatedChatHistory.map(item => {
                if (item.role === 'ASSISTANT' && !item.endOfResponse) {
                    console.log("Marking previous assistant message as ended");
                    return {
                        ...item,
                        endOfResponse: true
                    };
                }
                return item;
            });
        }

        // Add the new message to the history
        updatedChatHistory.push({
            role: content.role,
            message: content.message,
            isKnowledgeBaseResponse: content.isKnowledgeBaseResponse,
            queryCategory: content.queryCategory
        });

        this.setChat({
            history: updatedChatHistory
        });
    }

    // Direct method to update chat history
    updateChat(newChat) {
        if (!this.setChat) {
            console.error("ChatHistoryManager: setChat is not initialized");
            return;
        }
        this.setChat(newChat);
    }

    endTurn() {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        }

        let history = this.chatRef.current?.history || [];
        
        // Find the last group of messages that don't have endOfResponse set
        // These are the messages in the current turn
        const currentTurnMessages = [];
        let foundUnendedMessage = false;
        
        // Go through history in reverse to find the current turn's messages
        for (let i = history.length - 1; i >= 0; i--) {
            const item = history[i];
            
            // If we encounter a message that's already marked as ended, 
            // we've gone past the current turn
            if (item.endOfResponse) {
                if (foundUnendedMessage) {
                    // We've already found unended messages and now hit an ended one,
                    // so we're done with the current turn
                    break;
                }
                // Otherwise, continue searching
                continue;
            }
            
            // Found an unended message - part of the current turn
            foundUnendedMessage = true;
            currentTurnMessages.unshift(i); // Add to front of array to maintain order
        }
        
        // Now mark just the messages in this turn as ended
        let updatedChatHistory = [...history];
        
        currentTurnMessages.forEach(index => {
            updatedChatHistory[index] = {
                ...updatedChatHistory[index],
                endOfResponse: true
            };
        });

        this.setChat({
            history: updatedChatHistory
        });
        
        console.log("Ended current turn, marked " + currentTurnMessages.length + " messages as ended");
    }

    endConversation() {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        }

        let history = this.chatRef.current?.history || [];
        let updatedChatHistory = history.map(item => {
            return {
                ...item,
                endOfResponse: true
            };
        });

        updatedChatHistory.push({
            endOfConversation: true
        });

        this.setChat({
            history: updatedChatHistory
        });
    }
}

export default ChatHistoryManager;
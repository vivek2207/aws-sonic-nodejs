export class ChatHistoryManager {
    static instance = null;

    constructor(chatRef, setChat) {
        if (ChatHistoryManager.instance) {
            return ChatHistoryManager.instance;
        }

        this.chatRef = chatRef;
        this.setChat = setChat;
        ChatHistoryManager.instance = this;
    }

    static getInstance(chatRef, setChat) {
        if (!ChatHistoryManager.instance) {
            ChatHistoryManager.instance = new ChatHistoryManager(chatRef, setChat);
        } else if (chatRef && setChat) {
            // Update references if they're provided
            ChatHistoryManager.instance.chatRef = chatRef;
            ChatHistoryManager.instance.setChat = setChat;
        }
        return ChatHistoryManager.instance;
    }

    addTextMessage(content) {
    if (!this.chatRef || !this.setChat) {
        console.error("ChatHistoryManager: chatRef or setChat is not initialized");
        return;
    }

    let history = this.chatRef.current?.history || [];
    let updatedChatHistory = [...history];
    let lastTurn = updatedChatHistory[updatedChatHistory.length - 1];

    // Check if this is a duplicate message
    if (lastTurn !== undefined && lastTurn.role === content.role) {
        // Check if the new message is already contained in the last message
        // This prevents duplicate content from being appended
        if (!lastTurn.message.includes(content.message)) {
            // Only append if it's not a duplicate
            updatedChatHistory[updatedChatHistory.length - 1] = {
                ...content,
                message: lastTurn.message + " " + content.message
            };
        }
    }
    else {
        // Different role, add a new turn
        updatedChatHistory.push({
            role: content.role,
            message: content.message
        });
    }

    this.setChat({
        history: updatedChatHistory
    });
}

    endTurn() {
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

        this.setChat({
            history: updatedChatHistory
        });
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

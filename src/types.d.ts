declare module '@aws-sdk/client-dynamodb' {
    export class DynamoDBClient {
        constructor(config: any);
    }
}

declare module '@aws-sdk/lib-dynamodb' {
    export class DynamoDBDocumentClient {
        static from(client: any): DynamoDBDocumentClient;
    }

    export class GetCommand {
        constructor(input: any);
    }
} 
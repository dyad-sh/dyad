// Test script pour vérifier si la clé Google fonctionne avec le SDK
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText } from 'ai';

const apiKey = 'AIzaSyAFtBsBClS3PgCMaJUIJAif3ln6-1eJqjU';
const modelId = 'gemini-2.0-flash-exp';

console.log('Testing Google API Key with SDK...');
console.log(`API Key: ${apiKey.substring(0, 20)}...`);
console.log(`Model: ${modelId}`);

async function test() {
    try {
        const model = createGoogleGenerativeAI({ apiKey })(modelId);

        console.log('Model created successfully');
        console.log('Attempting to stream text...');

        const { textStream } = await streamText({
            model,
            messages: [{ role: 'user', content: 'Hello, test message' }],
        });

        console.log('Stream started, reading chunks...');

        let fullResponse = '';
        for await (const chunk of textStream) {
            fullResponse += chunk;
            process.stdout.write(chunk);
        }

        console.log('\n\nFull response:', fullResponse);
        console.log('\n✅ Test successful!');

    } catch (error) {
        console.error('\n❌ Test failed:');
        console.error('Error:', error.message);
        console.error('Status:', error.statusCode);
        console.error('Response:', error.responseBody);
    }
}

test();

import { testWithConfigSkipIfWindows } from "./helpers/test_helper";

// Set environment variables before the test runs to enable Azure testing

const testAzure = testWithConfigSkipIfWindows({
  preLaunchHook: async () => {
    process.env.TEST_AZURE_BASE_URL = "http://localhost:3500/azure";
    process.env.AZURE_API_KEY = "fake-azure-key-for-testing";
    process.env.AZURE_RESOURCE_NAME = "fake-resource-for-testing";
  },
});

testAzure("send message through Azure OpenAI", async ({ po }) => {
  // Set up Azure without test provider
  await po.setUpAzure();

  // Select Azure model
  await po.selectTestAzureModel();

  // Send a test prompt that returns a normal conversational response
  await po.sendPrompt("tc=basic");

  // Verify we get a response (this means Azure integration is working)
  await po.snapshotMessages();
});
